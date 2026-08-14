import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TWidgetRuntimeDescriptor,
  TWidgetManifestV1,
} from '@omnidraw/sdk/contract';
import {
  fnCreateWidgetReleaseDescriptor,
  fnWidgetExecutableManifestDigest,
} from '@omnidraw/sdk/contract';
import {
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  PublicationReadWriteBarrier,
  type TWidgetCatalogCapsuleInspectionEffects,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import { WidgetFilesystemRuntimeCatalog } from '../src/shell/widget/WidgetFilesystemRuntimeCatalog';
import { WidgetSourceSnapshot } from '../src/shell/widget-domain/local/WidgetSourceSnapshot';

const temporaryRoots: string[] = [];

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function manifest(name: string): TWidgetManifestV1 {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name,
    slug: 'notes-board',
    description: `${name} description`,
    tool: {
      label: name,
      group: 'notes',
      priority: 10,
    },
    ui: {
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: ['DOM'],
    },
  };
}

function runtime(artifactHash: `sha256:${string}`): TWidgetRuntimeDescriptor {
  return {
    format: 'omnidraw.capsule-runtime.v2',
    artifactHash,
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

const capsule: TWidgetCatalogCapsuleInspectionEffects = {
  async inspectCapsuleArtifact(args) {
    return {
      artifactHash: args.expectedRuntime.artifactHash,
      runtime: args.expectedRuntime,
    };
  },
};

function catalogWorld() {
  return {
    filesystem: new NodeWidgetCatalogFilesystem(),
    hash: new NodeWidgetCatalogHash(),
    barrier: new PublicationReadWriteBarrier(),
  };
}

async function createWidgetsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-management-'));
  temporaryRoots.push(root);
  await Promise.all([
    mkdir(join(root, 'drafts')),
    mkdir(join(root, 'published')),
    mkdir(join(root, '.staging')),
    mkdir(join(root, '.preview')),
    mkdir(join(root, '.trash')),
    mkdir(join(root, '.quarantine')),
  ]);
  return root;
}

async function writeDraft(root: string, value: TWidgetManifestV1): Promise<void> {
  const path = join(root, 'drafts', value.slug);
  await mkdir(join(path, 'ui'), { recursive: true });
  await Promise.all([
    writeFile(join(path, 'omnidraw.json'), JSON.stringify(value)),
    writeFile(join(path, 'ui', 'main.ts'), 'export default function mount() {}\n'),
    writeFile(join(path, 'package.json'), '{"private":true}\n'),
  ]);
}

async function writePublication(
  root: string,
  value: TWidgetManifestV1,
  options: Readonly<{ includeSource?: boolean }> = {},
): Promise<void> {
  const path = join(root, 'published', value.slug);
  const distribution = new Uint8Array(Buffer.from('export default 1;\n', 'utf8'));
  const capsuleBytes = new Uint8Array(Buffer.from('signed capsule bytes', 'utf8'));
  const artifactHash = `sha256:${sha256(capsuleBytes)}` as const;
  let sourceArtifactBytes: Uint8Array | null = null;
  if (options.includeSource) {
    const sourceRoot = join(root, '.staging', 'publication-source-fixture');
    await mkdir(join(sourceRoot, 'ui'), { recursive: true });
    await Promise.all([
      writeFile(join(sourceRoot, 'package.json'), '{"private":true}\n'),
      writeFile(join(sourceRoot, 'ui', 'main.ts'), 'export default function mount() {}\n'),
    ]);
    const sourceSnapshots = new WidgetSourceSnapshot({ nowMs: () => 0 });
    const snapshot = await sourceSnapshots.capture(sourceRoot, { createdAtMs: 0 });
    sourceArtifactBytes = sourceSnapshots.encodeArtifact(snapshot, {
      builderIdentity: 'management-test-builder',
    }).bytes;
    await rm(sourceRoot, { recursive: true, force: true });
  }
  const sourceFiles = options.includeSource
    ? [{
        path: 'dist/.omnidraw-authoring-source.artifact',
        bytes: sourceArtifactBytes!,
      }]
    : [];
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
        byteSize: distribution.byteLength,
        sha256: sha256(distribution),
      },
      ...sourceFiles.map((file) => ({
        path: file.path,
        byteSize: file.bytes.byteLength,
        sha256: sha256(file.bytes),
      })),
    ],
    capsule: {
      path: 'capsule.artifact',
      artifactHash,
      runtime: runtime(artifactHash),
    },
    server: null,
    releaseAttestation: {
      algorithm: 'Ed25519',
      keyId: 'release-key',
      signatureBase64: Buffer.alloc(64, 1).toString('base64'),
    },
  });
  await Promise.all([
    mkdir(join(path, 'dist'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(path, 'omnidraw.json'), JSON.stringify(value)),
    writeFile(join(path, 'capsule.artifact'), capsuleBytes),
    writeFile(join(path, 'dist', 'main.js'), distribution),
    writeFile(join(path, 'release.json'), JSON.stringify(release)),
    ...sourceFiles.map((file) => writeFile(join(path, ...file.path.split('/')), file.bytes)),
  ]);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('WidgetFilesystemRuntimeCatalog management', () => {
  test('materializes one exact published source artifact and then preserves the existing draft', async () => {
    const root = await createWidgetsRoot();
    const published = manifest('Notes Board');
    await writePublication(root, published, { includeSource: true });
    const sourceSnapshots = new WidgetSourceSnapshot({ nowMs: () => 0 });
    const builder = {
      async close() {},
      decodePublishedSourceArtifact(bytes: Uint8Array) {
        return sourceSnapshots.decodeArtifact({
          kind: 'source',
          digestSha256: sha256(bytes),
          bytes,
        }).files;
      },
    } as unknown as WidgetFilesystemBuildService;
    let operation = 0;
    const catalog = new WidgetFilesystemRuntimeCatalog({
      ...catalogWorld(),
      widgetsRoot: root,
      capsule,
      management: {
        builder,
        acceptedBuild: {
          async requireCurrent() {
            throw new Error('materialization must not build or publish');
          },
        },
        createOperationToken: () => `materialize_${++operation}`,
      },
    });
    await catalog.start();

    const before = await catalog.agentCatalog();
    expect(before.entries).toEqual([expect.objectContaining({
      widgetKey: 'notes-board',
      displayName: 'Notes Board',
      hasDraft: false,
      hasPublished: true,
      publishedHealth: 'healthy',
    })]);
    const first = await catalog.ensureAgentEditableDraft({ name: 'Notes Board' });
    expect(first).toMatchObject({
      widgetKey: 'notes-board',
      displayName: 'Notes Board',
      sourceDecision: 'materialized-publication',
      materialized: true,
    });
    expect(await readFile(
      join(root, 'drafts', 'notes-board', 'ui', 'main.ts'),
      'utf8',
    )).toBe('export default function mount() {}\n');
    await expect(catalog.assertAgentEditableDraftCurrent(first)).resolves.toBeUndefined();

    const second = await catalog.ensureAgentEditableDraft({ name: 'notes-board' });
    expect(second).toMatchObject({
      sourceDecision: 'existing-draft',
      materialized: false,
      treeDigestSha256: first.treeDigestSha256,
    });

    await writeFile(join(root, 'drafts', 'notes-board', 'omnidraw.json'), '{}');
    await expect(catalog.ensureAgentEditableDraft({ name: 'notes-board' }))
      .rejects.toMatchObject({ code: 'WIDGET_DRAFT_UNHEALTHY' });
    await catalog.stop();
  });

  test('fails closed when the publication changes during source materialization', async () => {
    const root = await createWidgetsRoot();
    const published = manifest('Notes Board');
    await writePublication(root, published, { includeSource: true });
    const filesystem = new NodeWidgetCatalogFilesystem();
    const originalReadFile = filesystem.readFile.bind(filesystem);
    let armed = false;
    let armedSourceReads = 0;
    filesystem.readFile = async (...args: Parameters<NodeWidgetCatalogFilesystem['readFile']>) => {
      const bytes = await originalReadFile(...args);
      if (
        armed
        && args[1].relativePath.endsWith('dist/.omnidraw-authoring-source.artifact')
      ) {
        armedSourceReads += 1;
        if (armedSourceReads === 2) {
          armed = false;
          await writeFile(
            join(root, 'published', 'notes-board', 'dist', '.omnidraw-authoring-source.artifact'),
            'changed source artifact',
          );
        }
      }
      return bytes;
    };
    const sourceSnapshots = new WidgetSourceSnapshot({ nowMs: () => 0 });
    const builder = {
      async close() {},
      decodePublishedSourceArtifact(bytes: Uint8Array) {
        return sourceSnapshots.decodeArtifact({
          kind: 'source',
          digestSha256: sha256(bytes),
          bytes,
        }).files;
      },
    } as unknown as WidgetFilesystemBuildService;
    const catalog = new WidgetFilesystemRuntimeCatalog({
      filesystem,
      hash: new NodeWidgetCatalogHash(),
      barrier: new PublicationReadWriteBarrier(),
      widgetsRoot: root,
      capsule,
      management: {
        builder,
        acceptedBuild: {
          async requireCurrent() {
            throw new Error('materialization must not build or publish');
          },
        },
        createOperationToken: () => 'materialize_race',
      },
    });
    await catalog.start();
    armed = true;

    await expect(catalog.ensureAgentEditableDraft({ name: 'Notes Board' }))
      .rejects.toMatchObject({ code: 'WIDGET_CATALOG_CHANGED' });
    await expect(readFile(join(root, 'drafts', 'notes-board', 'omnidraw.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await catalog.stop();
  });

  test('saves digest-fenced Config and publishes metadata without construction or executable writes', async () => {
    const root = await createWidgetsRoot();
    const initial: TWidgetManifestV1 = {
      ...manifest('Notes Board'),
      resources: [{
        slot: 'notes',
        resourceId: 'resource-a',
        kind: 'db',
        effect: 'read',
      }],
    };
    await Promise.all([writeDraft(root, initial), writePublication(root, initial)]);

    let constructCalls = 0;
    let preparePublicationCalls = 0;
    let closeCalls = 0;
    const builder = {
      async construct() {
        constructCalls += 1;
        throw new Error('metadata publication must not construct a widget');
      },
      async preparePublication() {
        preparePublicationCalls += 1;
        throw new Error('metadata publication must not sign or prepare a release');
      },
      async close() {
        closeCalls += 1;
      },
    } as unknown as WidgetFilesystemBuildService;
    let operation = 0;
    let acceptedBuildCalls = 0;
    const catalog = new WidgetFilesystemRuntimeCatalog({
      ...catalogWorld(),
      widgetsRoot: root,
      capsule,
      management: {
        builder,
        acceptedBuild: {
          async requireCurrent() {
            acceptedBuildCalls += 1;
            throw new Error('metadata publication must not require a new accepted build');
          },
        },
        createOperationToken: () => `test_${++operation}`,
      },
    });
    await catalog.start();
    const events: Array<Readonly<{ changedWidgetKeys: readonly string[] }>> = [];
    catalog.subscribe((event) => events.push(event));

    const initialDraftDigest = catalog.current().entries['notes-board']!.draft!
      .manifestDigestSha256!;
    await catalog.saveDraftConfig({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: initialDraftDigest,
      config: {
        name: 'Renamed Notes',
        description: 'Presentation only.',
        tool: {
          label: 'Renamed Notes',
          icon: { lucidIcon: 'NotebookPen' },
          group: 'writing',
          priority: 25,
        },
      },
    });
    await expect(catalog.saveDraftConfig({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: initialDraftDigest,
      config: {
        name: 'Stale overwrite',
        description: 'This must fail.',
        tool: { label: 'Stale', icon: null, group: null, priority: 0 },
      },
    })).rejects.toMatchObject({ code: 'WIDGET_MANIFEST_CONFLICT' });

    const before = await Promise.all([
      readFile(join(root, 'published', 'notes-board', 'capsule.artifact')),
      readFile(join(root, 'published', 'notes-board', 'dist', 'main.js')),
      readFile(join(root, 'published', 'notes-board', 'release.json')),
    ]);
    const saved = catalog.current();
    const savedEntry = saved.entries['notes-board']!;
    expect(savedEntry.differences.status).toBe('presentation-changed');
    await catalog.publishMetadata({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: savedEntry.draft!.manifestDigestSha256!,
      expectedCatalogDigestSha256: saved.digestSha256,
    });
    const after = await Promise.all([
      readFile(join(root, 'published', 'notes-board', 'capsule.artifact')),
      readFile(join(root, 'published', 'notes-board', 'dist', 'main.js')),
      readFile(join(root, 'published', 'notes-board', 'release.json')),
    ]);

    expect(constructCalls).toBe(0);
    expect(preparePublicationCalls).toBe(0);
    expect(acceptedBuildCalls).toBe(0);
    expect(after.map((value) => value.toString('base64')))
      .toEqual(before.map((value) => value.toString('base64')));
    expect(JSON.parse(await readFile(
      join(root, 'published', 'notes-board', 'omnidraw.json'),
      'utf8',
    ))).toMatchObject({
      name: 'Renamed Notes',
      description: 'Presentation only.',
      tool: { label: 'Renamed Notes', group: 'writing', priority: 25 },
    });
    expect(catalog.current().entries['notes-board']!.differences.status).toBe('matched');
    expect(events.map((event) => event.changedWidgetKeys)).toEqual([
      ['notes-board'],
      ['notes-board'],
    ]);

    const matched = catalog.current();
    const changedBinding = {
      ...matched.entries['notes-board']!.draft!.manifest!,
      resources: [{
        ...matched.entries['notes-board']!.draft!.manifest!.resources![0]!,
        resourceId: 'resource-b',
      }],
    };
    await writeFile(
      join(root, 'drafts', 'notes-board', 'omnidraw.json'),
      JSON.stringify(changedBinding),
    );
    const bindingChanged = await catalog.refresh();
    await expect(catalog.publishMetadata({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: bindingChanged.entries['notes-board']!.draft!
        .manifestDigestSha256!,
      expectedCatalogDigestSha256: bindingChanged.digestSha256,
    })).rejects.toMatchObject({ code: 'WIDGET_BUILD_REQUIRED' });
    await catalog.stop();
    await catalog.stop();
    expect(closeCalls).toBe(1);
  });
});
