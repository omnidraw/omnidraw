import { describe, expect, test } from 'bun:test';
import type { IResourceUseCoordinator } from '#backend/shell/resources';
import type {
  ILocalResourceProvider,
  TDatabaseFactory,
} from '#backend/shell/resources/local';
import { DEFAULT_OSS_CELL_ID } from '#backend/shell/database/CONSTANTS';
import { DbServiceTurso } from '#backend/shell/database/DbServiceTurso/DbServiceTurso';
import { Database } from '#backend/shell/database/DbServiceTurso/turso-native';
import { ResourceControlStoreTurso } from '#backend/shell/database/ResourceControlStoreTurso';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceManagementProvider } from '../src/shell/resources/ResourceManagementProvider';
import { ResourceService } from '../src/shell/resources/ResourceService';

const placement = Object.freeze({
  cellId: DEFAULT_OSS_CELL_ID,
  placementEpoch: 1,
});

const useCoordinator: IResourceUseCoordinator = {
  inspect: async (resourceId) => ({ resourceId, uses: [] }),
  drain: async (request) => ({
    ok: true,
    lease: {
      resourceId: request.resourceId,
      leaseId: 'empty-use-lease',
      leaseEpoch: 1,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      drainedUses: [],
    },
  }),
  release: async (lease, mode) => ({
    resourceId: lease.resourceId,
    released: true,
    mode,
    resumedUseIds: [],
  }),
};

function resourceWorld(databaseFactory?: TDatabaseFactory) {
  let sequence = 0;
  return {
    crypto: {
      randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    },
    randomBytes: (length: number) => new Uint8Array(length).fill(7),
    databaseFactory: databaseFactory
      ?? ((databasePath: string, options: ConstructorParameters<typeof Database>[1]) => (
        new Database(databasePath, options)
      )),
    nowMs: Date.now,
    scheduleIdleSweep: (callback: () => void | Promise<void>, delayMs: number) => {
      const timer = setTimeout(() => { void callback(); }, delayMs);
      return () => clearTimeout(timer);
    },
  };
}

