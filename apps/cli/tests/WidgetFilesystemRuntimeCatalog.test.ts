import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV4,
} from '@omnidraw/widget-contract';
import {
  fnCreateWidgetReleaseDescriptor,
  fnWidgetExecutableManifestDigest,
} from '@omnidraw/widget-contract/filesystem';
import type { TWidgetCatalogCapsuleInspectionPortal } from '@omnidraw/service-agent';
import { WidgetFilesystemRuntimeCatalog } from '../src/services/WidgetFilesystemRuntimeCatalog';

const temporaryRoots: string[] = [];
const RELEASE_ATTESTATION = Object.freeze({
  algorithm: 'Ed25519' as const,
  keyId: 'release-key',
  signatureBase64: Buffer.alloc(64, 1).toString('base64'),
});

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function runtime(artifactHash: `sha256:${string}`): TWidgetCapsuleRuntimeDescriptor {
  return {
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash: artifactHash,
    apiContract: {
      format: 'capsule-api-groups-v1',
      groups: ['DOM'],
      bundleDigest: `sha256:${'b'.repeat(64)}`,
    },
    budgets: {},
    capabilityRequests: [],
    channels: null,
    parkability: { parkable: false },
    signatureKeyIds: ['release-key'],
  };
}

function manifest(
  slug: string,
  options: Readonly<{ requiredResource?: boolean }> = {},
): TWidgetManifestV4 {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v4.json',
    schemaVersion: 4,
    name: `Widget ${slug}`,
    slug,
    description: 'A filesystem runtime catalog fixture.',
    tool: { label: `Widget ${slug}`, group: 'tests', priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    ...(options.requiredResource
      ? {
          resources: [{
            slot: 'records',
            kind: 'db',
            effect: 'read',
            required: true,
          }],
        }
      : {}),
  };
}

const capsule: TWidgetCatalogCapsuleInspectionPortal = {
  async inspectCapsuleArtifact(args) {
    return {
      artifactHash: args.expectedRuntime.capsuleArtifactHash,
      runtime: args.expectedRuntime,
    };
  },
};

async function widgetsRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'omnidraw-runtime-catalog-'));
  temporaryRoots.push(path);
  await Promise.all([
    mkdir(join(path, 'drafts')),
    mkdir(join(path, 'published')),
  ]);
  return path;
}

async function writePublication(
  root: string,
  value: TWidgetManifestV4,
  capsuleText: string,
): Promise<string> {
  const path = join(root, 'published', value.slug);
  const distBytes = new Uint8Array(Buffer.from('export default 1;', 'utf8'));
  const capsuleBytes = new Uint8Array(Buffer.from(capsuleText, 'utf8'));
  const artifactHash = `sha256:${sha256(capsuleBytes)}` as const;
  const release = fnCreateWidgetReleaseDescriptor({
    executableManifestDigestSha256: fnWidgetExecutableManifestDigest({
      manifest: value,
      digestSha256: sha256,
    }),
    files: [
      {
        path: 'capsule.artifact',
        byteSize: capsuleBytes.byteLength,
        sha256: sha256(capsuleBytes),
      },
      {
        path: 'dist/main.js',
        byteSize: distBytes.byteLength,
        sha256: sha256(distBytes),
      },
    ],
    capsule: {
      path: 'capsule.artifact',
      artifactHash,
      runtime: runtime(artifactHash),
    },
    server: null,
    releaseAttestation: RELEASE_ATTESTATION,
  });
  await mkdir(join(path, 'dist'), { recursive: true });
  await Promise.all([
    writeFile(join(path, 'omnidraw.json'), JSON.stringify(value)),
    writeFile(join(path, 'capsule.artifact'), capsuleBytes),
    writeFile(join(path, 'dist', 'main.js'), distBytes),
    writeFile(join(path, 'release.json'), JSON.stringify(release)),
  ]);
  return path;
}

