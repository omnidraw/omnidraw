import { describe, expect, test } from 'bun:test';
import {
  ResourceManager,
  ResourceManagerGateway,
  type ILocalResourceProvider,
  type IResourceManagerStore,
  type TResourceBindingRecord,
  type TResourceCatalogRecord,
} from '../src/local';
import type { IResourceStore, TResolvedResourceCall } from '../src';
import type { TTenantContext } from '@omnidraw/tenant-core';

const tenant = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
} as const;

function memoryStore() {
  const resources = new Map<string, TResourceCatalogRecord>();
  let bindings: TResourceBindingRecord[] = [];
  const now = '1970-01-01T00:00:00.000Z';

  const store: IResourceManagerStore = {
    catalog: {
      list: async (filter) => [...resources.values()].filter((resource) => (
        (filter.kind === undefined || resource.kind === filter.kind)
        && (filter.status === undefined || resource.status === filter.status)
      )),
      get: async ({ id }) => resources.get(id) ?? null,
      findByNameKey: async ({ nameKey }) => [...resources.values()].filter((resource) => (
        resource.name.normalize('NFC').trim().toLowerCase() === nameKey
      )),
      create: async (args) => {
        const resource: TResourceCatalogRecord = {
          ...args,
          last_error: null,
          created_at: now,
          updated_at: now,
        };
        resources.set(resource.id, resource);
        return resource;
      },
      rename: async ({ id, name }) => {
        const resource = resources.get(id);
        if (!resource) return null;
        const renamed = { ...resource, name };
        resources.set(id, renamed);
        return renamed;
      },
      updateProviderState: async ({ id, status, expectedStatus, lastError }) => {
        const resource = resources.get(id);
        if (!resource || (expectedStatus !== undefined && resource.status !== expectedStatus)) return null;
        const updated = { ...resource, status, last_error: lastError };
        resources.set(id, updated);
        return updated;
      },
      beginDelete: async ({ id }) => {
        const resource = resources.get(id);
        if (!resource) return null;
        const deleting = { ...resource, status: 'deleting' as const };
        resources.set(id, deleting);
        return deleting;
      },
      delete: async ({ id }) => resources.delete(id),
      listBindingsForResource: async ({ resourceId }) => bindings.filter((binding) => binding.resource_id === resourceId),
      listBindingsForDefinition: async ({ definitionName }) => bindings.filter((binding) => binding.definition_name === definitionName),
      upsertBinding: async (args) => {
        const resource = resources.get(args.resourceId);
        if (resource?.status !== 'ready') return null;
        const binding: TResourceBindingRecord = {
          definition_name: args.definitionName,
          slot_name: args.slotName,
          resource_id: args.resourceId,
          allow_read: args.allowRead,
          allow_write: args.allowWrite,
          created_at: now,
          updated_at: now,
        };
        bindings = bindings.filter((candidate) => !(
          candidate.definition_name === args.definitionName
          && candidate.slot_name === args.slotName
        ));
        bindings.push(binding);
        return binding;
      },
      removeBinding: async ({ definitionName, slotName }) => {
        const previousLength = bindings.length;
        bindings = bindings.filter((binding) => !(
          binding.definition_name === definitionName && binding.slot_name === slotName
        ));
        return bindings.length !== previousLength;
      },
      replaceBindings: async (args) => {
        bindings = bindings.filter((binding) => binding.definition_name !== args.definitionName);
        for (const candidate of args.bindings) {
          bindings.push({
            definition_name: args.definitionName,
            slot_name: candidate.slotName,
            resource_id: candidate.resourceId,
            allow_read: candidate.allowRead,
            allow_write: candidate.allowWrite,
            created_at: now,
            updated_at: now,
          });
        }
        return bindings.filter((binding) => binding.definition_name === args.definitionName);
      },
    },
    migration: {
      hasActiveWork: async () => false,
    },
  };

  return { resources, store };
}