describe('ResourceService lifecycle', () => {
  test('forwards direct provider calls without receipt or recovery seams', async () => {
    const calls: string[] = [];
    const provider: ILocalResourceProvider = {
      kind: 'kv',
      effect: () => 'write',
      dispatch: async (_context, operation) => {
        calls.push(`dispatch:${operation}`);
        return { revision: 1 };
      },
      provision: async () => undefined,
      delete: async () => undefined,
    };
    const adapter = new ResourceManagementProvider({
      provider,
      effects: {},
      dispatch: async () => { throw new Error('Management dispatch is not expected.'); },
    });
    const resource = { id: 'resource-a', kind: 'kv' as const };
    const output = await adapter.dispatch(
      {
        resource,
        requirement: { kind: 'kv', required: true, scope: ['write'] },
        canRead: false,
        canWrite: true,
      },
      'set',
      { key: 'theme', value: 'dark' },
    );
    expect(output).toEqual({ revision: 1 });
    expect(calls).toEqual(['dispatch:set']);
    expect('dispatchWithReceipt' in adapter).toBe(false);
    expect('readCommittedOperation' in adapter).toBe(false);
  });

  test('drains a queued management write before provider shutdown and restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-resource-service-lifecycle-'));
    const dbService = new DbServiceTurso({
      applicationVersion: 'test',
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    let releaseWrite!: () => void;
    let markWriteStarted!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    let heldWrite = false;
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const prepare = database.prepare.bind(database);
      database.prepare = async (...args) => {
        const statement = await prepare(...args);
        if (!heldWrite && String(args[0]).includes('INSERT INTO resource_entries (key, value)')) {
          const run = statement.run.bind(statement);
          statement.run = async (...runArgs) => {
            heldWrite = true;
            markWriteStarted();
            await writeGate;
            return run(...runArgs);
          };
        }
        return statement;
      };
      return database;
    };

    let service: ResourceService | null = null;
    let successor: ResourceService | null = null;
    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      const createService = (factory?: TDatabaseFactory) => new ResourceService({
        ...resourceWorld(factory),
        placement,
        db: dbService,
        controlStore,
        dataRoot: root,
        useCoordinator,
      });
      service = createService(databaseFactory);
      await service.start({ config: {}, hooks: {} });
      const resource = await service.createResource({ kind: 'kv', name: 'Held write' });
      await expect(controlStore.getPlacement(resource.id)).resolves.toMatchObject({
        resourceId: resource.id,
        cellId: placement.cellId,
        placementEpoch: placement.placementEpoch,
        status: 'active',
      });
      const write = service.setResourceDataEntry({
        resourceId: resource.id,
        key: 'status',
        expectedRevision: null,
        value: 'committed-before-close',
      });
      await writeStarted;
      const rename = service.renameResource({
        id: resource.id,
        name: 'Renamed while queued',
      });
      // Let the rename enter the Store's write lane behind the held write.
      await Bun.sleep(20);
      let stopSettled = false;
      const stopping = service.stop().finally(() => { stopSettled = true; });
      await Promise.resolve();
      expect(stopSettled).toBe(false);

      releaseWrite();
      await expect(write).resolves.toMatchObject({
        kind: 'kv',
        entry: { key: 'status', revision: 1 },
      });
      await expect(rename).resolves.toMatchObject({
        id: resource.id,
        name: 'Renamed while queued',
      });
      await stopping;

      successor = createService();
      await successor.start({ config: {}, hooks: {} });
      await expect(successor.getResource(resource.id)).resolves.toMatchObject({
        id: resource.id,
        name: 'Renamed while queued',
      });
    } finally {
      releaseWrite?.();
      await successor?.stop().catch(() => undefined);
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('serializes API writes in the Resource Store lane before provider dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-resource-service-write-lane-'));
    const dbService = new DbServiceTurso({ applicationVersion: 'test', databasePath: ':memory:', dataDir: root, cacheDir: root });
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    let writeRuns = 0;
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const prepare = database.prepare.bind(database);
      database.prepare = async (...args) => {
        const statement = await prepare(...args);
        if (
          String(args[0]).includes('INSERT INTO resource_entries (key, value)')
          || String(args[0]).includes('UPDATE resource_entries')
        ) {
          const run = statement.run.bind(statement);
          statement.run = async (...runArgs) => {
            writeRuns += 1;
            if (writeRuns === 1) {
              markFirstStarted();
              await firstGate;
            }
            return run(...runArgs);
          };
        }
        return statement;
      };
      return database;
    };
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      service = new ResourceService({
        ...resourceWorld(databaseFactory),
        placement,
        db: dbService,
        controlStore: new ResourceControlStoreTurso(dbService.db),
        dataRoot: root,
        useCoordinator,
      });
      await service.start({ config: {}, hooks: {} });
      const resource = await service.createResource({ kind: 'kv', name: 'Serialized writes' });
      const first = service.setResourceDataEntry({
        resourceId: resource.id,
        key: 'status',
        expectedRevision: null,
        value: 'first',
      });
      await firstStarted;
      const second = service.setResourceDataEntry({
        resourceId: resource.id,
        key: 'status',
        expectedRevision: 1,
        value: 'second',
      });
      await Bun.sleep(20);
      expect(writeRuns).toBe(1);

      releaseFirst();
      await expect(first).resolves.toMatchObject({ entry: { revision: 1 } });
      await expect(second).resolves.toMatchObject({ entry: { revision: 2 } });
      expect(writeRuns).toBe(2);
    } finally {
      releaseFirst?.();
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fences every data, lifecycle, apply, restore, and delete operation on stale placement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-resource-service-stale-management-'));
    const dbService = new DbServiceTurso({
      applicationVersion: 'test',
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      service = new ResourceService({
        ...resourceWorld(),
        placement,
        db: dbService,
        controlStore,
        dataRoot: root,
        useCoordinator,
      });
      await service.start({ config: {}, hooks: {} });
      const kv = await service.createResource({ kind: 'kv', name: 'Stale KV' });
      const secrets = await service.createResource({ kind: 'secretStore', name: 'Stale secrets' });
      const database = await service.createResource({ kind: 'db', name: 'Stale database' });
      await service.setResourceDataEntry({
        resourceId: kv.id,
        key: 'theme',
        expectedRevision: null,
        value: 'dark',
      });
      await service.setResourceDataEntry({
        resourceId: secrets.id,
        key: 'token',
        expectedRevision: null,
        value: 'never-read-stale',
      });
      const draft = await service.createDbDraft(database.id, 'Stale apply draft');

      for (const resource of [kv, secrets, database]) {
        const current = await controlStore.getPlacement(resource.id);
        expect(current).not.toBeNull();
        await controlStore.updatePlacement({
          resourceId: resource.id,
          expectedEpoch: current!.placementEpoch,
          placementEpoch: current!.placementEpoch + 1,
          cellId: current!.cellId,
          storageKey: current!.storageKey,
          status: 'active',
        });
      }

      await expect(service.listResourceData({ resourceId: kv.id }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.setResourceDataEntry({
        resourceId: kv.id,
        key: 'theme',
        expectedRevision: 1,
        value: 'light',
      })).rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.revealSecret({ resourceId: secrets.id, name: 'token' }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.inspectDbResource({ resourceId: database.id, target: 'live' }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.listDbApplies({ resourceId: database.id }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.confirmDbApply(draft.draft.id))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.restoreDbBackup(database.id, 'missing-apply'))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.deleteResource(kv.id))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });

      for (const resource of [kv, secrets, database]) {
        const current = await controlStore.getPlacement(resource.id);
        await controlStore.updatePlacement({
          resourceId: resource.id,
          expectedEpoch: current!.placementEpoch,
          placementEpoch: placement.placementEpoch,
          cellId: current!.cellId,
          storageKey: current!.storageKey,
          status: 'active',
        });
      }
      await expect(service.getResourceDataEntry({ resourceId: kv.id, key: 'theme' }))
        .resolves.toMatchObject({ value: 'dark', revision: 1 });
      await expect(service.getDbDraft(draft.draft.id))
        .resolves.toMatchObject({ draft: { status: 'editing' } });
      await expect(service.getResource(kv.id)).resolves.toMatchObject({ id: kv.id });
    } finally {
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps apply and restore status reads observable while active uses drain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-resource-service-migration-status-'));
    const dbService = new DbServiceTurso({
      applicationVersion: 'test',
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    let releaseDrain!: () => void;
    let markDrainStarted!: () => void;
    const drainGate = new Promise<void>((resolve) => { releaseDrain = resolve; });
    const drainStarted = new Promise<void>((resolve) => { markDrainStarted = resolve; });
    const blockingUseCoordinator: IResourceUseCoordinator = {
      inspect: useCoordinator.inspect,
      drain: async (request) => {
        markDrainStarted();
        await drainGate;
        return useCoordinator.drain(request);
      },
      release: useCoordinator.release,
    };
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      service = new ResourceService({
        ...resourceWorld(),
        placement,
        db: dbService,
        controlStore,
        dataRoot: root,
        useCoordinator: blockingUseCoordinator,
      });
      await service.start({ config: {}, hooks: {} });
      const database = await service.createResource({
        kind: 'db',
        name: 'Observable migration status',
      });
      const draft = await service.createDbDraft(database.id, 'Observable apply');
      const apply = await service.confirmDbApply(draft.draft.id);

      await drainStarted;
      await expect(controlStore.getResource(database.id)).resolves.toMatchObject({
        status: 'ready',
      });
      await expect(service.getDbApply(apply.id)).resolves.toMatchObject({
        apply: { id: apply.id },
      });
      await expect(service.listDbApplies({ resourceId: database.id })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: apply.id })]),
      );
      await expect(service.getDbRestoreStatus(apply.id)).resolves.toMatchObject({
        apply: { id: apply.id },
      });

      releaseDrain();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const status = (await service.getDbApply(apply.id)).apply.status;
        if (['succeeded', 'failed', 'recovered'].includes(status)) break;
        await Bun.sleep(10);
      }
      await expect(service.getDbApply(apply.id)).resolves.toMatchObject({
        apply: { status: 'succeeded' },
      });
    } finally {
      releaseDrain();
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reveals secrets only through the host management lane', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-resource-service-reveal-'));
    const dbService = new DbServiceTurso({
      applicationVersion: 'test',
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      service = new ResourceService({
        ...resourceWorld(),
        placement,
        db: dbService,
        controlStore: new ResourceControlStoreTurso(dbService.db),
        dataRoot: root,
        useCoordinator,
      });
      await service.start({ config: {}, hooks: {} });
      const secrets = await service.createResource({ kind: 'secretStore', name: 'Reveal secrets' });
      const kv = await service.createResource({ kind: 'kv', name: 'Reveal KV' });
      await service.setResourceDataEntry({
        resourceId: secrets.id,
        key: 'token',
        expectedRevision: null,
        value: 'host-only-secret',
      });

      await expect(service.revealSecret({ resourceId: secrets.id, name: 'token' }))
        .resolves.toMatchObject({ value: 'host-only-secret', revision: 1 });
      await expect(service.revealSecret({ resourceId: kv.id, name: 'token' }))
        .rejects.toMatchObject({ code: 'RESOURCE_KIND_MISMATCH' });
    } finally {
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('retains failed provider cleanup and retries it on the next stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-resource-service-close-failure-'));
    const dbService = new DbServiceTurso({
      applicationVersion: 'test',
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    let failClose = false;
    let failingResourceId: string | null = null;
    let closeAttempts = 0;
    const failingFactory: TDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const close = database.close.bind(database);
      database.close = async () => {
        closeAttempts += 1;
        if (failClose && failingResourceId && databasePath.includes(failingResourceId)) {
          throw new Error('injected provider close failure');
        }
        await close();
      };
      return database;
    };
    let service: ResourceService | null = null;
    let successor: ResourceService | null = null;
    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      const createService = (databaseFactory?: TDatabaseFactory) => new ResourceService({
        ...resourceWorld(databaseFactory),
        placement,
        db: dbService,
        controlStore,
        dataRoot: root,
        useCoordinator,
      });
      service = createService(failingFactory);
      await service.start({ config: {}, hooks: {} });
      const resource = await service.createResource({ kind: 'kv', name: 'Close failure KV' });
      failingResourceId = resource.id;
      await service.setResourceDataEntry({
        resourceId: resource.id,
        key: 'status',
        expectedRevision: null,
        value: 'open-handle',
      });

      closeAttempts = 0;
      failClose = true;
      await expect(service.stop()).rejects.toBeInstanceOf(AggregateError);
      expect(closeAttempts).toBeGreaterThan(0);
      await expect(service.start({ config: {}, hooks: {} })).rejects.toMatchObject({
        code: 'RESOURCE_LIFECYCLE_CONFLICT',
      });

      failClose = false;
      await service.stop();
      successor = createService();
      await successor.start({ config: {}, hooks: {} });
      await expect(successor.getResource(resource.id)).resolves.toMatchObject({
        id: resource.id,
        status: 'ready',
      });
    } finally {
      failClose = false;
      await successor?.stop().catch(() => undefined);
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
