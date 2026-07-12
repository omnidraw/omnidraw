import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { ActorResourceError, toSafeActorResourceError } from '../src/resources/ActorResourceError';
import { ActorResourceManager } from '../src/resources/ActorResourceManager';
import { KvResource } from '../src/resources/KvResource';
import { SecretStoreResource } from '../src/resources/SecretStoreResource';
import type { TVibecanvasJson } from '../src/core/types';
import type { IActorResourceProvider } from '../src/resources/resource-types';

const definitionName = 'Resource Test';

function defaultProviders(db: DbServiceTurso): IActorResourceProvider[] {
  return [
    new KvResource(db.actorResource.keyValue),
    new SecretStoreResource(db.actorResource.keyValue),
  ];
}

const manifest: TVibecanvasJson & { manifest_path: string } = {
  slug: 'resource-test',
  name: definitionName,
  manifest_path: 'widgets/resource-test/vibecanvas.json',
  actor: {
    relFunctionPath: './actor/functions.ts',
    initialState: 'ready',
    initialData: {},
    resources: {
      storage: { kind: 'kv', required: true, scope: ['read', 'write'] },
      readonly: { kind: 'kv', required: false, scope: ['read'] },
      credentials: { kind: 'secretStore', required: true, scope: ['read', 'write'] },
    },
    states: { ready: { on: {} } },
  },
  widget: {
    relWidgetDir: './widget',
    tool: { label: 'Resource Test', behavior: { type: 'action' } },
  },
};

