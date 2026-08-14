import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NodeWidgetFilesystemWorkspace,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import {
  fnCanonicalizeWidgetBuildReceipt,
  fnCreateWidgetBuildReceipt,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  type TWidgetManifestV1,
} from '@omnidraw/sdk/contract';
import { WidgetBuildGenerationService } from '../src/shell/widget/WidgetBuildGenerationService';
import { fnWidgetBuildGenerationPollOrder } from '../src/shell/widget/fn.widget-build-generation';

const temporaryRoots: string[] = [];

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

const manifest: TWidgetManifestV1 = {
  $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
  schemaVersion: 1,
  name: 'Generation Fixture',
  slug: 'generation-fixture',
  description: 'Build observation fixture.',
  tool: { label: 'Generation Fixture', group: null, priority: 0 },
  ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
};

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-build-generation-'));
  temporaryRoots.push(root);
  const widgetRoot = join(root, 'drafts', manifest.slug);
  await Promise.all([
    mkdir(join(widgetRoot, 'ui'), { recursive: true }),
    mkdir(join(widgetRoot, 'dist'), { recursive: true }),
    mkdir(join(root, 'published'), { recursive: true }),
    mkdir(join(root, '.staging'), { recursive: true }),
    mkdir(join(root, '.preview'), { recursive: true }),
    mkdir(join(root, '.trash'), { recursive: true }),
    mkdir(join(root, '.quarantine'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(widgetRoot, 'omnidraw.json'), `${JSON.stringify(manifest)}\n`),
    writeFile(join(widgetRoot, 'ui', 'main.ts'), 'export default 1;\n'),
    writeFile(join(widgetRoot, 'package.json'), '{"private":true}\n'),
    writeFile(join(widgetRoot, 'dist', 'main.js'), 'export default 1;\n'),
  ]);
  const outputBytes = new TextEncoder().encode('export default 1;\n');
  const independentlyBuiltBytes = new TextEncoder().encode('export default "host validated";\n');
  const closedWorkspaces: string[] = [];
  const builder = {
    async construct() {
      return {
        executableInputDigestSha256: 'a'.repeat(64),
        executableManifestDigestSha256: 'b'.repeat(64),
        canonicalExecutableManifestJson: '{}',
        distributionDigestSha256: sha256(independentlyBuiltBytes),
        construction: {},
        distFiles: [{ path: 'dist/main.js', bytes: independentlyBuiltBytes }],
      };
    },
    async sign(construction: unknown) {
      return { construction };
    },
    async closeWorkspace(workspaceId: string) {
      closedWorkspaces.push(workspaceId);
    },
  } as unknown as WidgetFilesystemBuildService;
  let refreshes = 0;
  const changed: string[] = [];
  const service = new WidgetBuildGenerationService({
    widgetsRoot: root,
    builder,
    sdkVersion: '1.2.3',
    catalog: {
      async refresh() {
        refreshes += 1;
      },
      notifyBuildGenerationChanged(widgetKey) {
        changed.push(widgetKey);
      },
    },
    now: Date.now,
    scheduleInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
    cancelInterval: (timer) => clearInterval(timer),
  });
  const workspace = await NodeWidgetFilesystemWorkspace.open({ rootPath: root });
  const writeReceipt = async () => {
    const capture = await workspace.captureDraftBuildInput({
      slug: manifest.slug,
      signal: new AbortController().signal,
    });
    const receipt = fnCreateWidgetBuildReceipt({
      sourceDigestSha256: fnWidgetPortableSourceDigest({
        files: capture.files,
        digestSha256: sha256,
      }),
      manifestDigestSha256: fnWidgetManifestV1Digest({
        manifest: capture.manifest,
        digestSha256: sha256,
      }),
      executableInputDigestSha256: fnWidgetPortableExecutableInputDigest({
        manifest: capture.manifest,
        files: capture.files,
        digestSha256: sha256,
      }),
      sdkVersion: '1.2.3',
      outputs: [{
        path: 'dist/main.js',
        byteSize: outputBytes.byteLength,
        sha256: sha256(outputBytes),
      }],
      digestSha256: sha256,
    });
    await writeFile(
      join(widgetRoot, 'dist', 'omnidraw.build.json'),
      fnCanonicalizeWidgetBuildReceipt(receipt),
    );
    return receipt;
  };
  return {
    service,
    widgetRoot,
    writeReceipt,
    changed,
    closedWorkspaces,
    refreshes: () => refreshes,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('WidgetBuildGenerationService', () => {
  test('rotates the bounded polling order so later drafts receive a turn', () => {
    const entries = Array.from({ length: 20 }, (_value, index) => index);
    const first = fnWidgetBuildGenerationPollOrder({ entries, cursor: 0 });
    const second = fnWidgetBuildGenerationPollOrder({ entries, cursor: 16 });

    expect(first.slice(0, 16)).toEqual(Array.from({ length: 16 }, (_value, index) => index));
    expect(second.slice(0, 4)).toEqual([16, 17, 18, 19]);
    expect(second.slice(4, 8)).toEqual([0, 1, 2, 3]);
  });

  test('accepts one complete receipt idempotently and keeps it while source becomes stale', async () => {
    const harness = await createHarness();
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'unbuilt',
      acceptedGeneration: null,
    });
    const receipt = await harness.writeReceipt();
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'ready',
      acceptedGeneration: 1,
      acceptedBuildIdentity: receipt.buildIdentity,
      current: true,
    });
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      acceptedGeneration: 1,
      current: true,
    });
    expect(harness.changed).toEqual([manifest.slug]);
    expect(harness.refreshes()).toBe(1);

    await writeFile(join(harness.widgetRoot, 'ui', 'main.ts'), 'export default 2;\n');
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'build_required',
      acceptedGeneration: 1,
      current: false,
    });
    expect(harness.service.accepted(manifest.slug)?.receipt.buildIdentity)
      .toBe(receipt.buildIdentity);
    await harness.service.stop();
  });

  test('rejects partial and stale receipts without replacing the accepted generation', async () => {
    const harness = await createHarness();
    await writeFile(join(harness.widgetRoot, 'dist', 'omnidraw.build.json'), '{');
    expect(await harness.service.view(manifest.slug)).toMatchObject({
      phase: 'rejected',
      acceptedGeneration: null,
    });

    const acceptedReceipt = await harness.writeReceipt();
    expect((await harness.service.requireCurrent(manifest.slug)).receipt.buildIdentity)
      .toBe(acceptedReceipt.buildIdentity);
    await writeFile(join(harness.widgetRoot, 'ui', 'main.ts'), 'export default 3;\n');
    await writeFile(join(harness.widgetRoot, 'dist', 'omnidraw.build.json'), '{"format":');
    const rejected = await harness.service.view(manifest.slug);
    expect(rejected.phase).toBe('build_required');
    expect(rejected.acceptedGeneration).toBe(1);
    expect(rejected.current).toBe(false);
    expect(harness.service.accepted(manifest.slug)?.receipt.buildIdentity)
      .toBe(acceptedReceipt.buildIdentity);
    await harness.service.stop();
  });

  test('retires accepted state and its construction workspace for a deleted draft', async () => {
    const harness = await createHarness();
    await harness.writeReceipt();
    expect((await harness.service.requireCurrent(manifest.slug)).generation).toBe(1);
    expect(harness.service.accepted(manifest.slug)).not.toBeNull();

    await harness.service.retire(manifest.slug);

    expect(harness.service.accepted(manifest.slug)).toBeNull();
    expect(harness.closedWorkspaces).toEqual([`generation_${manifest.slug}`]);
    await harness.service.stop();
  });
});
