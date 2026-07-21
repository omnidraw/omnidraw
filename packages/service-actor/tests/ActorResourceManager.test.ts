import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { ActorResourceError, toSafeActorResourceError } from '../src/resources/ActorResourceError';
import { ActorResourceManager } from '../src/resources/ActorResourceManager';
import { KvResource } from '../src/resources/KvResource';
import { SecretStoreResource } from '../src/resources/SecretStoreResource';
import { ActorResourceKeyValueStore } from '../src/resources/ActorResourceKeyValueStore';
import type { TVibecanvasJson } from '../src/core/types';
import type { IActorResourceProvider } from '../src/resources/resource-types';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testSecretStoreKeyProvider } from './test-secret-store-key-provider';
import { createTestCrypto, testUuid } from './test-uuid';

const definitionName = 'Resource Test';

function defaultProviders(dataRoot: string): {
  providers: IActorResourceProvider[];
  kvStore: ActorResourceKeyValueStore;
  kvResource: KvResource;
} {
  const kvStore = new ActorResourceKeyValueStore({ dataRoot, kind: 'kv' });
  const kvResource = new KvResource(kvStore);
  return {
    providers: [
      kvResource,
      new SecretStoreResource(new ActorResourceKeyValueStore({
        dataRoot,
        kind: 'secretStore',
        secretStoreKeyProvider: testSecretStoreKeyProvider,
      })),
    ],
    kvStore,
    kvResource,
  };
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
  let rootDir: string;
  let kvStore: ActorResourceKeyValueStore;
  let kvResource: KvResource;
  let testCrypto: Pick<Crypto, 'randomUUID'>;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'vibecanvas-actor-resource-manager-'));
    db = new DbServiceTurso({ databasePath: ':memory:', dataDir: import.meta.dir, cacheDir: import.meta.dir });
    await db.start();
    testCrypto = createTestCrypto('actor-resource-manager');
    await db.actor.insertDefinition({
      name: definitionName,
      slug: manifest.slug,
      url: null,
      description: null,
      manifest_path: manifest.manifest_path,
    });
    const physical = defaultProviders(rootDir);
    kvStore = physical.kvStore;
    kvResource = physical.kvResource;
    manager = new ActorResourceManager({
      db,
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? manifest : null,
      providers: physical.providers,
    });
  });

  afterEach(async () => {
    await manager.close();
    await db.db.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  test('enforces normalized names, resolves them case-insensitively, and shares bindings across actor calls', async () => {
    const first = await manager.createResource({ kind: 'kv', name: 'Preferences' });
    await expect(manager.createResource({ kind: 'secretStore', name: ' preferences ' }))
      .rejects.toMatchObject({ code: 'RESOURCE_NAME_CONFLICT' });
    expect(await manager.resolveResourceByName('pReFeReNcEs', { requireReady: true })).toMatchObject({ id: first.id });
    await expect(manager.resolveResourceByName('Preferences', { requireReady: true, kind: 'db' }))
      .rejects.toMatchObject({ code: 'RESOURCE_KIND_MISMATCH' });
    const second = await manager.createResource({ kind: 'kv', name: 'Alternate preferences' });
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

  test('reports legacy normalized-name collisions as ambiguous without choosing a row', async () => {
    await (await db.db.prepare(`
      INSERT INTO resource_catalog (
        org_id, id, kind, name, status, created_at_ms, updated_at_ms
      )
      SELECT id, ?, ?, ?, ?, 0, 0 FROM organizations
      UNION ALL
      SELECT id, ?, ?, ?, ?, 0, 0 FROM organizations
    `)).run(
      testUuid('legacy-a'), 'kv', 'Legacy', 'ready',
      testUuid('legacy-b'), 'secretStore', 'legacy', 'ready',
    );
    await expect(manager.resolveResourceByName('LEGACY', { requireReady: false }))
      .rejects.toMatchObject({ code: 'RESOURCE_NAME_AMBIGUOUS' });
  });

  test('dispatches a draft-preview call through an explicit scoped binding without persisting it', async () => {
    const resource = await manager.createResource({ kind: 'kv', name: 'Preview preferences' });
    const requirement = manifest.actor.resources!.storage;
    const binding = { resourceId: resource.id, requirement, scope: ['read', 'write'] as ('read' | 'write')[] };

    await manager.callWithDirectBinding({
      actorId: 'draft:actor', definitionName: 'Draft Resource Test', runId: 1, functionClass: 'tx', slot: 'storage', kind: 'kv',
      operation: 'set', args: { key: 'selected', value: 9 },
    }, binding);
    expect(await manager.callWithDirectBinding({
      actorId: 'draft:actor', definitionName: 'Draft Resource Test', runId: 2, functionClass: 'fx', slot: 'storage', kind: 'kv',
      operation: 'get', args: { key: 'selected' },
    }, binding)).toEqual({ value: 9, revision: 1 });
    expect(await manager.listResourceReferences(resource.id)).toEqual([]);

    await expect(manager.callWithDirectBinding({
      actorId: 'draft:actor', definitionName: 'Draft Resource Test', runId: 3, functionClass: 'tx', slot: 'readonly', kind: 'kv',
      operation: 'set', args: { key: 'selected', value: 10 },
    }, { resourceId: resource.id, requirement: manifest.actor.resources!.readonly, scope: ['read'] }))
      .rejects.toMatchObject({ code: 'RESOURCE_WRITE_NOT_ALLOWED' });
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

  test('validates a complete replacement before atomically changing any binding', async () => {
    const oldStorage = await manager.createResource({ kind: 'kv', name: 'Old replacement storage' });
    const newStorage = await manager.createResource({ kind: 'kv', name: 'New replacement storage' });
    const credentials = await manager.createResource({ kind: 'secretStore', name: 'Replacement credentials' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: oldStorage.id, scope: ['read'] });
    await manager.bindResource({ definitionName, slot: 'credentials', resourceId: credentials.id, scope: ['read', 'write'] });

    await expect(manager.replaceResourceBindings({
      definitionName,
      bindings: [
        { slot: 'storage', resourceId: newStorage.id, scope: ['read', 'write'] },
        { slot: 'credentials', resourceId: newStorage.id, scope: ['read'] },
      ],
    })).rejects.toMatchObject({ code: 'RESOURCE_KIND_MISMATCH' });

    expect(await manager.listResourceBindingsForDefinition(definitionName)).toEqual([
      expect.objectContaining({ slot_name: 'credentials', resource_id: credentials.id, allow_read: true, allow_write: true }),
      expect.objectContaining({ slot_name: 'storage', resource_id: oldStorage.id, allow_read: true, allow_write: false }),
    ]);

    await manager.replaceResourceBindings({
      definitionName,
      bindings: [{ slot: 'storage', resourceId: newStorage.id, scope: ['read'] }],
    });
    expect(await manager.listResourceBindingsForDefinition(definitionName)).toEqual([
      expect.objectContaining({ slot_name: 'storage', resource_id: newStorage.id, allow_read: true, allow_write: false }),
    ]);

    await manager.bindResource({ definitionName, slot: 'storage', resourceId: oldStorage.id, scope: ['read'] });
    let definitionReloaded = false;
    await expect(manager.transitionResourceBindings({
      definitionName,
      expectedBindings: [{ slot: 'storage', resourceId: newStorage.id, scope: ['read'] }],
      bindings: [],
    }, async () => { definitionReloaded = true; })).rejects.toMatchObject({ code: 'RESOURCE_BINDING_CONFLICT' });
    expect(definitionReloaded).toBe(false);
    expect(await manager.listResourceBindingsForDefinition(definitionName)).toEqual([
      expect.objectContaining({ slot_name: 'storage', resource_id: oldStorage.id, allow_read: true, allow_write: false }),
    ]);

    let publicationReloaded = false;
    await expect(manager.transitionResourceBindings({
      definitionName,
      expectedBindings: [{ slot: 'storage', resourceId: oldStorage.id, scope: ['read'] }],
      bindings: [],
    }, async () => {
      publicationReloaded = true;
      await db.actorResource.upsertBinding({
        definitionName,
        slotName: 'storage',
        resourceId: newStorage.id,
        allowRead: true,
        allowWrite: false,
      });
    })).rejects.toMatchObject({ code: 'RESOURCE_BINDING_CONFLICT' });
    expect(publicationReloaded).toBe(true);
    expect(await manager.listResourceBindingsForDefinition(definitionName)).toEqual([
      expect.objectContaining({ slot_name: 'storage', resource_id: newStorage.id, allow_read: true, allow_write: false }),
    ]);
  });

  test('keeps the complete binding set stable until an admitted actor start finishes', async () => {
    const original = await manager.createResource({ kind: 'kv', name: 'Atomic start original' });
    const replacement = await manager.createResource({ kind: 'kv', name: 'Atomic start replacement' });
    const credentials = await manager.createResource({ kind: 'secretStore', name: 'Atomic start credentials' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: original.id });
    await manager.bindResource({ definitionName, slot: 'credentials', resourceId: credentials.id });
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'atomic-replacement-start',
      restartIfCompatible: true,
    })).toMatchObject({ allowed: true });

    let settled = false;
    const replacing = manager.replaceResourceBindings({
      definitionName,
      bindings: [
        { slot: 'storage', resourceId: replacement.id, scope: ['read'] },
        { slot: 'credentials', resourceId: credentials.id, scope: ['read'] },
      ],
    }).then((bindings) => {
      settled = true;
      return bindings;
    });
    await Bun.sleep(10);
    expect(settled).toBe(false);
    expect(await manager.listResourceReferences(original.id)).toHaveLength(1);
    expect(await manager.listResourceReferences(replacement.id)).toHaveLength(0);

    await manager.completeActorStart({ actorInstanceId: 'atomic-replacement-start', resourceIds: [], succeeded: true });
    await replacing;
    expect(await manager.listResourceReferences(original.id)).toHaveLength(0);
    expect(await manager.listResourceReferences(replacement.id)).toHaveLength(1);
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
    expect(status.find((item) => item.slot === 'storage')).toMatchObject({ bound: true, ready: true, blockedCode: null });
    await expect(manager.deleteResource(resource.id)).rejects.toMatchObject({ code: 'RESOURCE_STILL_BOUND' });
    expect(await manager.unbindResource({ definitionName, slot: 'storage' })).toBe(true);
    await manager.deleteResource(resource.id);
    expect(await manager.getResource(resource.id)).toBeNull();
  });

  test('blocks actor start on every required unbound resource kind with a specific error', async () => {
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'required-slots',
      restartIfCompatible: true,
    })).toMatchObject({
      allowed: false,
      code: 'KV_RESOURCE_NOT_BOUND',
      message: expect.stringContaining('resource slot "storage"'),
    });

    const storage = await manager.createResource({ kind: 'kv', name: 'Required storage' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: storage.id });
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'required-slots',
      restartIfCompatible: true,
    })).toMatchObject({
      allowed: false,
      code: 'SECRET_STORE_NOT_BOUND',
      message: expect.stringContaining('resource slot "credentials"'),
    });

    const credentials = await manager.createResource({ kind: 'secretStore', name: 'Required credentials' });
    await manager.bindResource({ definitionName, slot: 'credentials', resourceId: credentials.id });
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'required-slots',
      restartIfCompatible: true,
    })).toMatchObject({ allowed: true, code: null });
    await manager.completeActorStart({ actorInstanceId: 'required-slots', resourceIds: [], succeeded: true });

    await manager.close();
    const dbManifest: typeof manifest = {
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {
          database: { kind: 'db', required: true, scope: ['read', 'write'], arbitrarySql: false },
        },
      },
    };
    manager = new ActorResourceManager({
      db,
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? dbManifest : null,
      providers: [{
        kind: 'db',
        async provision() {},
        async delete() {},
        effect() { return null; },
        async dispatch() { return null; },
      }],
    });
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'required-db-slot',
      restartIfCompatible: true,
    })).toMatchObject({
      allowed: false,
      code: 'DB_RESOURCE_NOT_BOUND',
      message: expect.stringContaining('resource slot "database"'),
    });
  });

  test('serializes unbind with a concurrent rebind before choosing the resource gate', async () => {
    const original = await manager.createResource({ kind: 'kv', name: 'Original binding' });
    const replacement = await manager.createResource({ kind: 'kv', name: 'Replacement binding' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: original.id });

    const listBindings = db.actorResource.listBindingsForDefinition;
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    let readCount = 0;
    db.actorResource.listBindingsForDefinition = async (args) => {
      const bindings = await listBindings(args);
      readCount += 1;
      if (readCount === 1) {
        markReadStarted();
        await readGate;
      }
      return bindings;
    };

    const unbinding = manager.unbindResource({ definitionName, slot: 'storage' });
    await readStarted;
    let rebindSettled = false;
    const rebinding = manager.bindResource({
      definitionName,
      slot: 'storage',
      resourceId: replacement.id,
    }).then((binding) => {
      rebindSettled = true;
      return binding;
    });
    await Bun.sleep(10);
    expect(rebindSettled).toBe(false);

    releaseRead();
    expect(await unbinding).toBe(true);
    expect(await rebinding).toMatchObject({ resource_id: replacement.id });
    expect(await manager.listResourceReferences(replacement.id)).toHaveLength(1);
  });

  test('serializes start admission with binding changes and fresh same-actor attempts', async () => {
    const original = await manager.createResource({ kind: 'kv', name: 'Admission original' });
    const replacement = await manager.createResource({ kind: 'kv', name: 'Admission replacement' });
    const credentials = await manager.createResource({ kind: 'secretStore', name: 'Admission credentials' });
    await manager.bindResource({ definitionName, slot: 'storage', resourceId: original.id });
    await manager.bindResource({ definitionName, slot: 'credentials', resourceId: credentials.id });

    const listBindings = db.actorResource.listBindingsForDefinition;
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    let readCount = 0;
    db.actorResource.listBindingsForDefinition = async (args) => {
      const bindings = await listBindings(args);
      readCount += 1;
      if (readCount === 1) {
        markReadStarted();
        await readGate;
      }
      return bindings;
    };

    const firstAdmission = manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'serialized-start',
      restartIfCompatible: true,
    });
    await readStarted;
    let rebindSettled = false;
    const rebinding = manager.bindResource({
      definitionName,
      slot: 'storage',
      resourceId: replacement.id,
    }).then((binding) => {
      rebindSettled = true;
      return binding;
    });
    await Bun.sleep(10);
    expect(rebindSettled).toBe(false);

    releaseRead();
    expect(await firstAdmission).toMatchObject({ allowed: true });

    let secondAdmissionSettled = false;
    const secondAdmission = manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'serialized-start',
      restartIfCompatible: true,
    }).then((admission) => {
      secondAdmissionSettled = true;
      return admission;
    });
    await Bun.sleep(10);
    expect(secondAdmissionSettled).toBe(false);
    expect(rebindSettled).toBe(false);

    await manager.completeActorStart({ actorInstanceId: 'serialized-start', resourceIds: [], succeeded: true });
    await rebinding;
    expect(await secondAdmission).toMatchObject({ allowed: true });
    await manager.completeActorStart({ actorInstanceId: 'serialized-start', resourceIds: [], succeeded: true });
  });

  test('holds the definition binding stable until an admitted start completes', async () => {
    await manager.close();
    const dbManifest: typeof manifest = {
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {
          database: { kind: 'db', required: true, scope: ['read', 'write'], arbitrarySql: false },
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
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? dbManifest : null,
      providers: [provider],
    });
    const original = await manager.createResource({ kind: 'db', name: 'Start binding A' });
    const replacement = await manager.createResource({ kind: 'db', name: 'Start binding B' });
    await manager.bindResource({ definitionName, slot: 'database', resourceId: original.id });
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'binding-stability-start',
      restartIfCompatible: true,
    })).toMatchObject({ allowed: true });

    let rebindSettled = false;
    let replacementApplyEntered = false;
    const rebinding = manager.bindResource({
      definitionName,
      slot: 'database',
      resourceId: replacement.id,
    }).then((binding) => {
      rebindSettled = true;
      return binding;
    });
    const replacementApply = manager.coordinateResourceApply(replacement.id, async () => {
      replacementApplyEntered = true;
      await db.actorResource.updateProviderState({ id: replacement.id, status: 'ready', lastError: null });
    });
    await Bun.sleep(10);
    expect(rebindSettled).toBe(false);
    expect(replacementApplyEntered).toBe(false);
    expect(await manager.listResourceReferences(original.id)).toHaveLength(1);
    expect(await manager.listResourceReferences(replacement.id)).toHaveLength(0);

    await manager.completeActorStart({
      actorInstanceId: 'binding-stability-start',
      resourceIds: [],
      succeeded: true,
    });
    expect(await rebinding).toMatchObject({ resource_id: replacement.id });
    await replacementApply;
    expect(replacementApplyEntered).toBe(true);
    expect(await manager.listResourceReferences(original.id)).toHaveLength(0);
    expect(await manager.listResourceReferences(replacement.id)).toHaveLength(1);
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
    const authorizedRead = await manager.call({
      actorId: 'actor-b', definitionName, runId: 4, functionClass: 'fx', slot: 'credentials', kind: 'secretStore',
      operation: 'get', args: { name: 'token' },
    });
    expect(JSON.stringify({ write, list, conflict })).not.toContain(sentinel);
    expect(write).toEqual({ name: 'token', revision: 1 });
    expect(conflict).toEqual({ ok: false, currentRevision: 1 });
    expect(authorizedRead).toEqual({ value: sentinel, revision: 1 });
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

    const originalDispatch = kvResource.dispatch.bind(kvResource);
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    kvResource.dispatch = async (context, operation, args) => {
      if (operation === 'get') {
        markStarted();
        await gate;
      }
      return originalDispatch(context, operation, args);
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

    const originalDispatch = kvResource.dispatch.bind(kvResource);
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    kvResource.dispatch = async (context, operation, args) => {
      if (operation === 'get') {
        markStarted();
        await gate;
      }
      return originalDispatch(context, operation, args);
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
      id: testUuid('recover-kv'),
      kind: 'kv',
      name: 'Recover KV',
      status: 'provisioning',
      lastError: { code: 'INTERRUPTED', message: 'Previous startup stopped.' },
    });
    await kvStore.provision({ resourceId: testUuid('recover-kv'), kind: 'kv' });
    await db.actorResource.create({
      id: testUuid('delete-kv'),
      kind: 'kv',
      name: 'Delete KV',
      status: 'deleting',
    });
    await kvStore.provision({ resourceId: testUuid('delete-kv'), kind: 'kv' });
    await kvStore.set({ resourceId: testUuid('delete-kv'), key: 'stale', value: true });
    await db.actorResource.create({
      id: testUuid('already-removed-kv'),
      kind: 'kv',
      name: 'Already removed KV',
      status: 'deleting',
    });

    await manager.reconcileStartup();

    expect(await manager.getResource(testUuid('recover-kv'))).toMatchObject({
      status: 'ready',
      last_error: null,
    });
    expect(await manager.getResource(testUuid('delete-kv'))).toBeNull();
    expect(await manager.getResource(testUuid('already-removed-kv'))).toBeNull();
    expect(await stat(join(rootDir, testUuid('delete-kv'))).catch(() => null)).toBeNull();
  });

  test('leaves migrating database resources blocked for apply recovery', async () => {
    await manager.close();
    let reconciled = false;
    const dbManifest: typeof manifest = {
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {
          database: { kind: 'db', required: true, scope: ['read', 'write'], arbitrarySql: false },
        },
      },
    };
    const provider: IActorResourceProvider = {
      kind: 'db',
      reconcileReady: true,
      async provision() {},
      async delete() {},
      async reconcile() {
        reconciled = true;
        return { status: 'ready' };
      },
      effect() { return null; },
      async dispatch() { return null; },
    };
    manager = new ActorResourceManager({
      db,
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? dbManifest : null,
      providers: [provider],
    });
    const resource = await manager.createResource({ kind: 'db', name: 'Interrupted DB' });
    await manager.bindResource({ definitionName, slot: 'database', resourceId: resource.id });
    await db.actorResource.updateProviderState({ id: resource.id, status: 'migrating', lastError: null });

    await manager.reconcileStartup();

    expect(reconciled).toBe(false);
    expect(await manager.getResource(resource.id)).toMatchObject({ status: 'migrating' });
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'blocked-actor',
      restartIfCompatible: true,
    })).toMatchObject({ allowed: false, hadBlocks: true, code: 'DB_RESOURCE_MIGRATING' });
  });

  test('reserves ready database resources atomically until actor startup completes', async () => {
    await manager.close();
    const dbManifest: typeof manifest = {
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {
          database: { kind: 'db', required: true, scope: ['read', 'write'], arbitrarySql: false },
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
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? dbManifest : null,
      providers: [provider],
    });
    const resource = await manager.createResource({ kind: 'db', name: 'Admission DB' });
    await manager.bindResource({ definitionName, slot: 'database', resourceId: resource.id });
    const admission = await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'starting-actor',
      restartIfCompatible: true,
    });
    expect(admission.allowed).toBe(true);

    let applyEntered = false;
    const apply = manager.coordinateResourceApply(resource.id, async () => {
      applyEntered = true;
      await db.actorResource.updateProviderState({ id: resource.id, status: 'ready', lastError: null });
    });
    await Bun.sleep(10);
    expect(applyEntered).toBe(false);

    await manager.completeActorStart({ actorInstanceId: 'starting-actor', resourceIds: [], succeeded: true });
    await apply;
    expect(applyEntered).toBe(true);
    expect(await manager.getResource(resource.id)).toMatchObject({ status: 'ready' });
  });

  test('serializes management work ahead of database apply admission', async () => {
    await manager.close();
    const provider: IActorResourceProvider = {
      kind: 'db',
      async provision() {},
      async delete() {},
      effect() { return null; },
      async dispatch() { return null; },
    };
    manager = new ActorResourceManager({ db, crypto: testCrypto, getDefinition: () => null, providers: [provider] });
    const resource = await manager.createResource({ kind: 'db', name: 'Management gate DB' });
    let releaseManagement!: () => void;
    let markManagementStarted!: () => void;
    const managementGate = new Promise<void>((resolve) => { releaseManagement = resolve; });
    const managementStarted = new Promise<void>((resolve) => { markManagementStarted = resolve; });
    const management = manager.withReadyResource(resource.id, async () => {
      markManagementStarted();
      await managementGate;
    });
    await managementStarted;

    let applyEntered = false;
    const apply = manager.coordinateResourceApply(resource.id, async () => {
      applyEntered = true;
      await db.actorResource.updateProviderState({ id: resource.id, status: 'ready', lastError: null });
    });
    await Bun.sleep(10);
    expect(applyEntered).toBe(false);

    releaseManagement();
    await management;
    await apply;
    expect(applyEntered).toBe(true);
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
    const physical = defaultProviders(rootDir);
    kvStore = physical.kvStore;
    kvResource = physical.kvResource;
    manager = new ActorResourceManager({
      db,
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? staleManifest : null,
      providers: physical.providers,
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
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? manifest : null,
      providers: [provider],
    });

    const creation = manager.createResource({ kind: 'db', name: 'Provisioning' });
    await started;
    const closing = manager.close();
    await Bun.sleep(10);
    expect(providerClosed).toBe(false);

    release();
    expect((await creation).status).toBe('ready');
    await closing;
    expect(providerClosed).toBe(true);
  });

  test('waits for accepted actor starts before closing resource providers', async () => {
    await manager.close();
    let providerClosed = false;
    const dbManifest: typeof manifest = {
      ...manifest,
      actor: {
        ...manifest.actor,
        resources: {
          database: { kind: 'db', required: true, scope: ['read', 'write'], arbitrarySql: false },
        },
      },
    };
    const provider: IActorResourceProvider = {
      kind: 'db',
      async provision() {},
      async delete() {},
      effect() { return null; },
      async dispatch() { return null; },
      async close() { providerClosed = true; },
    };
    manager = new ActorResourceManager({
      db,
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? dbManifest : null,
      providers: [provider],
    });
    const resource = await manager.createResource({ kind: 'db', name: 'Shutdown admission' });
    await manager.bindResource({ definitionName, slot: 'database', resourceId: resource.id });
    expect(await manager.getActorStartAdmission({
      definitionName,
      actorInstanceId: 'shutdown-start',
      restartIfCompatible: true,
    })).toMatchObject({ allowed: true });

    const closing = manager.close();
    await Bun.sleep(10);
    expect(providerClosed).toBe(false);

    await manager.completeActorStart({ actorInstanceId: 'shutdown-start', resourceIds: [], succeeded: false });
    await closing;
    expect(providerClosed).toBe(true);
  });

  test('binds database resources by kind, lifecycle, and permission scope only', async () => {
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
      crypto: testCrypto,
      getDefinition: (name) => name === definitionName ? dbManifest : null,
      providers: [provider],
    });

    const resource = await manager.createResource({
      kind: 'db',
      name: 'Schema agnostic',
    });
    await expect(manager.bindResource({ definitionName, slot: 'database', resourceId: resource.id }))
      .resolves.toMatchObject({ resource_id: resource.id });
    await expect(manager.getDefinitionResourceStatus(definitionName))
      .resolves.toEqual([expect.objectContaining({ slot: 'database', ready: true, blockedCode: null })]);
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