async function writeDraft(root: string, value: TWidgetManifestV4): Promise<void> {
  const path = join(root, 'drafts', value.slug);
  await mkdir(join(path, 'ui'), { recursive: true });
  await Promise.all([
    writeFile(join(path, 'omnidraw.json'), JSON.stringify(value)),
    writeFile(join(path, 'ui', 'main.ts'), 'export default function mount() {}\n'),
  ]);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('WidgetFilesystemRuntimeCatalog', () => {
  test('starts from the filesystem and resolves placement and exact current runtime bytes', async () => {
    const root = await widgetsRoot();
    await writePublication(root, manifest('counter'), 'signed-counter-v1');
    const catalog = new WidgetFilesystemRuntimeCatalog({ widgetsRoot: root, capsule });

    await catalog.start();
    await catalog.start();
    expect(catalog.current().generation).toBe(1);
    const [reference] = catalog.publishedReferences();
    expect(reference).toEqual({
      source: 'published',
      widgetKey: 'counter',
      catalogGeneration: 1,
    });
    expect(catalog.resolvePlacement({ reference: reference! })).toMatchObject({
      kind: 'published',
      widgetKey: 'counter',
      catalogGeneration: 1,
      resourceBindings: {},
    });

    const resolution = await catalog.resolveRuntime('counter');
    expect(Buffer.from(resolution.capsuleBytes).toString('utf8')).toBe('signed-counter-v1');
    expect(resolution.serverEntryBytes).toBeNull();
    expect(resolution.functionDescriptors).toEqual([]);
    expect(catalog.isRuntimeResolutionCurrent(resolution)).toBe(true);
  });

  test('requires concrete local resource choices and preserves them in the placement descriptor', async () => {
    const root = await widgetsRoot();
    await writePublication(root, manifest('records', { requiredResource: true }), 'signed-records');
    const catalog = new WidgetFilesystemRuntimeCatalog({ widgetsRoot: root, capsule });
    await catalog.start();
    const reference = catalog.publishedReferences()[0]!;

    expect(() => catalog.resolvePlacement({ reference })).toThrow('requires a concrete local choice');
    expect(catalog.resolvePlacement({
      reference,
      resourceBindings: {
        records: { resourceId: 'resource-a', allowRead: true, allowWrite: false },
      },
    }).resourceBindings).toEqual({
      records: { resourceId: 'resource-a', allowRead: true, allowWrite: false },
    });
    expect(() => catalog.resolvePlacement({
      reference,
      resourceBindings: {
        records: { resourceId: 'resource-a', allowRead: false, allowWrite: true },
      },
    })).toThrow('invalid');
  });

  test('fails exact runtime reads clearly when files disappear or change without deleting authority data', async () => {
    const root = await widgetsRoot();
    const path = await writePublication(root, manifest('fragile'), 'signed-fragile');
    const catalog = new WidgetFilesystemRuntimeCatalog({ widgetsRoot: root, capsule });
    await catalog.start();
    const reference = catalog.publishedReferences()[0]!;

    await writeFile(join(path, 'capsule.artifact'), 'tampered-capsule');
    await expect(catalog.resolveRuntime('fragile')).rejects.toMatchObject({
      code: 'WIDGET_MISSING',
    });
    expect(catalog.resolvePlacement({ reference }).widgetKey).toBe('fragile');

    await catalog.refresh();
    expect(catalog.publishedReferences()).toEqual([]);
    expect(() => catalog.resolvePlacement({
      reference: { ...reference, catalogGeneration: catalog.current().generation },
    })).toThrow('missing or unhealthy');
  });

  test('publishes immutable generations and invalidates stale placement/runtime observations', async () => {
    const root = await widgetsRoot();
    await writePublication(root, manifest('live'), 'signed-live-v1');
    const catalog = new WidgetFilesystemRuntimeCatalog({ widgetsRoot: root, capsule });
    const events: unknown[] = [];
    catalog.subscribe((event) => events.push(event));
    await catalog.start();
    const oldReference = catalog.publishedReferences()[0]!;
    const oldRuntime = await catalog.resolveRuntime('live');

    await writePublication(root, manifest('live'), 'signed-live-v2');
    await catalog.refresh();
    expect(catalog.current().generation).toBe(2);
    expect(catalog.isRuntimeResolutionCurrent(oldRuntime)).toBe(false);
    expect(() => catalog.resolvePlacement({ reference: oldReference }))
      .toThrow('generation changed');
    const newReference = catalog.publishedReferences()[0]!;
    const next = await catalog.resolveRuntime('live');
    expect(Buffer.from(next.capsuleBytes).toString('utf8')).toBe('signed-live-v2');
    expect(events).toEqual([
      {
        previousGeneration: null,
        generation: 1,
        changedWidgetKeys: ['live'],
      },
      {
        previousGeneration: 1,
        generation: 2,
        changedWidgetKeys: ['live'],
      },
    ]);
    expect(newReference.catalogGeneration).toBe(2);
  });

  test('refreshes every published placement reference when any catalog entry changes', async () => {
    const root = await widgetsRoot();
    await Promise.all([
      writePublication(root, manifest('first'), 'signed-first'),
      writePublication(root, manifest('second'), 'signed-second'),
    ]);
    const catalog = new WidgetFilesystemRuntimeCatalog({ widgetsRoot: root, capsule });
    await catalog.start();
    const events: Array<Readonly<{ changedWidgetKeys: readonly string[] }>> = [];
    catalog.subscribe((event) => events.push(event));

    const firstDraft = manifest('first');
    firstDraft.description = 'A draft-only presentation change.';
    await writeDraft(root, firstDraft);
    await catalog.refresh();

    expect(catalog.current().generation).toBe(2);
    expect(events).toEqual([{
      previousGeneration: 1,
      generation: 2,
      changedWidgetKeys: ['first', 'second'],
    }]);
    expect(catalog.publishedReferences()).toEqual([
      { source: 'published', widgetKey: 'first', catalogGeneration: 2 },
      { source: 'published', widgetKey: 'second', catalogGeneration: 2 },
    ]);
  });
});
