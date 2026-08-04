import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connect, type Database } from '@tursodatabase/database';
import type {
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV4,
} from '@omnidraw/widget-contract';
import {
  fnCreateWidgetReleaseDescriptor,
  fnWidgetExecutableManifestDigest,
} from '@omnidraw/widget-contract/filesystem';
import type { TWidgetCatalogCapsuleInspectionPortal } from '@omnidraw/service-agent';
import { CanvasService } from '@omnidraw/service-canvas';
import {
  CanvasItemStoreTurso,
} from '@omnidraw/service-db/CanvasItemStoreTurso';
import {
  WidgetInstanceStateStoreTurso,
} from '@omnidraw/service-db/WidgetInstanceStateStoreTurso';
import { WidgetStateService } from '@omnidraw/service-widget-state';
import {
  fnResolveOmnidrawHome,
} from '@omnidraw/shared-functions/omnidraw-config/fn.resolve-omnidraw-home';
import {
  txEnsureOmnidrawHome,
} from '@omnidraw/shared-functions/omnidraw-config/tx.ensure-omnidraw-home';
import { apiWidgetPlacementResolve } from '../../../packages/api/src/widget/api.placement-resolve';
import { apiWidgetRuntimeLoad } from '../../../packages/api/src/widget/api.runtime-load-widget';
import {
  apiRuntimeWidgetStateChange,
} from '../../../packages/api/src/widget/api.runtime-widget-state-change';
import {
  apiRuntimeWidgetStateGet,
} from '../../../packages/api/src/widget/api.runtime-widget-state-get';
import {
  fnCreatePublishedWidgetNode,
} from '../../../packages/ui-ai-chat/src/canvas-extension/fn.canvas-widget';
import {
  fnWidgetRuntimeIdentityMatches,
  fnWidgetRuntimeLocalTarget,
} from '../../../packages/ui-ai-chat/src/widget-runtime/fn.runtime-identity';
import {
  fxDecodeAndVerifyUiArtifact,
} from '../../../packages/ui-ai-chat/src/widget-runtime/fx.decode-and-verify-ui-artifact';
import { WidgetFilesystemRuntimeCatalog } from '../src/services/WidgetFilesystemRuntimeCatalog';

const temporaryRoots: string[] = [];
const openDatabases: Database[] = [];
const CANVAS_ID = '10000000-0000-4000-8000-000000000001';
const ELEMENT_ID = '20000000-0000-4000-8000-000000000002';
const INSTANCE_ID = '30000000-0000-4000-8000-000000000003';

const releaseAttestation = Object.freeze({
  algorithm: 'Ed25519' as const,
  keyId: 'release-key',
  signatureBase64: Buffer.alloc(64, 1).toString('base64'),
});

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function capsuleRuntime(
  artifactHash: `sha256:${string}`,
): TWidgetCapsuleRuntimeDescriptor {
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

const capsule: TWidgetCatalogCapsuleInspectionPortal = {
  async inspectCapsuleArtifact(args) {
    return {
      artifactHash: args.expectedRuntime.capsuleArtifactHash,
      runtime: args.expectedRuntime,
    };
  },
};

function manifest(): TWidgetManifestV4 {
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v4.json',
    schemaVersion: 4,
    name: 'Counter',
    slug: 'counter',
    description: 'Clean-home filesystem integration fixture.',
    tool: { label: 'Counter', group: 'tests', priority: 0 },
    ui: {
      runtime: 'capsule',
      entry: 'ui/main.ts',
      apis: ['DOM'],
      state: { collaborative: true, localStore: 'none' },
    },
  };
}

