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
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceManagementProvider } from '../src/services/ResourceManagementProvider';
import { ResourceService } from '../src/services/ResourceService';
import { ResourceServicePool } from '../src/services/ResourceServicePool';

const tenant: TTenantContext = {
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: '00000000-0000-4000-8000-0000000000c1',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'resource-owner-request',
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

describe('ResourceService ownership', () => {
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

  test('drains a queued management write before releasing ownership for takeover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-owner-'));
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
        if (!heldWrite && String(args[0]).includes('INSERT INTO actor_resource_entries (key, value)')) {
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

    let owner: ResourceService | null = null;
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
      owner = createService(databaseFactory);
      await owner.start({ config: {}, hooks: {} });
      const consumer = (definitionName: string) => ({
        getVibecanvasJson: (candidate: string) => candidate === definitionName
          ? {
              actor: {
                resources: {
                  preferences: {
                    kind: 'kv' as const,
                    required: true,
                    scope: ['read' as const],
                  },
                },
              },
            }
          : null,
      });
      const detachFirstConsumer = owner.attachConsumer(consumer('definition-a'));
      const detachSecondConsumer = owner.attachConsumer(consumer('definition-b'));
      await expect(owner.getDefinitionResourceStatus(tenant, 'definition-a')).resolves.toHaveLength(1);
      await expect(owner.getDefinitionResourceStatus(tenant, 'definition-b')).resolves.toHaveLength(1);
      detachFirstConsumer();
      await expect(owner.getDefinitionResourceStatus(tenant, 'definition-a')).rejects.toMatchObject({
        code: 'RESOURCE_DEFINITION_NOT_FOUND',
      });
      await expect(owner.getDefinitionResourceStatus(tenant, 'definition-b')).resolves.toHaveLength(1);
      detachSecondConsumer();

      const resource = await owner.createResource(tenant, { kind: 'kv', name: 'Held write' });
      await expect(controlStore.getPlacement(tenant, resource.id)).resolves.toMatchObject({
        resourceId: resource.id,
        cellId: tenant.cellId,
        placementEpoch: tenant.placementEpoch,
        status: 'active',
      });
      const write = owner.setResourceDataEntry(tenant, {
        resourceId: resource.id,
        key: 'status',
        expectedRevision: null,
        value: 'committed-before-close',
      });
      await writeStarted;
      const rename = owner.renameResource(tenant, {
        id: resource.id,
        name: 'Renamed while queued',
      });
      // Let the rename enter the Store's write lane behind the held write.
      await Bun.sleep(20);
      let stopSettled = false;
      const stopping = owner.stop().finally(() => { stopSettled = true; });
      await Promise.resolve();
      expect(stopSettled).toBe(false);

      const competing = createService();
      await expect(competing.start({ config: {}, hooks: {} })).rejects.toMatchObject({
        code: 'RESOURCE_OWNER_CONFLICT',
      });

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
      await owner?.stop().catch(() => undefined);
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
          String(args[0]).includes('INSERT INTO actor_resource_entries (key, value)')
          || String(args[0]).includes('UPDATE actor_resource_entries')
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

  test('does not claim an unplaced resource without explicit migration authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-adopt-'));
    const dbService = new DbServiceTurso({
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    const resourceId = '00000000-0000-4000-8000-000000000011';
    let service: ResourceService | null = null;
    let successor: ResourceService | null = null;
    try {
      await dbService.start();
      const db = dbService.forTenant(tenant);
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      await db.actorResource.create({
        id: resourceId,
        kind: 'db',
        name: 'Legacy database',
        status: 'created',
      });
      await expect(controlStore.getPlacement(tenant, resourceId)).resolves.toBeNull();

      const createService = () => new ResourceService({
        tenant,
        db,
        controlStore,
        dataRoot: root,
        useCoordinator,
      });
      service = createService();
      await service.start({ config: {}, hooks: {} });
      await expect(controlStore.getResource(tenant, resourceId)).resolves.toMatchObject({
        id: resourceId,
        status: 'created',
      });
      await expect(controlStore.getPlacement(tenant, resourceId)).resolves.toBeNull();
      await expect(access(join(root, resourceId, 'data.db'))).rejects.toBeDefined();

      await service.stop();
      service = null;
      successor = createService();
      await successor.start({ config: {}, hooks: {} });
      await expect(successor.getResource(tenant, resourceId)).resolves.toMatchObject({
        id: resourceId,
        status: 'created',
      });
      await expect(controlStore.getPlacement(tenant, resourceId)).resolves.toBeNull();
    } finally {
      await successor?.stop().catch(() => undefined);
      await service?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('routes an exact named database operation through the canonical gateway', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibecanvas-resource-service-gateway-'));
    const dbService = new DbServiceTurso({
      databasePath: ':memory:',
      dataDir: root,
      cacheDir: root,
    });
    let service: ResourceService | null = null;
    try {
      await dbService.start();
      const controlStore = new ResourceControlStoreTurso(dbService.db);
      const db = dbService.forTenant(tenant);
      await db.actor.insertDefinition({
        name: 'settings-widget',
        slug: 'settings-widget',
        url: null,
        description: null,
        manifest_path: 'widgets/settings/vibecanvas.json',
      });
      service = new ResourceService({
        tenant,
        db,
        controlStore,
        dataRoot: root,
        useCoordinator,
      });
      service.attachConsumer({
        getVibecanvasJson: (definitionName) => definitionName === 'settings-widget'
          ? {
              actor: {
                resources: {
                  settings: {
                    kind: 'db',
                    required: true,
                    scope: ['read', 'write'],
                    arbitrarySql: false,
                    operations: {
                      setSetting: {
                        effect: 'write',
                        sql: `
                          INSERT INTO settings (name, value) VALUES (:name, :value)
                          ON CONFLICT(name) DO UPDATE SET value = excluded.value
                        `,
                        parameters: {
                          name: { type: 'string' },
                          value: { type: 'string' },
                        },
                        result: 'execute',
                      },
                      getSetting: {
                        effect: 'read',
                        sql: 'SELECT value FROM settings WHERE name = :name',
                        parameters: { name: { type: 'string' } },
                        result: 'rows',
                      },
                    },
                  },
                },
              },
            }
          : null,
      });
      await service.start({ config: {}, hooks: {} });
      const resource = await service.createResource(tenant, { kind: 'db', name: 'Settings database' });
      await service.executeDbLiveSql(tenant, {
        resourceId: resource.id,
        sql: 'CREATE TABLE settings (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT',
        approved: true,
      });
      await service.bindResource(tenant, {
        definitionName: 'settings-widget',
        slot: 'settings',
        resourceId: resource.id,
      });
      const call = (
        functionClass: 'fx' | 'tx',
        operation: string,
        args: unknown,
      ) => service!.call(tenant, {
        actorId: 'settings-actor',
        definitionName: 'settings-widget',
        runId: 1,
        functionClass,
        slot: 'settings',
        kind: 'db',
        operation,
        args,
      });

      await expect(call('tx', 'invoke', {
        operation: 'setSetting',
        parameters: { name: 'theme', value: 'dark' },
      })).resolves.toMatchObject({ rowsAffected: 1 });
      await expect(call('fx', 'invoke', {
        operation: 'getSetting',
        parameters: { name: 'theme' },
      })).resolves.toEqual([{ value: 'dark' }]);
      await expect(call('fx', 'query', {
        sql: 'SELECT value FROM settings',
        parameters: {},
      })).rejects.toMatchObject({ code: 'DB_ARBITRARY_SQL_NOT_ALLOWED' });
      await expect(call('fx', 'invoke', {
        operation: 'getSetting',
        parameters: { name: 42 },
      })).rejects.toMatchObject({ code: 'DB_OPERATION_PARAMETERS_INVALID' });

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
      await expect(call('fx', 'invoke', {
        operation: 'getSetting',
        parameters: { name: 'theme' },
      })).rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
    } finally {
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
      requestId: 'resource-owner-request-b',
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

  test('retains the owner fence and retries when a KV provider handle fails to close', async () => {
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
    let owner: ResourceServicePool | null = null;
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
      owner = new ResourceServicePool({
        create: (serviceTenant) => createService(serviceTenant, failingFactory),
      });
      await owner.start({ config: {}, hooks: {} });
      const resource = await owner.createResource(tenant, { kind: 'kv', name: 'Close failure KV' });
      failingResourceId = resource.id;
      await owner.setResourceDataEntry(tenant, {
        resourceId: resource.id,
        key: 'status',
        expectedRevision: null,
        value: 'open-handle',
      });

      closeAttempts = 0;
      failClose = true;
      await expect(owner.stop()).rejects.toBeInstanceOf(AggregateError);
      expect(closeAttempts).toBeGreaterThan(0);

      const competing = createService(tenant);
      await expect(competing.start({ config: {}, hooks: {} })).rejects.toMatchObject({
        code: 'RESOURCE_OWNER_CONFLICT',
      });

      failClose = false;
      await owner.stop();
      successor = createService(tenant);
      await successor.start({ config: {}, hooks: {} });
      await expect(successor.getResource(tenant, resource.id)).resolves.toMatchObject({
        id: resource.id,
        status: 'ready',
      });
    } finally {
      failClose = false;
      await successor?.stop().catch(() => undefined);
      await owner?.stop().catch(() => undefined);
      await dbService.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
