import { describe, expect, test } from 'bun:test';
import type { IResourceUseCoordinator } from '@vibecanvas/resource-runtime';
import type {
  ILocalResourceProvider,
  TDatabaseFactory,
} from '@vibecanvas/resource-runtime/local';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import { ResourceControlStoreTurso } from '@vibecanvas/service-db/ResourceControlStoreTurso';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceManagementProvider } from '../src/services/ResourceManagementProvider';
import { ResourceService } from '../src/services/ResourceService';

const tenant: TTenantContext = {
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: '00000000-0000-4000-8000-0000000000c1',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'resource-lifecycle-request',
};

const useCoordinator: IResourceUseCoordinator = {
  inspect: async (_tenant, resourceId) => ({ resourceId, uses: [] }),
  drain: async (_tenant, request) => ({
    ok: true,
    lease: {
      resourceId: request.resourceId,
      leaseId: 'empty-use-lease',
      leaseEpoch: 1,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      drainedUses: [],
    },
  }),
  release: async (_tenant, lease, mode) => ({
    resourceId: lease.resourceId,
    released: true,
    mode,
    resumedUseIds: [],
  }),
};

describe('ResourceService lifecycle', () => {
  test('preserves provider-owned function receipts through the management adapter', async () => {
    const calls: string[] = [];
    const provider: ILocalResourceProvider = {
      kind: 'kv',
      effect: () => 'write',
      dispatch: async () => { throw new Error('Receipt path must not use plain dispatch.'); },
      dispatchWithReceipt: async (_context, operation, _args, identity, guard) => {
        calls.push(`dispatch:${operation}:${identity.operationId}`);
        await guard.assertCanCommit();
        return { output: { revision: 1 }, committed: true, replayed: false };
      },
      readCommittedOperation: async (_resource, request) => {
        calls.push(`read:${request.operationId}`);
        return {
          invocationId: request.invocationId,
          operationId: request.operationId,
          attemptId: 'attempt-a',
          operationName: 'set',
          output: { revision: 1 },
        };
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
    const receipt = await adapter.dispatchWithReceipt(
      {
        tenant,
        resource,
        requirement: { kind: 'kv', required: true, scope: ['write'] },
        canRead: false,
        canWrite: true,
      },
      'set',
      { key: 'theme', value: 'dark' },
      {
        orgId: tenant.orgId,
        resourceId: resource.id,
        invocationId: 'invocation-a',
        attemptId: 'attempt-a',
        operationId: 'operation-a',
      },
      { assertCanCommit: async () => { calls.push('guard'); } },
    );
    expect(receipt).toEqual({
      output: { revision: 1 },
      committed: true,
      replayed: false,
    });
    await expect(adapter.readCommittedOperation(resource, {
      invocationId: 'invocation-a',
      operationId: 'operation-a',
    })).resolves.toMatchObject({
      invocationId: 'invocation-a',
      operationId: 'operation-a',
      operationName: 'set',
      output: { revision: 1 },
    });
    expect(calls).toEqual([
      'dispatch:set:operation-a',
      'guard',
      'read:operation-a',
    ]);
  });

  test('drains a queued management write before provider shutdown and restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-lifecycle-'));
    const dbService = new DbServiceTurso({
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
        tenant,
        db: dbService.forTenant(tenant),
        controlStore,
        dataRoot: root,
        useCoordinator,
        ...(factory ? { databaseFactory: factory } : {}),
      });
      service = createService(databaseFactory);
      await service.start({ config: {}, hooks: {} });
      const resource = await service.createResource(tenant, { kind: 'kv', name: 'Held write' });
      await expect(controlStore.getPlacement(tenant, resource.id)).resolves.toMatchObject({
        resourceId: resource.id,
        cellId: tenant.cellId,
        placementEpoch: tenant.placementEpoch,
        status: 'active',
      });
      const write = service.setResourceDataEntry(tenant, {
        resourceId: resource.id,
        key: 'status',
        expectedRevision: null,
        value: 'committed-before-close',
      });
      await writeStarted;
      const rename = service.renameResource(tenant, {
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
      await expect(successor.getResource(tenant, resource.id)).resolves.toMatchObject({
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
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-write-lane-'));
    const dbService = new DbServiceTurso({ databasePath: ':memory:', dataDir: root, cacheDir: root });
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
        tenant,
        db: dbService.forTenant(tenant),
        controlStore: new ResourceControlStoreTurso(dbService.db),
        dataRoot: root,
        useCoordinator,
        databaseFactory,
      });
      await service.start({ config: {}, hooks: {} });
      const resource = await service.createResource(tenant, { kind: 'kv', name: 'Serialized writes' });
      const first = service.setResourceDataEntry(tenant, {
        resourceId: resource.id,
        key: 'status',
        expectedRevision: null,
        value: 'first',
      });
      await firstStarted;
      const second = service.setResourceDataEntry(tenant, {
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
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-stale-management-'));
    const dbService = new DbServiceTurso({
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      service = new ResourceService({
        tenant,
        db: dbService.forTenant(tenant),
        controlStore,
        dataRoot: root,
        useCoordinator,
      });
      await service.start({ config: {}, hooks: {} });
      const kv = await service.createResource(tenant, { kind: 'kv', name: 'Stale KV' });
      const secrets = await service.createResource(tenant, { kind: 'secretStore', name: 'Stale secrets' });
      const database = await service.createResource(tenant, { kind: 'db', name: 'Stale database' });
      await service.setResourceDataEntry(tenant, {
        resourceId: kv.id,
        key: 'theme',
        expectedRevision: null,
        value: 'dark',
      });
      await service.setResourceDataEntry(tenant, {
        resourceId: secrets.id,
        key: 'token',
        expectedRevision: null,
        value: 'never-read-stale',
      });
      const draft = await service.createDbDraft(tenant, database.id, 'Stale apply draft');

      for (const resource of [kv, secrets, database]) {
        const placement = await controlStore.getPlacement(tenant, resource.id);
        expect(placement).not.toBeNull();
        await controlStore.updatePlacement(tenant, {
          resourceId: resource.id,
          expectedEpoch: placement!.placementEpoch,
          placementEpoch: placement!.placementEpoch,
          cellId: placement!.cellId,
          storageKey: placement!.storageKey,
          status: 'reserved',
          nowMs: Date.now(),
        });
      }

      await expect(service.listResourceData(tenant, { resourceId: kv.id }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.setResourceDataEntry(tenant, {
        resourceId: kv.id,
        key: 'theme',
        expectedRevision: 1,
        value: 'light',
      })).rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.revealSecret(tenant, { resourceId: secrets.id, name: 'token' }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.inspectDbResource(tenant, { resourceId: database.id, target: 'live' }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.listDbApplies(tenant, { resourceId: database.id }))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.confirmDbApply(tenant, draft.draft.id))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.restoreDbBackup(tenant, database.id, 'missing-apply'))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      await expect(service.deleteResource(tenant, kv.id))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });

      for (const resource of [kv, secrets, database]) {
        const placement = await controlStore.getPlacement(tenant, resource.id);
        await controlStore.updatePlacement(tenant, {
          resourceId: resource.id,
          expectedEpoch: placement!.placementEpoch,
          placementEpoch: placement!.placementEpoch,
          cellId: placement!.cellId,
          storageKey: placement!.storageKey,
          status: 'active',
          nowMs: Date.now(),
        });
      }
      await expect(service.getResourceDataEntry(tenant, { resourceId: kv.id, key: 'theme' }))
        .resolves.toMatchObject({ value: 'dark', revision: 1 });
      await expect(service.getDbDraft(tenant, draft.draft.id))
        .resolves.toMatchObject({ draft: { status: 'editing' } });
      await expect(service.getResource(tenant, kv.id)).resolves.toMatchObject({ id: kv.id });
    } finally {
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps apply and restore status reads observable while active uses drain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-migration-status-'));
    const dbService = new DbServiceTurso({
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
      drain: async (context, request) => {
        markDrainStarted();
        await drainGate;
        return useCoordinator.drain(context, request);
      },
      release: useCoordinator.release,
    };
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      service = new ResourceService({
        tenant,
        db: dbService.forTenant(tenant),
        controlStore,
        dataRoot: root,
        useCoordinator: blockingUseCoordinator,
      });
      await service.start({ config: {}, hooks: {} });
      const database = await service.createResource(tenant, {
        kind: 'db',
        name: 'Observable migration status',
      });
      const draft = await service.createDbDraft(tenant, database.id, 'Observable apply');
      const apply = await service.confirmDbApply(tenant, draft.draft.id);

      await drainStarted;
      await expect(controlStore.getResource(tenant, database.id)).resolves.toMatchObject({
        status: 'ready',
      });
      await expect(service.getDbApply(tenant, apply.id)).resolves.toMatchObject({
        apply: { id: apply.id },
      });
      await expect(service.listDbApplies(tenant, { resourceId: database.id })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: apply.id })]),
      );
      await expect(service.getDbRestoreStatus(tenant, apply.id)).resolves.toMatchObject({
        apply: { id: apply.id },
      });

      releaseDrain();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const status = (await service.getDbApply(tenant, apply.id)).apply.status;
        if (['succeeded', 'failed', 'recovered'].includes(status)) break;
        await Bun.sleep(10);
      }
      await expect(service.getDbApply(tenant, apply.id)).resolves.toMatchObject({
        apply: { status: 'succeeded' },
      });
    } finally {
      releaseDrain();
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('preserves request authority across accounts and guards plaintext before provider access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-request-authority-'));
    const dbService = new DbServiceTurso({
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    const seenTenants: TTenantContext[] = [];
    let plaintextReads = 0;
    const databaseFactory: TDatabaseFactory = (databasePath, options) => {
      const database = new Database(databasePath, options);
      const prepare = database.prepare.bind(database);
      database.prepare = async (...args) => {
        if (/SELECT\s+key,\s+value,\s+revision/i.test(String(args[0]))) plaintextReads += 1;
        return prepare(...args);
      };
      return database;
    };
    const authorityCoordinator: IResourceUseCoordinator = {
      inspect: async (context, resourceId) => {
        seenTenants.push(context);
        await Promise.resolve();
        return { resourceId, uses: [] };
      },
      drain: useCoordinator.drain,
      release: useCoordinator.release,
    };
    const accountB: TTenantContext = {
      ...tenant,
      accountId: '00000000-0000-4000-8000-0000000000b2',
      roles: ['admin'],
      capabilities: ['resource:secret:reveal'],
      requestId: 'resource-lifecycle-request-b',
    };
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      service = new ResourceService({
        tenant,
        db: dbService.forTenant(tenant),
        controlStore: new ResourceControlStoreTurso(dbService.db),
        dataRoot: root,
        useCoordinator: authorityCoordinator,
        databaseFactory,
      });
      await service.start({ config: {}, hooks: {} });
      const database = await service.createResource(tenant, { kind: 'db', name: 'Authority database' });
      const secrets = await service.createResource(tenant, { kind: 'secretStore', name: 'Authority secrets' });
      await service.setResourceDataEntry(tenant, {
        resourceId: secrets.id,
        key: 'token',
        expectedRevision: null,
        value: 'request-scoped-secret',
      });

      await Promise.all([
        service.dbResourceImpact(tenant, database.id),
        service.dbResourceImpact(accountB, database.id),
      ]);
      expect(seenTenants.map((context) => ({
        accountId: context.accountId,
        capabilities: context.capabilities,
        requestId: context.requestId,
      }))).toEqual([
        {
          accountId: tenant.accountId,
          capabilities: tenant.capabilities,
          requestId: tenant.requestId,
        },
        {
          accountId: accountB.accountId,
          capabilities: accountB.capabilities,
          requestId: accountB.requestId,
        },
      ]);

      plaintextReads = 0;
      const denied = [
        { ...accountB, roles: ['service'], capabilities: ['*'], requestId: 'service-only' },
        { ...accountB, roles: ['service', 'member'], capabilities: ['*'], requestId: 'mixed-service' },
        { ...accountB, roles: ['member'], capabilities: [], requestId: 'missing-capability' },
      ] satisfies TTenantContext[];
      for (const context of denied) {
        await expect(service.revealSecret(context, { resourceId: secrets.id, name: 'token' }))
          .rejects.toMatchObject({ code: 'RESOURCE_READ_NOT_ALLOWED' });
      }
      expect(plaintextReads).toBe(0);
      await expect(service.revealSecret(accountB, { resourceId: secrets.id, name: 'token' }))
        .resolves.toMatchObject({ value: 'request-scoped-secret', revision: 1 });
      expect(plaintextReads).toBeGreaterThan(0);

      const wrongPlacement = { ...accountB, cellId: 'other-cell', placementEpoch: 2 };
      const before = seenTenants.length;
      await expect(service.dbResourceImpact(wrongPlacement, database.id))
        .rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      expect(seenTenants).toHaveLength(before);
    } finally {
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('retains failed provider cleanup and retries it on the next stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-close-failure-'));
    const dbService = new DbServiceTurso({
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
      const createService = (
        serviceTenant: TTenantContext,
        databaseFactory?: TDatabaseFactory,
      ) => new ResourceService({
        tenant: serviceTenant,
        db: dbService.forTenant(serviceTenant),
        controlStore,
        dataRoot: root,
        useCoordinator,
        ...(databaseFactory ? { databaseFactory } : {}),
      });
      service = createService(tenant, failingFactory);
      await service.start({ config: {}, hooks: {} });
      const resource = await service.createResource(tenant, { kind: 'kv', name: 'Close failure KV' });
      failingResourceId = resource.id;
      await service.setResourceDataEntry(tenant, {
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
      successor = createService(tenant);
      await successor.start({ config: {}, hooks: {} });
      await expect(successor.getResource(tenant, resource.id)).resolves.toMatchObject({
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
