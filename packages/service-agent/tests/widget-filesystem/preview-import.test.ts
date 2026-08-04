import { describe, expect, test } from 'bun:test';
import {
  WidgetImportService,
  fnPlanWidgetImport,
  fnSelectWidgetImportRunner,
  type TWidgetImportPorts,
  type TWidgetImportRunner,
  type TWidgetImportTreeEntry,
} from '../../src/widget-filesystem/import/index';

type TCheckout = Readonly<{ locator: string }>;

function importHarness(args: Readonly<{
  slug?: string;
  existing?: readonly string[];
  existingSequence?: readonly (readonly string[])[];
  tree?: readonly TWidgetImportTreeEntry[];
  managedSlugs?: readonly string[];
  treeDigests?: readonly string[];
}> = {}) {
  const events: string[] = [];
  const runners: TWidgetImportRunner[] = [];
  let draftListCall = 0;
  let managedManifestCall = 0;
  let treeObservationCall = 0;
  const ports: TWidgetImportPorts<TCheckout, string> = {
    createOperationId() { return 'operation-1'; },
    async acquireSource({ source }) {
      events.push(`acquire:${source.kind}`);
      return { locator: source.locator };
    },
    async releaseSource() { events.push('release-source'); },
    async inspectManifest() {
      // Extra checkout metadata cannot influence the separately selected runner.
      return { slug: args.slug ?? 'counter', requestedRunner: 'host' };
    },
    async listDraftDirectoryNames() {
      const sequence = args.existingSequence;
      if (sequence !== undefined && sequence.length > 0) {
        const value = sequence[Math.min(draftListCall, sequence.length - 1)]!;
        draftListCall += 1;
        return value;
      }
      return args.existing ?? [];
    },
    async prepareStaging({ relativePath, expectedAbsent }) {
      events.push(`prepare:${relativePath}:${expectedAbsent}`);
    },
    async copyCheckout({ destinationRelativePath, mode }) {
      events.push(`copy:${destinationRelativePath}:${mode}`);
    },
    async inspectManagedManifest() {
      const values = args.managedSlugs ?? [args.slug ?? 'counter'];
      const slug = values[Math.min(managedManifestCall, values.length - 1)]!;
      managedManifestCall += 1;
      return { slug };
    },
    async captureManagedTree() {
      const digests = args.treeDigests ?? ['a'.repeat(64)];
      const digestSha256 = digests[Math.min(treeObservationCall, digests.length - 1)]!;
      treeObservationCall += 1;
      return {
        entries: args.tree ?? [
          { path: 'omnidraw.json', kind: 'file' },
          { path: 'ui', kind: 'directory' },
          { path: 'ui/main.ts', kind: 'file' },
        ],
        digestSha256,
      };
    },
    async build({ runner }) {
      runners.push(runner);
      events.push(`build:${runner.kind}`);
      return 'validated-build';
    },
    async acquireWriterLease() {
      events.push('lock');
      return { async release() { events.push('unlock'); } };
    },
    async promoteStaging({ stagingRelativePath, draftRelativePath, expectedDraftAbsent }) {
      events.push(`promote:${stagingRelativePath}:${draftRelativePath}:${expectedDraftAbsent}`);
    },
    async removeManagedPath({ relativePath }) { events.push(`remove:${relativePath}`); },
  };
  return { events, runners, service: new WidgetImportService(ports) };
}