describe('ActorResourceManager', () => {
  let db: DbServiceTurso;
  let manager: ActorResourceManager;

  beforeEach(async () => {
    db = new DbServiceTurso({ databasePath: ':memory:', dataDir: import.meta.dir, cacheDir: import.meta.dir });
    await db.start();
    await db.actor.insertDefinition({
      name: definitionName,
      slug: manifest.slug,
      url: null,
      description: null,
      manifest_path: manifest.manifest_path,
    });
    manager = new ActorResourceManager({
      db,
      crypto,
      getDefinition: (name) => name === definitionName ? manifest : null,
      providers: defaultProviders(db),
    });
  });

  afterEach(async () => {
    await manager.close();
    await db.db.close();
  });

  test('creates duplicate display names and shares a definition binding across actor calls', async () => {
    const first = await manager.createResource({ kind: 'kv', name: 'Preferences' });
    const second = await manager.createResource({ kind: 'kv', name: 'Preferences' });
    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe('ready');

    await manager.bindResource({ definitionName, slot: 'storage', resourceId: first.id });
    await manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'tx', slot: 'storage', kind: 'kv',
      operation: 'set', args: { key: 'theme', value: 'dark' },
    });
    const fromOtherActor = await manager.call({
      actorId: 'actor-b', definitionName, runId: 2, functionClass: 'fx', slot: 'storage', kind: 'kv',
      operation: 'get', args: { key: 'theme' },
    });
    expect(fromOtherActor).toEqual({ value: 'dark', revision: 1 });

    await manager.bindResource({ definitionName, slot: 'storage', resourceId: second.id });
    expect(await manager.call({
      actorId: 'actor-b', definitionName, runId: 3, functionClass: 'fx', slot: 'storage', kind: 'kv',
      operation: 'get', args: { key: 'theme' },
    })).toBeNull();
  });

  test('enforces manifest scope, binding reduction, and function-class ceilings', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Read only' });
    await expect(manager.bindResource({ definitionName, slot: 'readonly', resourceId: resource.id, scope: ['write'] }))
      .rejects.toMatchObject({ code: 'RESOURCE_SCOPE_INVALID' });

    await manager.bindResource({ definitionName, slot: 'storage', resourceId: resource.id, scope: ['read'] });
    await expect(manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'tx', slot: 'storage', kind: 'kv',
      operation: 'set', args: { key: 'x', value: 1 },
    })).rejects.toMatchObject({ code: 'RESOURCE_WRITE_NOT_ALLOWED' });
    await expect(manager.call({
      actorId: 'actor-a', definitionName, runId: 2, functionClass: 'fn', slot: 'storage', kind: 'kv',
      operation: 'get', args: { key: 'x' },
    })).rejects.toMatchObject({ code: 'RESOURCE_READ_NOT_ALLOWED' });
  });

  test('blocks deletion while bound and reports actionable binding status', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Storage' });
    let status = await manager.getDefinitionResourceStatus(definitionName);
    expect(status.find((item) => item.slot === 'storage')).toMatchObject({
      bound: false,
      blockedCode: 'RESOURCE_NOT_BOUND',
    });

    await manager.bindResource({ definitionName, slot: 'storage', resourceId: resource.id });
    status = await manager.getDefinitionResourceStatus(definitionName);
    expect(status.find((item) => item.slot === 'storage')).toMatchObject({ bound: true, ready: true, compatible: true });
    await expect(manager.deleteResource(resource.id)).rejects.toMatchObject({ code: 'RESOURCE_STILL_BOUND' });
    expect(await manager.unbindResource({ definitionName, slot: 'storage' })).toBe(true);
    await manager.deleteResource(resource.id);
    expect(await manager.getResource(resource.id)).toBeNull();
  });

  test('keeps secret values out of list, write, and conflict results', async () => {
    const sentinel = 'sentinel-secret-token';
    const resource = await manager.createResource({ kind: 'secretStore', name: 'Credentials' });
    await manager.bindResource({ definitionName, slot: 'credentials', resourceId: resource.id });
    const write = await manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'tx', slot: 'credentials', kind: 'secretStore',
      operation: 'set', args: { name: 'token', value: sentinel },
    });
    const list = await manager.call({
      actorId: 'actor-b', definitionName, runId: 2, functionClass: 'fx', slot: 'credentials', kind: 'secretStore',
      operation: 'list', args: {},
    });
    const conflict = await manager.call({
      actorId: 'actor-b', definitionName, runId: 3, functionClass: 'tx', slot: 'credentials', kind: 'secretStore',
      operation: 'compareAndSet', args: { name: 'token', expectedRevision: 99, value: sentinel },
    });
    expect(JSON.stringify({ write, list, conflict })).not.toContain(sentinel);
    expect(write).toEqual({ name: 'token', revision: 1 });
    expect(conflict).toEqual({ ok: false, currentRevision: 1 });
  });

  test('uses stable errors for unknown slots and kind mismatches', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Storage' });
    await expect(manager.bindResource({ definitionName, slot: 'missing', resourceId: resource.id }))
      .rejects.toBeInstanceOf(ActorResourceError);
    await expect(manager.bindResource({ definitionName, slot: 'credentials', resourceId: resource.id }))
      .rejects.toMatchObject({ code: 'RESOURCE_KIND_MISMATCH' });
  });

  test('drains a resolved call before deleting its unbound resource', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Drain test' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: resource.id });

    const originalGet = db.actorResource.keyValue.get;
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    db.actorResource.keyValue.get = async (args) => {
      markStarted();
      await gate;
      return originalGet(args);
    };

    const call = manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'fx', slot: 'storage', kind: 'kv',
      operation: 'get', args: { key: 'pending' },
    });
    await started;
    await manager.unbindResource({ definitionName, slot: 'storage' });

    let deleted = false;
    const deletion = manager.deleteResource(resource.id).then(() => { deleted = true; });
    await Bun.sleep(10);
    expect(deleted).toBe(false);

    release();
    expect(await call).toBeNull();
    await deletion;
    expect(await manager.getResource(resource.id)).toBeNull();
  });

  test('reserves a bound call before resource lookup so deletion drains it', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Lookup drain test' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: resource.id });

    const originalGetResource = db.actorResource.get;
    const originalBeginDelete = db.actorResource.beginDelete;
    let resourceLookupCount = 0;
    let releaseLookup!: () => void;
    let markLookupStarted!: () => void;
    let markDeleteStarted!: () => void;
    const lookupGate = new Promise<void>((resolve) => { releaseLookup = resolve; });
    const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
    const deleteStarted = new Promise<void>((resolve) => { markDeleteStarted = resolve; });
    db.actorResource.get = async (args) => {
      resourceLookupCount += 1;
      if (resourceLookupCount === 1) {
        markLookupStarted();
        await lookupGate;
      }
      return originalGetResource(args);
    };
    db.actorResource.beginDelete = async (args) => {
      const deleting = await originalBeginDelete(args);
      markDeleteStarted();
      return deleting;
    };

    const call = manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'fx', slot: 'storage', kind: 'kv',
      operation: 'get', args: { key: 'pending' },
    });
    await lookupStarted;
    await manager.unbindResource({ definitionName, slot: 'storage' });

    let deletionSettled = false;
    const deletion = manager.deleteResource(resource.id).then(() => { deletionSettled = true; });
    await deleteStarted;
    await Bun.sleep(10);
    expect(deletionSettled).toBe(false);

    releaseLookup();
    await expect(call).rejects.toMatchObject({ code: 'RESOURCE_UNAVAILABLE' });
    await deletion;
    expect(await manager.getResource(resource.id)).toBeNull();
  });

  test('close rejects a pending gateway call without waiting for its provider operation', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Close cancellation test' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: resource.id });

    const originalGet = db.actorResource.keyValue.get;
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    db.actorResource.keyValue.get = async (args) => {
      markStarted();
      await gate;
      return originalGet(args);
    };

    const call = manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'fx', slot: 'storage', kind: 'kv',
      operation: 'get', args: { key: 'pending' },
    });
    const callOutcome = Promise.race([
      call.then(
        () => ({ status: 'resolved' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      ),
      Bun.sleep(200).then(() => ({ status: 'timeout' as const })),
    ]);
    await started;

    const closing = manager.close();
    expect(await callOutcome).toMatchObject({
      status: 'rejected',
      error: { code: 'RESOURCE_CALL_CANCELLED' },
    });

    release();
    await closing;
  });

  test('startup reconciliation restores transitional KV and removes deleting resources', async () => {
    await db.actorResource.create({
      id: 'recover-kv',
      kind: 'kv',
      name: 'Recover KV',
      status: 'provisioning',
      lastError: { code: 'INTERRUPTED', message: 'Previous startup stopped.' },
    });
    await db.actorResource.create({
      id: 'delete-kv',
      kind: 'kv',
      name: 'Delete KV',
      status: 'deleting',
    });
    await db.actorResource.keyValue.set({ resourceId: 'delete-kv', key: 'stale', value: true });

    await manager.reconcileStartup();

    expect(await manager.getResource('recover-kv')).toMatchObject({
      status: 'ready',
      last_error: null,
    });
    expect(await manager.getResource('delete-kv')).toBeNull();
    expect(await db.actorResource.keyValue.get({ resourceId: 'delete-kv', key: 'stale' })).toBeNull();
  });

  test('unbind removes a persisted binding after its slot disappears from the manifest', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Stale slot test' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: resource.id });
    await manager.close();

    const staleManifest: typeof manifest = {
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {},
      },
    };
    manager = new ActorResourceManager({
      db,
      crypto,
      getDefinition: (name) => name === definitionName ? staleManifest : null,
      providers: defaultProviders(db),
    });

    expect(await manager.unbindResource({ definitionName, slot: 'storage' })).toBe(true);
    expect(await manager.unbindResource({ definitionName, slot: 'storage' })).toBe(false);
    expect(await manager.listResourceReferences(resource.id)).toEqual([]);
  });

  test('waits for provisioning before closing providers', async () => {
    await manager.close();
    let release!: () => void;
    let markStarted!: () => void;
    let providerClosed = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const provider: IActorResourceProvider = {
      kind: 'db',
      async provision() {
        markStarted();
        await gate;
      },
      async delete() {},
      effect() { return null; },
      async dispatch() { return null; },
      async close() { providerClosed = true; },
    };
    manager = new ActorResourceManager({
      db,
      crypto,
      getDefinition: (name) => name === definitionName ? manifest : null,
      providers: [provider],
    });

    const creation = manager.createResource({ kind: 'db', name: 'Provisioning', db: { schemaId: 'empty', version: 0 } });
    await started;
    const closing = manager.close();
    await Bun.sleep(10);
    expect(providerClosed).toBe(false);

    release();
    expect((await creation).status).toBe('ready');
    await closing;
    expect(providerClosed).toBe(true);
  });

  test('requires database providers to expose authoritative compatibility', async () => {
    await manager.close();
    const dbManifest: typeof manifest = {
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {
          database: {
            kind: 'db',
            required: true,
            scope: ['read', 'write'],
            schema: { id: 'notes', version: 1 },
            arbitrarySql: false,
          },
        },
      },
    };
    const provider: IActorResourceProvider = {
      kind: 'db',
      async provision() {},
      async delete() {},
      effect() { return null; },
      async dispatch() { return null; },
    };
    manager = new ActorResourceManager({
      db,
      crypto,
      getDefinition: (name) => name === definitionName ? dbManifest : null,
      providers: [provider],
    });

    const resource = await manager.createResource({
      kind: 'db',
      name: 'Missing compatibility',
      db: { schemaId: 'notes', version: 1 },
    });
    await expect(manager.bindResource({ definitionName, slot: 'database', resourceId: resource.id }))
      .rejects.toMatchObject({ code: 'RESOURCE_PROVIDER_UNAVAILABLE' });

    await db.actorResource.upsertBinding({
      definitionName,
      slotName: 'database',
      resourceId: resource.id,
      allowRead: true,
      allowWrite: true,
    });
    await expect(manager.getDefinitionResourceStatus(definitionName))
      .rejects.toMatchObject({ code: 'RESOURCE_PROVIDER_UNAVAILABLE' });
  });

  test('uses stable validation errors and redacts sensitive error details', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Validation' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: resource.id });
    await expect(manager.call({
      actorId: 'actor-a', definitionName, runId: 1, functionClass: 'tx', slot: 'storage', kind: 'kv',
      operation: 'compareAndSet', args: { key: 'x', expectedRevision: 0, value: 'safe' },
    })).rejects.toMatchObject({ code: 'KV_OPERATION_FAILED' });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(manager.call({
      actorId: 'actor-a', definitionName, runId: 2, functionClass: 'tx', slot: 'storage', kind: 'kv',
      operation: 'set', args: { key: 'x', value: cyclic },
    })).rejects.toMatchObject({ code: 'KV_VALUE_INVALID', message: 'KV value is not JSON-compatible.' });

    const sentinel = 'must-not-cross-ipc';
    const safe = toSafeActorResourceError(new ActorResourceError('SECRET_OPERATION_FAILED', 'Secret operation failed.', {
      value: sentinel,
      nested: { token: sentinel, revision: 3 },
    }));
    expect(JSON.stringify(safe)).not.toContain(sentinel);
    expect(safe.details).toEqual({ nested: { revision: 3 } });
  });
});