async function writePublication(widgetsRoot: string): Promise<string> {
  const publishedPath = join(widgetsRoot, 'published', 'counter');
  const manifestValue = manifest();
  const distBytes = new Uint8Array(Buffer.from('export default 1;', 'utf8'));
  const capsuleBytes = new Uint8Array(Buffer.from('signed-counter-v1', 'utf8'));
  const artifactHash = `sha256:${sha256(capsuleBytes)}` as const;
  const release = fnCreateWidgetReleaseDescriptor({
    executableManifestDigestSha256: fnWidgetExecutableManifestDigest({
      manifest: manifestValue,
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
      runtime: capsuleRuntime(artifactHash),
    },
    server: null,
    releaseAttestation,
  });
  await mkdir(join(publishedPath, 'dist'), { recursive: true });
  await Promise.all([
    writeFile(join(publishedPath, 'omnidraw.json'), JSON.stringify(manifestValue)),
    writeFile(join(publishedPath, 'capsule.artifact'), capsuleBytes),
    writeFile(join(publishedPath, 'dist', 'main.js'), distBytes),
    writeFile(join(publishedPath, 'release.json'), JSON.stringify(release)),
  ]);
  return publishedPath;
}

async function openDatabase(path: string): Promise<Database> {
  const database = await connect(path, {
    experimental: ['custom_types', 'generated_columns'] as never,
  });
  openDatabases.push(database);
  await database.exec('PRAGMA foreign_keys = ON');
  await database.exec('PRAGMA ignore_check_constraints = 0');
  const migration = await Bun.file(new URL(
    '../../../packages/service-db/src/migrations/000-initial.sql',
    import.meta.url,
  )).text();
  await database.exec(migration);
  return database;
}

async function seedCanvas(database: Database): Promise<void> {
  await (await database.prepare(`
    INSERT INTO canvases (id, name) VALUES (?, 'Filesystem E2E')
  `)).run(CANVAS_ID);
}

function runtimeAdmission() {
  return {
    async run<TResult>(
      requestSignal: AbortSignal | undefined,
      operation: (signal: AbortSignal, defer: (cleanup: () => Promise<void>) => void) => Promise<TResult>,
    ): Promise<TResult> {
      const controller = new AbortController();
      if (requestSignal?.aborted) controller.abort(requestSignal.reason);
      return operation(controller.signal, () => undefined);
    },
  };
}

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe('clean-home filesystem widget integration', () => {
  test('loads exact mount inputs and preserves state without turning the database into catalog authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-widget-e2e-'));
    temporaryRoots.push(root);
    const home = fnResolveOmnidrawHome({ join, resolve }, {
      cwd: root,
      homedir: root,
      env: {},
      dataDir: root,
    });
    txEnsureOmnidrawHome({ mkdirSync }, { home });
    const publishedPath = await writePublication(home.widgetsRoot);
    const database = await openDatabase(home.mainDbPath);
    await seedCanvas(database);

    const catalog = new WidgetFilesystemRuntimeCatalog({
      widgetsRoot: home.widgetsRoot,
      capsule,
    });
    await catalog.start();
    const canvas = new CanvasService({
      store: new CanvasItemStoreTurso(database),
    });
    const widgetState = new WidgetStateService(
      new WidgetInstanceStateStoreTurso(database),
    );
    const context = {
      canvas,
      widgetCatalog: catalog,
      widgetState,
      widgetCapsuleHostConfiguration: { read: async () => ({}) },
      widgetRuntimeLoadAdmission: runtimeAdmission(),
    } as never;

    const reference = catalog.publishedReferences()[0]!;
    const resolvePlacement = apiWidgetPlacementResolve.callable({ context });
    const placement = await resolvePlacement({ reference });
    expect(placement).toMatchObject({
      kind: 'published',
      widgetKey: 'counter',
      catalogGeneration: 1,
      resourceBindings: {},
    });

    const runtimeElement = fnCreatePublishedWidgetNode({
      id: ELEMENT_ID,
      parentId: null,
      orderKey: 'a',
      position: { x: 10, y: 20 },
      size: placement.bounds,
      title: 'Counter',
      instanceId: INSTANCE_ID,
      widgetKey: placement.widgetKey,
      resourceBindings: placement.resourceBindings,
    });
    const { portal: _runtimePortal, ...element } = runtimeElement;
    await canvas.execute({
      commandId: 'place-counter',
      canvasId: CANVAS_ID,
      baseRevision: 0,
      operations: [{ type: 'insert', item: element }],
      preconditions: [{ type: 'item-absent', itemId: ELEMENT_ID }],
    });

    const target = fnWidgetRuntimeLocalTarget({ canvasId: CANVAS_ID, element });
    const loadRuntime = apiWidgetRuntimeLoad.callable({ context });
    const loaded = await loadRuntime(target);
    const mountIdentity = Object.freeze({
      ...loaded.identity,
    });
    expect(fnWidgetRuntimeIdentityMatches(mountIdentity, target)).toBe(true);
    const mountArtifact = await fxDecodeAndVerifyUiArtifact({
      codec: {
        decodeBase64: (value) => Buffer.from(value, 'base64'),
        digestSha256: async (value) => sha256(value),
      },
    }, {
      expectedDigestSha256: loaded.artifact.digestSha256,
      expectedCapsuleArtifactHash: loaded.runtimeDescriptor.capsuleArtifactHash,
      bytesBase64: loaded.artifact.bytesBase64,
      runtimeDescriptor: loaded.runtimeDescriptor,
    });
    expect(Buffer.from(mountArtifact.bytes).toString('utf8')).toBe('signed-counter-v1');
    expect(loaded.manifest.ui.state).toEqual({
      collaborative: true,
      localStore: 'none',
    });

    const getState = apiRuntimeWidgetStateGet.callable({ context });
    const changeState = apiRuntimeWidgetStateChange.callable({ context });
    const stateIdentity = {
      canvasId: CANVAS_ID,
      elementId: ELEMENT_ID,
      widgetInstanceId: INSTANCE_ID,
    };
    expect(await getState(stateIdentity)).toMatchObject({
      status: 'found',
      snapshot: { version: 1, state: null },
    });
    expect(await changeState({
      ...stateIdentity,
      expectedVersion: 1,
      state: { count: 1 },
    })).toMatchObject({
      status: 'changed',
      snapshot: { version: 2, state: { count: 1 } },
    });

    widgetState.dispose();
    await canvas.stop();
    await database.close();
    openDatabases.splice(openDatabases.indexOf(database), 1);
    const reopened = await connect(home.mainDbPath, {
      experimental: ['custom_types', 'generated_columns'] as never,
    });
    openDatabases.push(reopened);
    const reopenedCanvas = new CanvasService({
      store: new CanvasItemStoreTurso(reopened),
    });
    const reopenedState = new WidgetStateService(
      new WidgetInstanceStateStoreTurso(reopened),
    );
    const reopenedContext = {
      ...context,
      canvas: reopenedCanvas,
      widgetState: reopenedState,
    } as never;
    const getReopenedState = apiRuntimeWidgetStateGet.callable({
      context: reopenedContext,
    });
    expect(await getReopenedState(stateIdentity)).toMatchObject({
      status: 'found',
      snapshot: { version: 2, state: { count: 1 } },
    });

    await rm(publishedPath, { recursive: true, force: true });
    await catalog.refresh();
    expect(catalog.publishedReferences()).toEqual([]);
    const loadReopenedRuntime = apiWidgetRuntimeLoad.callable({
      context: reopenedContext,
    });
    await expect(loadReopenedRuntime(target)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await getReopenedState(stateIdentity)).toMatchObject({
      status: 'found',
      snapshot: { version: 2, state: { count: 1 } },
    });
    reopenedState.dispose();
    await reopenedCanvas.stop();
  });
});
