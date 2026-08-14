import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  rm,
  symlink,
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
  fnSerializePublicationWriterLock,
  type TWidgetCatalogCapsuleInspectionEffects,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import { WidgetFilesystemRuntimeCatalog } from '../src/shell/widget/WidgetFilesystemRuntimeCatalog';

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

async function writePublication(root: string, value: TWidgetManifestV1): Promise<void> {
  const path = join(root, 'published', value.slug);
  const distribution = new Uint8Array(Buffer.from('export default 1;\n', 'utf8'));
  const capsuleBytes = new Uint8Array(Buffer.from('signed capsule bytes', 'utf8'));
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
        byteSize: distribution.byteLength,
        sha256: sha256(distribution),
      },
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
  await mkdir(join(path, 'dist'), { recursive: true });
  await Promise.all([
    writeFile(join(path, 'omnidraw.json'), JSON.stringify(value)),
    writeFile(join(path, 'capsule.artifact'), capsuleBytes),
    writeFile(join(path, 'dist', 'main.js'), distribution),
    writeFile(join(path, 'release.json'), JSON.stringify(release)),
  ]);
}

async function pathExists(path: string): Promise<boolean> {
  return await lstat(path).then(() => true, () => false);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('WidgetFilesystemRuntimeCatalog management', () => {
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

  test('deletes only a confirmed draft and preserves its publication', async () => {
    const root = await createWidgetsRoot();
    const value = manifest('Notes Board');
    await Promise.all([writeDraft(root, value), writePublication(root, value)]);
    const removedPlacements: string[] = [];
    const removedMounts: string[] = [];
    const retired: string[] = [];
    let operation = 0;
    const catalog = new WidgetFilesystemRuntimeCatalog({
      ...catalogWorld(),
      widgetsRoot: root,
      capsule,
      management: {
        builder: { close: async () => undefined } as unknown as WidgetFilesystemBuildService,
        acceptedBuild: { async requireCurrent() { throw new Error('unused'); } },
        createOperationToken: () => `delete_${++operation}`,
        deletion: {
          async observe() {
            return {
              placements: [{
                canvasId: 'canvas-a',
                itemId: 'preview-a',
                itemRevision: 1,
                createdAtSec: '1',
                instanceId: 'preview-instance-a',
                type: 'widget-preview',
              }],
              mounts: [
                { chatId: 'chat-a', name: 'notes-board', relativePath: 'chats/chat-a/workspace/widgets/notes-board', linkTarget: '../../../../../widgets/drafts/notes-board' },
                { chatId: 'chat-b', name: 'notes-board', relativePath: 'chats/chat-b/workspace/widgets/notes-board', linkTarget: '../../../../../widgets/drafts/notes-board' },
              ],
            };
          },
          async retireDraft(widgetKey) { retired.push(widgetKey); },
          async removePlacement({ placement }) { removedPlacements.push(placement.itemId); },
          async removeMount({ mount }) { removedMounts.push(mount.chatId); },
        },
      },
    });
    await catalog.start();
    const events: string[][] = [];
    catalog.subscribe((event) => events.push([...event.changedWidgetKeys]));

    const plan = await catalog.planDeletion({ widgetKey: 'notes-board', source: 'draft' });
    expect(plan).toMatchObject({
      source: 'draft',
      pairedDraftPresent: false,
      placementCount: 1,
      previewPlacementCount: 1,
      publishedPlacementCount: 0,
      chatMountCount: 2,
      resourcesPreserved: true,
    });
    const result = await catalog.commitDeletion({
      planToken: plan.planToken,
      operationId: 'human_operation_1',
    });
    expect(result).toMatchObject({
      status: 'committed',
      source: 'draft',
      removedPlacementCount: 1,
      removedChatMountCount: 2,
      resourcesPreserved: true,
    });
    expect(await catalog.commitDeletion({
      planToken: plan.planToken,
      operationId: 'human_operation_1',
    })).toEqual(result);
    expect(await pathExists(join(root, 'drafts', 'notes-board'))).toBe(false);
    expect(await pathExists(join(root, 'published', 'notes-board'))).toBe(true);
    expect(retired).toEqual(['notes-board']);
    expect(removedPlacements).toEqual(['preview-a']);
    expect(removedMounts.sort()).toEqual(['chat-a', 'chat-b']);
    expect(events).toEqual([['notes-board']]);
    await catalog.stop();
  });

  test('fences stale plans and recovers unhealthy published deletion forward after cleanup failure', async () => {
    const root = await createWidgetsRoot();
    const value = manifest('Notes Board');
    await Promise.all([writeDraft(root, value), writePublication(root, value)]);
    await writeFile(join(root, 'published', 'notes-board', 'omnidraw.json'), '{invalid');
    const placements = [
      { canvasId: 'canvas-a', itemId: 'widget-a', itemRevision: 1, createdAtSec: '1', instanceId: 'instance-a', type: 'widget-instance' as const },
      { canvasId: 'canvas-b', itemId: 'widget-b', itemRevision: 4, createdAtSec: '2', instanceId: 'instance-b', type: 'widget-instance' as const },
    ];
    let operation = 0;
    let failOnce = true;
    const removed: string[] = [];
    const management = () => ({
      builder: { close: async () => undefined } as unknown as WidgetFilesystemBuildService,
      acceptedBuild: { async requireCurrent() { throw new Error('unused'); } },
      createOperationToken: () => `delete_${++operation}`,
      deletion: {
        async observe() { return { placements, mounts: [] }; },
        async retireDraft() { /* accepted state retired before placement cleanup */ },
        async removePlacement({ placement }: { placement: typeof placements[number] }) {
          if (failOnce) {
            failOnce = false;
            throw new Error('simulated Canvas outage');
          }
          removed.push(placement.itemId);
        },
        async removeMount() { /* no mounts */ },
      },
    });
    const first = new WidgetFilesystemRuntimeCatalog({
      ...catalogWorld(), widgetsRoot: root, capsule, management: management(),
    });
    await first.start();
    expect(first.current().entries['notes-board']?.published?.health).toBe('unhealthy');
    const stale = await first.planDeletion({ widgetKey: 'notes-board', source: 'published' });
    await writeFile(join(root, 'drafts', 'notes-board', 'ui', 'main.ts'), 'export default 2;\n');
    await expect(first.commitDeletion({
      planToken: stale.planToken,
      operationId: 'human_operation_stale',
    })).rejects.toMatchObject({ code: 'WIDGET_DELETION_STALE_PLAN' });
    expect(await pathExists(join(root, 'published', 'notes-board'))).toBe(true);
    expect(await pathExists(join(root, 'drafts', 'notes-board'))).toBe(true);

    const plan = await first.planDeletion({ widgetKey: 'notes-board', source: 'published' });
    expect(plan).toMatchObject({ pairedDraftPresent: true, placementCount: 2 });
    await expect(first.commitDeletion({
      planToken: plan.planToken,
      operationId: 'human_operation_recovery',
    })).rejects.toMatchObject({ code: 'WIDGET_DELETION_RECOVERY_PENDING' });
    expect(await pathExists(join(root, 'published', 'notes-board'))).toBe(false);
    expect(await pathExists(join(root, 'drafts', 'notes-board'))).toBe(false);
    await first.stop();
    await writeFile(
      join(
        root,
        '.staging',
        `notes-board.${plan.planToken}.deletion.json.update-human_operation_recovery`,
      ),
      '{}\n',
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      join(root, '.writer.lock'),
      fnSerializePublicationWriterLock('human_operation_recovery', 'delete'),
      { flag: 'wx', mode: 0o600 },
    );

    const restarted = new WidgetFilesystemRuntimeCatalog({
      ...catalogWorld(), widgetsRoot: root, capsule, management: management(),
    });
    await restarted.start();
    await restarted.recoverDeletions();
    expect(await pathExists(join(root, '.writer.lock'))).toBe(false);
    expect(removed.sort()).toEqual(['widget-a', 'widget-b']);
    expect(restarted.current().entries['notes-board']).toBeUndefined();
    const receipt = await restarted.commitDeletion({
      planToken: plan.planToken,
      operationId: 'human_operation_recovery',
    });
    expect(receipt).toMatchObject({ status: 'committed', removedPlacementCount: 2 });
    await expect(restarted.commitDeletion({
      planToken: plan.planToken,
      operationId: 'different_operation',
    })).rejects.toMatchObject({ code: 'WIDGET_DELETION_STALE_PLAN' });
    await restarted.stop();
  });

  test('rejects an escaping symlink before mutation', async () => {
    const root = await createWidgetsRoot();
    const value = manifest('Notes Board');
    await writeDraft(root, value);
    await symlink(
      join(root, 'published'),
      join(root, 'drafts', 'notes-board', 'escaped-publications'),
      'dir',
    );
    let operation = 0;
    const create = () => new WidgetFilesystemRuntimeCatalog({
      ...catalogWorld(),
      widgetsRoot: root,
      capsule,
      management: {
        builder: { close: async () => undefined } as unknown as WidgetFilesystemBuildService,
        acceptedBuild: { async requireCurrent() { throw new Error('unused'); } },
        createOperationToken: () => `delete_${++operation}`,
        deletion: {
          async observe() { return { placements: [], mounts: [] }; },
          async retireDraft() { /* must not run */ },
          async removePlacement() { /* must not run */ },
          async removeMount() { /* must not run */ },
        },
      },
    });
    const symlinkCatalog = create();
    await symlinkCatalog.start();
    await expect(symlinkCatalog.planDeletion({
      widgetKey: 'notes-board', source: 'draft',
    })).rejects.toMatchObject({ code: 'WIDGET_DELETION_UNSAFE_PATH' });
    expect(await pathExists(join(root, 'drafts', 'notes-board'))).toBe(true);
    await symlinkCatalog.stop();
  });

  test('discards an unmutated journal when cleanup drifts at the write barrier', async () => {
    const root = await createWidgetsRoot();
    await writeDraft(root, manifest('Notes Board'));
    let observations = 0;
    const catalog = new WidgetFilesystemRuntimeCatalog({
      ...catalogWorld(),
      widgetsRoot: root,
      capsule,
      management: {
        builder: { close: async () => undefined } as unknown as WidgetFilesystemBuildService,
        acceptedBuild: { async requireCurrent() { throw new Error('unused'); } },
        createOperationToken: () => 'late_drift_plan',
        deletion: {
          async observe() {
            observations += 1;
            return {
              placements: observations < 3 ? [] : [{
                canvasId: 'canvas-late', itemId: 'preview-late', itemRevision: 1,
                createdAtSec: 'late', instanceId: 'preview-late', type: 'widget-preview',
              }],
              mounts: [],
            };
          },
          async retireDraft() { throw new Error('must not retire'); },
          async removePlacement() { throw new Error('must not remove'); },
          async removeMount() { throw new Error('must not remove'); },
        },
      },
    });
    await catalog.start();
    const plan = await catalog.planDeletion({ widgetKey: 'notes-board', source: 'draft' });
    await expect(catalog.commitDeletion({
      planToken: plan.planToken,
      operationId: 'late_drift_operation',
    })).rejects.toMatchObject({ code: 'WIDGET_DELETION_STALE_PLAN' });
    expect(await pathExists(join(root, 'drafts', 'notes-board'))).toBe(true);
    expect(await pathExists(join(
      root,
      '.staging',
      `notes-board.${plan.planToken}.deletion.json`,
    ))).toBe(false);
    await catalog.stop();
  });
});
