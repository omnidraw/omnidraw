import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV1,
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
  options: Readonly<{ requiredResource?: boolean; resourceId?: string }> = {},
): TWidgetManifestV1 {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: `Widget ${slug}`,
    slug,
    description: 'A filesystem runtime catalog fixture.',
    tool: { label: `Widget ${slug}`, group: 'tests', priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    ...(options.requiredResource
      ? {
          resources: [{
            slot: 'records',
            ...(options.resourceId === undefined ? {} : { resourceId: options.resourceId }),
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
  value: TWidgetManifestV1,
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

async function writeDraft(root: string, value: TWidgetManifestV1): Promise<void> {
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
  test('resolves exact mention variants from one snapshot and fences mounted drafts', async () => {
    const root = await widgetsRoot();
    const value = manifest('mentioned', { requiredResource: true });
    await Promise.all([
      writeDraft(root, value),
      writePublication(root, value, 'signed-mentioned'),
    ]);
    const catalog = new WidgetFilesystemRuntimeCatalog({
      widgetsRoot: root,
      capsule,
      buildGenerations: {
        async view() {
          return {
            phase: 'ready' as const,
            acceptedGeneration: 4,
            current: true,
          };
        },
      },
    });
    const resolution = await catalog.resolveWidgetReferences([
      { name: 'mentioned', source: 'published' },
      { name: 'mentioned', source: 'published' },
      { name: 'mentioned', source: 'draft' },
    ]);
    expect(resolution.references).toHaveLength(2);
    expect(resolution.references[0]).toMatchObject({
      widgetKey: 'mentioned',
      requestedVariant: 'published',
      displayName: 'Widget mentioned',
      draftAvailable: true,
      publicationAvailable: true,
      requirements: [{ slot: 'records', kind: 'db', effect: 'read', required: true }],
      editableDraft: {
        name: 'Widget mentioned',
        slug: 'mentioned',
        buildPhase: 'ready',
        acceptedGeneration: 4,
        acceptedCurrent: true,
      },
    });
    await expect(catalog.assertWidgetReferenceResolutionCurrent(resolution)).resolves.toBeUndefined();

    const changed = { ...value, description: 'External edit after resolution.' };
    await writeFile(join(root, 'drafts', 'mentioned', 'omnidraw.json'), JSON.stringify(changed));
    await expect(catalog.assertWidgetReferenceResolutionCurrent(resolution)).rejects.toMatchObject({
      code: 'WIDGET_REFERENCE_STALE',
    });
    await expect(catalog.resolveWidgetReferences([
      { name: 'missing', source: 'published' },
    ])).rejects.toMatchObject({ code: 'WIDGET_REFERENCE_STALE' });
  });

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
    await expect(catalog.resolvePlacement({ reference: reference! })).resolves.toMatchObject({
      kind: 'published',
      widgetKey: 'counter',
      catalogGeneration: 1,
    });

    const resolution = await catalog.resolveRuntime('counter');
    expect(Buffer.from(resolution.capsuleBytes).toString('utf8')).toBe('signed-counter-v1');
    expect(resolution.serverEntryBytes).toBeNull();
    expect(resolution.functionDescriptors).toEqual([]);
    expect(catalog.isRuntimeResolutionCurrent(resolution)).toBe(true);
  });

  test('validates only manifest-owned resource references before placement', async () => {
    const root = await widgetsRoot();
    await Promise.all([
      writePublication(root, manifest('missing-link', { requiredResource: true }), 'signed-missing'),
      writePublication(root, manifest('records', {
        requiredResource: true,
        resourceId: 'resource-a',
      }), 'signed-records'),
    ]);
    const resourceReads: string[] = [];
    const catalog = new WidgetFilesystemRuntimeCatalog({
      widgetsRoot: root,
      capsule,
      resources: {
        async getResource(resourceId) {
          resourceReads.push(resourceId);
          return { id: resourceId, kind: 'db', status: 'ready' };
        },
      },
    });
    await catalog.start();
    const references = Object.fromEntries(catalog.publishedReferences().map((reference) => (
      [reference.widgetKey, reference]
    )));

    await expect(catalog.resolvePlacement({ reference: references['missing-link']! }))
      .rejects.toMatchObject({ code: 'WIDGET_RESOURCE_BINDING_REQUIRED' });
    await expect(catalog.resolvePlacement({ reference: references.records! })).resolves.toEqual({
      kind: 'published',
      reference: references.records,
      widgetKey: 'records',
      catalogGeneration: catalog.current().generation,
      bounds: { width: 480, height: 320 },
    });
    expect(resourceReads).toEqual(['resource-a']);
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
    expect((await catalog.resolvePlacement({ reference })).widgetKey).toBe('fragile');

    await catalog.refresh();
    expect(catalog.publishedReferences()).toEqual([]);
    await expect(catalog.resolvePlacement({
      reference: { ...reference, catalogGeneration: catalog.current().generation },
    })).rejects.toThrow('missing or unhealthy');
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
    await expect(catalog.resolvePlacement({ reference: oldReference }))
      .rejects.toThrow('generation changed');
    const newReference = catalog.publishedReferences()[0]!;
    const next = await catalog.resolveRuntime('live');
    expect(Buffer.from(next.capsuleBytes).toString('utf8')).toBe('signed-live-v2');
    expect(events).toEqual([
      {
        previousGeneration: null,
        generation: 1,
        changedWidgetKeys: ['live'],
        previewWidgetKeys: [],
      },
      {
        previousGeneration: 1,
        generation: 2,
        changedWidgetKeys: ['live'],
        previewWidgetKeys: [],
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
      previewWidgetKeys: [],
    }]);
    expect(catalog.publishedReferences()).toEqual([
      { source: 'published', widgetKey: 'first', catalogGeneration: 2 },
      { source: 'published', widgetKey: 'second', catalogGeneration: 2 },
    ]);
  });

  test('publishes accepted build changes as Preview-only events', async () => {
    const root = await widgetsRoot();
    await writePublication(root, manifest('live'), 'signed-live');
    const catalog = new WidgetFilesystemRuntimeCatalog({ widgetsRoot: root, capsule });
    await catalog.start();
    const events: unknown[] = [];
    catalog.subscribe((event) => events.push(event));

    catalog.notifyBuildGenerationChanged('live');

    expect(events).toEqual([{
      previousGeneration: 1,
      generation: 2,
      changedWidgetKeys: [],
      previewWidgetKeys: ['live'],
    }]);
  });
});
