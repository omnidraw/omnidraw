import { describe, expect, test } from 'bun:test';
import type { IResourceStore, TResolvedResourceCall } from '../src';
import {
  ResourceManager,
  ResourceManagerGateway,
  type ILocalResourceProvider,
  type IResourceManagerStore,
  type TResourceCatalogRecord,
} from '../src/local';

function memoryStore() {
  const resources = new Map<string, TResourceCatalogRecord>();
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
          lastError: null,
          createdAtSec: now,
          updatedAtSec: now,
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
        const updated = { ...resource, status, lastError };
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
    },
    migration: { hasActiveWork: async () => false },
  };
  return { resources, store };
}

function managerWith(
  provider: ILocalResourceProvider,
  id: `${string}-${string}-${string}-${string}-${string}`,
) {
  const memory = memoryStore();
  return {
    ...memory,
    manager: new ResourceManager({
      store: memory.store,
      crypto: { randomUUID: () => id },
      providers: [provider],
    }),
  };
}

describe('ResourceManager', () => {
  test('uses only a caller-supplied resource choice for logical calls', async () => {
    const calls: unknown[] = [];
    const provider: ILocalResourceProvider = {
      kind: 'kv',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: (operation) => operation === 'set' ? 'write' : null,
      dispatch: async (context, operation, args) => {
        calls.push({ context, operation, args });
        return { ok: true };
      },
    };
    const { manager } = managerWith(provider, '00000000-0000-4000-8000-000000000001');
    const resource = await manager.createResource({ kind: 'kv', name: ' Preferences ' });
    await expect(manager.callWithDirectBinding({
      consumerId: 'consumer-a',
      definitionName: 'settings-widget',
      invocationId: 1,
      functionClass: 'tx',
      slot: 'preferences',
      kind: 'kv',
      operation: 'set',
      args: { key: 'theme', value: 'dark' },
    }, {
      resourceId: resource.id,
      requirement: { kind: 'kv', required: true, scope: ['read', 'write'] },
      scope: ['write'],
    })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    await manager.close();
  });

  test('projects direct choices through the canonical Resource Store gateway', async () => {
    const provider: ILocalResourceProvider = {
      kind: 'db',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: () => 'read',
      dispatch: async () => undefined,
    };
    const { manager } = managerWith(provider, '00000000-0000-4000-8000-000000000002');
    const resource = await manager.createResource({ kind: 'db', name: 'Settings' });
    let resolved: TResolvedResourceCall | null = null;
    const store: IResourceStore = {
      call: async (call) => {
        resolved = call;
        return { output: [{ value: 'dark' }] };
      },
      reconcile: async () => undefined,
      close: async () => undefined,
    };
    const gateway = new ResourceManagerGateway({ manager, store });
    await expect(gateway.callWithDirectBinding({
      consumerId: 'consumer-a',
      definitionName: 'settings-widget',
      invocationId: 1,
      functionClass: 'fx',
      slot: 'settings',
      kind: 'db',
      operation: 'query',
      args: {},
    }, {
      resourceId: resource.id,
      requirement: { kind: 'db', required: true, scope: ['read'] },
      scope: ['read'],
    })).resolves.toEqual([{ value: 'dark' }]);
    expect(resolved).toMatchObject({
      slot: 'settings',
      resourceId: resource.id,
      kind: 'db',
      effect: 'read',
    });
    await manager.close();
  });

  test('coordinates database migration without any binding registry', async () => {
    const provider: ILocalResourceProvider = {
      kind: 'db',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: () => null,
      dispatch: async () => undefined,
    };
    const { manager, resources } = managerWith(
      provider,
      '00000000-0000-4000-8000-000000000003',
    );
    const resource = await manager.createResource({ kind: 'db', name: 'Notes' });
    await expect(manager.coordinateResourceMigration(resource.id, async () => 'applied'))
      .resolves.toBe('applied');
    expect(resources.get(resource.id)?.status).toBe('ready');
    await manager.close();
  });

  test('deletes a ready resource without consulting revision references', async () => {
    let physicalDeletes = 0;
    const provider: ILocalResourceProvider = {
      kind: 'kv',
      provision: async () => undefined,
      delete: async () => { physicalDeletes += 1; },
      effect: () => null,
      dispatch: async () => undefined,
    };
    const { manager, resources } = managerWith(
      provider,
      '00000000-0000-4000-8000-000000000004',
    );
    const resource = await manager.createResource({ kind: 'kv', name: 'Preferences' });
    await manager.deleteResource(resource.id);
    expect(resources.has(resource.id)).toBe(false);
    expect(physicalDeletes).toBe(1);
    await manager.close();
  });
});