describe('WidgetImportService', () => {
  test('defaults a remote import to the isolated runner and copies without links', async () => {
    const harness = importHarness();
    const result = await harness.service.import({
      source: { kind: 'remote', locator: 'https://example.test/widgets/counter.git' },
    });

    expect(result).toEqual({
      slug: 'counter',
      draftRelativePath: 'drafts/counter',
      sourceTreeDigestSha256: 'a'.repeat(64),
      runner: { kind: 'isolated', reason: 'default-untrusted-source' },
      build: 'validated-build',
    });
    expect(harness.events).toContain(
      'copy:.staging/import-counter-operation-1:copy-files-no-follow',
    );
    expect(harness.events.indexOf('lock')).toBeLessThan(
      harness.events.indexOf('prepare:.staging/import-counter-operation-1:true'),
    );
    expect(harness.events).toContain(
      'promote:.staging/import-counter-operation-1:drafts/counter:true',
    );
    expect(harness.events).not.toContain('remove:.staging/import-counter-operation-1');
    expect(harness.events.slice(-2)).toEqual(['unlock', 'release-source']);
  });

  test('allows a host build only through an explicit trusted-local policy', async () => {
    expect(fnSelectWidgetImportRunner({ sourceKind: 'remote' })).toEqual({
      kind: 'isolated',
      reason: 'default-untrusted-source',
    });
    expect(fnSelectWidgetImportRunner({
      sourceKind: 'remote',
      localTrustPolicy: { kind: 'trusted-local' },
    })).toEqual({ kind: 'host', trust: 'trusted-local' });

    const harness = importHarness();
    const result = await harness.service.import({
      source: { kind: 'remote', locator: 'https://example.test/widgets/trusted.git' },
      localTrustPolicy: { kind: 'trusted-local' },
    });
    expect(result.runner).toEqual({ kind: 'host', trust: 'trusted-local' });
    expect(harness.runners).toEqual([{ kind: 'host', trust: 'trusted-local' }]);
  });

  test('fails exact and case-folded draft collisions before copy or build', async () => {
    const caseCollision = importHarness({ existing: ['Counter'] });
    await expect(caseCollision.service.import({
      source: { kind: 'external-checkout', locator: '/external/counter' },
    })).rejects.toMatchObject({
      code: 'WIDGET_IMPORT_DRAFT_CASE_COLLISION',
    });
    expect(caseCollision.events).toEqual(['acquire:external-checkout', 'release-source']);

    expect(fnPlanWidgetImport({
      slug: 'counter',
      operationId: 'operation-1',
      existingDraftDirectoryNames: ['counter'],
    })).toEqual({
      ok: false,
      reason: 'draft_exists',
      collision: 'counter',
    });
  });

  test('rechecks collision under the writer lease before promoting a built draft', async () => {
    const raced = importHarness({ existingSequence: [[], ['Counter']] });
    await expect(raced.service.import({
      source: { kind: 'remote', locator: 'https://example.test/widgets/counter.git' },
    })).rejects.toMatchObject({
      code: 'WIDGET_IMPORT_DRAFT_CASE_COLLISION',
    });
    expect(raced.events).toContain('build:isolated');
    expect(raced.events).toContain('lock');
    expect(raced.events).toContain('unlock');
    expect(raced.events).toContain('remove:.staging/import-counter-operation-1');
    expect(raced.events.some((event) => event.startsWith('promote:'))).toBe(false);
  });

  test('rejects links in the copied managed tree and removes staging', async () => {
    const harness = importHarness({
      tree: [
        { path: 'omnidraw.json', kind: 'file' },
        { path: 'ui/current', kind: 'symbolic-link' },
      ],
    });
    await expect(harness.service.import({
      source: { kind: 'external-checkout', locator: '/external/counter' },
    })).rejects.toMatchObject({
      code: 'WIDGET_IMPORT_LINK_NOT_ALLOWED',
    });
    expect(harness.events).toContain('remove:.staging/import-counter-operation-1');
    expect(harness.events).not.toContain('build:isolated');
    expect(harness.events.at(-1)).toBe('release-source');
  });

  test('re-parses the copied manifest and fences exact staging bytes through promotion', async () => {
    const changedManifest = importHarness({ managedSlugs: ['other-widget'] });
    await expect(changedManifest.service.import({
      source: { kind: 'remote', locator: 'https://example.test/widgets/counter.git' },
    })).rejects.toMatchObject({ code: 'WIDGET_IMPORT_MANIFEST_CHANGED' });
    expect(changedManifest.events).not.toContain('build:isolated');

    const changedTree = importHarness({
      treeDigests: ['a'.repeat(64), 'b'.repeat(64)],
    });
    await expect(changedTree.service.import({
      source: { kind: 'remote', locator: 'https://example.test/widgets/counter.git' },
    })).rejects.toMatchObject({ code: 'WIDGET_IMPORT_STAGING_CHANGED' });
    expect(changedTree.events).toContain('build:isolated');
    expect(changedTree.events.some((event) => event.startsWith('promote:'))).toBe(false);
    expect(changedTree.events).toContain('remove:.staging/import-counter-operation-1');
    expect(changedTree.events.indexOf('remove:.staging/import-counter-operation-1'))
      .toBeLessThan(changedTree.events.indexOf('unlock'));
  });

  test('keeps generated destination paths confined to managed staging and drafts', () => {
    expect(fnPlanWidgetImport({
      slug: '../counter',
      operationId: 'operation-1',
      existingDraftDirectoryNames: [],
    })).toEqual({ ok: false, reason: 'invalid_slug' });
    expect(fnPlanWidgetImport({
      slug: 'counter',
      operationId: '../escape',
      existingDraftDirectoryNames: [],
    })).toEqual({ ok: false, reason: 'invalid_operation_id' });
    expect(fnPlanWidgetImport({
      slug: 'counter',
      operationId: 'operation-1',
      existingDraftDirectoryNames: [],
    })).toEqual({
      ok: true,
      plan: {
        slug: 'counter',
        stagingRelativePath: '.staging/import-counter-operation-1',
        draftRelativePath: 'drafts/counter',
        copyMode: 'copy-files-no-follow',
      },
    });
  });
});