describe('ResourceManager', () => {
  test('owns catalog, binding, and logical gateway behavior without a consumer runtime', async () => {
    const calls: unknown[] = [];
    const provider: ILocalResourceProvider = {
      kind: 'kv',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: (operation) => operation === 'get' ? 'read' : operation === 'set' ? 'write' : null,
      dispatch: async (context, operation, args) => {
        calls.push({ context, operation, args });
        return { ok: true };
      },
    };
    const { store } = memoryStore();
    const manager = new ResourceManager({
      store,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
      resolveRequirements: (definitionName) => definitionName === 'notes'
        ? { storage: { kind: 'kv', required: true, scope: ['read', 'write'] } }
        : null,
      providers: [provider],
    });

    const resource = await manager.createResource({ kind: 'kv', name: ' Preferences ' });
    expect(resource).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Preferences',
      status: 'ready',
    });
    await manager.bindResource({ definitionName: 'notes', slot: 'storage', resourceId: resource.id });
    await expect(manager.call({
      consumerId: 'consumer-a',
      definitionName: 'notes',
      invocationId: 1,
      functionClass: 'tx',
      slot: 'storage',
      kind: 'kv',
      operation: 'set',
      args: { key: 'theme', value: 'dark' },
    })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);

    await manager.close();
  });

  test('routes an exact host operation policy through the compatibility gateway without owning provider close', async () => {
    const namedOperation = {
      effect: 'read' as const,
      sql: 'SELECT value FROM settings WHERE name = :name',
      parameters: { name: { type: 'string' as const } },
      result: 'rows' as const,
    };
    let providerCloses = 0;
    const provider: ILocalResourceProvider = {
      kind: 'db',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: (_operation, requirement, args) => {
        const name = (args as { operation?: string }).operation;
        return name ? requirement.operations?.[name]?.effect ?? null : null;
      },
      dispatch: async () => {
        throw new Error('ResourceManager must not dispatch compatibility gateway calls.');
      },
      close: async () => { providerCloses += 1; },
    };
    const { store: managerStore } = memoryStore();
    const manager = new ResourceManager({
      store: managerStore,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000002' },
      resolveRequirements: (definitionName) => definitionName === 'settings-widget'
        ? {
          settings: {
            kind: 'db',
            required: true,
            scope: ['read', 'write'],
            arbitrarySql: false,
            operations: { getSetting: namedOperation },
          },
        }
        : null,
      providers: [provider],
      closeProviders: false,
    });
    const resource = await manager.createResource({ kind: 'db', name: 'Settings' });
    await manager.bindResource({
      definitionName: 'settings-widget',
      slot: 'settings',
      resourceId: resource.id,
    });

    let resolvedCall: TResolvedResourceCall | null = null;
    const resourceStore: IResourceStore = {
      call: async (_tenant, call) => {
        resolvedCall = call;
        return { output: [{ value: 'dark' }] };
      },
      reconcile: async () => undefined,
      close: async () => undefined,
    };
    const gateway = new ResourceManagerGateway({ manager, store: resourceStore });
    await expect(gateway.call(tenant, {
      consumerId: 'consumer-a',
      definitionName: 'settings-widget',
      invocationId: 1,
      functionClass: 'fx',
      slot: 'settings',
      kind: 'db',
      operation: 'invoke',
      args: { operation: 'getSetting', parameters: { name: 'theme' } },
    })).resolves.toEqual([{ value: 'dark' }]);
    expect(resolvedCall).toMatchObject({
      resourceId: resource.id,
      kind: 'db',
      effect: 'read',
      requirement: {
        slot: 'settings',
        kind: 'db',
        effect: 'read_write',
        arbitrarySql: false,
        operations: { getSetting: namedOperation },
      },
    });

    await manager.close();
    expect(providerCloses).toBe(0);
  });

  test('routes concurrent tenant calls independently and exact management calls through the gateway', async () => {
    const otherTenant = {
      ...tenant,
      orgId: 'org-b',
      accountId: 'account-b',
      requestId: 'request-b',
    } as const;
    const seen: Array<Readonly<{
      tenant: TTenantContext;
      call: TResolvedResourceCall;
    }>> = [];
    let managerAuthorizations = 0;
    const manager = {
      resolveGatewayCall: async () => {
        managerAuthorizations += 1;
        return {
          requirement: {
            slot: 'preferences',
            kind: 'kv' as const,
            effect: 'read' as const,
            required: true,
          },
          binding: {
            slot: 'preferences',
            resourceId: 'resource-a',
            kind: 'kv' as const,
            allowRead: true,
            allowWrite: false,
          },
          effect: 'read' as const,
        };
      },
    };
    const resourceStore: IResourceStore = {
      call: async (callTenant, call) => {
        await Promise.resolve();
        seen.push({ tenant: callTenant, call });
        return { output: `${callTenant.orgId}:${call.resourceId}` };
      },
      reconcile: async () => undefined,
      close: async () => undefined,
    };
    const gateway = new ResourceManagerGateway({ manager, store: resourceStore });

    const [logical, direct] = await Promise.all([
      gateway.call(tenant, {
        consumerId: 'consumer-a',
        definitionName: 'settings-widget',
        invocationId: 1,
        functionClass: 'fx',
        slot: 'preferences',
        kind: 'kv',
        operation: 'get',
        args: { key: 'theme' },
      }),
      gateway.callResource(otherTenant, {
        resourceId: 'resource-b',
        kind: 'secretStore',
        effect: 'write',
        operation: 'set',
        input: { name: 'token', value: 'redacted' },
        operationId: 'operation-b',
        writeCapability: 'capability-b',
      }),
    ]);

    expect(logical).toBe('org-a:resource-a');
    expect(direct).toBe('org-b:resource-b');
    expect(managerAuthorizations).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen.find((entry) => entry.tenant.orgId === 'org-a')).toMatchObject({
      tenant,
      call: {
        slot: 'preferences',
        resourceId: 'resource-a',
        kind: 'kv',
        effect: 'read',
        operation: 'get',
      },
    });
    expect(seen.find((entry) => entry.tenant.orgId === 'org-b')).toEqual({
      tenant: otherTenant,
      call: {
        slot: 'resource:secretStore:resource-b',
        resourceId: 'resource-b',
        kind: 'secretStore',
        requirement: {
          slot: 'resource:secretStore:resource-b',
          kind: 'secretStore',
          effect: 'write',
          required: true,
        },
        operation: 'set',
        operationId: 'operation-b',
        effect: 'write',
        input: { name: 'token', value: 'redacted' },
        writeCapability: 'capability-b',
      },
    });
  });

  test('restores ready after a successful coordinated db migration so the next call is admitted', async () => {
    const provider: ILocalResourceProvider = {
      kind: 'db',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: (operation) => operation === 'query' ? 'read' : null,
      dispatch: async () => ({ rows: [] }),
    };
    const { store, resources } = memoryStore();
    const manager = new ResourceManager({
      store,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000004' },
      resolveRequirements: () => ({ data: { kind: 'db', required: true, scope: ['read'] } }),
      providers: [provider],
    });
    const resource = await manager.createResource({ kind: 'db', name: 'Notes' });
    await manager.bindResource({ definitionName: 'notes-widget', slot: 'data', resourceId: resource.id });

    await expect(manager.coordinateResourceMigration(resource.id, async () => 'applied')).resolves.toBe('applied');
    expect(resources.get(resource.id)?.status).toBe('ready');
    await expect(manager.call({
      consumerId: 'consumer-a',
      definitionName: 'notes-widget',
      invocationId: 1,
      functionClass: 'fx',
      slot: 'data',
      kind: 'db',
      operation: 'query',
      args: {},
    })).resolves.toEqual({ rows: [] });

    await manager.close();
  });

  test('marks a failed coordinated db migration as error instead of leaving it migrating', async () => {
    const provider: ILocalResourceProvider = {
      kind: 'db',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: () => null,
      dispatch: async () => undefined,
    };
    const { store, resources } = memoryStore();
    const manager = new ResourceManager({
      store,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000005' },
      resolveRequirements: () => null,
      providers: [provider],
    });
    const resource = await manager.createResource({ kind: 'db', name: 'Notes' });

    await expect(manager.coordinateResourceMigration(resource.id, async () => {
      throw new Error('physical apply exploded');
    })).rejects.toThrow('physical apply exploded');
    expect(resources.get(resource.id)?.status).toBe('error');

    await manager.close();
  });

  test('cancels and drains pending gateway authorization before provider shutdown', async () => {
    let effectCalls = 0;
    let providerCloses = 0;
    const provider: ILocalResourceProvider = {
      kind: 'kv',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: () => { effectCalls += 1; return 'read'; },
      dispatch: async () => ({ value: true }),
      close: async () => { providerCloses += 1; },
    };
    const { store } = memoryStore();
    const manager = new ResourceManager({
      store,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000003' },
      resolveRequirements: () => ({
        preferences: { kind: 'kv', required: true, scope: ['read'] },
      }),
      providers: [provider],
    });
    const resource = await manager.createResource({ kind: 'kv', name: 'Preferences' });
    await manager.bindResource({
      definitionName: 'settings-widget',
      slot: 'preferences',
      resourceId: resource.id,
    });

    const listBindings = store.catalog.listBindingsForDefinition;
    let releaseResolution!: () => void;
    let markResolutionStarted!: () => void;
    const resolutionStarted = new Promise<void>((resolve) => { markResolutionStarted = resolve; });
    const resolutionGate = new Promise<void>((resolve) => { releaseResolution = resolve; });
    Object.assign(store.catalog, {
      listBindingsForDefinition: async (args: Parameters<typeof listBindings>[0]) => {
        markResolutionStarted();
        await resolutionGate;
        return listBindings(args);
      },
    });

    const resolving = manager.resolveGatewayCall({
      consumerId: 'consumer-a',
      definitionName: 'settings-widget',
      invocationId: 1,
      functionClass: 'fx',
      slot: 'preferences',
      kind: 'kv',
      operation: 'get',
      args: { key: 'theme' },
    });
    await resolutionStarted;
    const closing = manager.close();
    let closeSettled = false;
    void closing.then(() => { closeSettled = true; });

    await expect(resolving).rejects.toMatchObject({ code: 'RESOURCE_CALL_CANCELLED' });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    expect(providerCloses).toBe(0);

    releaseResolution();
    await closing;
    expect(effectCalls).toBe(0);
    expect(providerCloses).toBe(1);
  });
});
