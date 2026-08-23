import { describe, expect, test } from 'bun:test';
import type {
  IResourceControlStore,
  IResourceWritePermitCoordinator,
  TResolvedResourceCall,
  TResourceDescriptor,
  TResourcePlacement,
  TResourceStatus,
} from '#backend/shell/resources';
import { ResourceGateway, ResourceStoreService } from '../local';
import type { ILocalResourceStoreProvider } from '../local';

const CELL = Object.freeze({ cellId: 'cell-a', placementEpoch: 3 });
const TIMESTAMP = '2026-08-04T00:00:00Z';
const OPERATION_FINGERPRINT = 'a'.repeat(64);
const nowMs = () => Date.parse(TIMESTAMP);

function descriptor(
  status: TResourceDescriptor['status'] = 'ready',
  id = 'resource-a',
): TResourceDescriptor {
  return {
    id,
    kind: 'kv',
    name: 'Preferences',
    status,
    lastError: null,
    createdAtSec: TIMESTAMP,
    updatedAtSec: TIMESTAMP,
  };
}

function placement(
  status: TResourcePlacement['status'] = 'active',
  id = 'resource-a',
): TResourcePlacement {
  return {
    resourceId: id,
    cellId: CELL.cellId,
    placementEpoch: CELL.placementEpoch,
    storageKey: id,
    status,
    createdAtSec: TIMESTAMP,
    updatedAtSec: TIMESTAMP,
  };
}

function statusMatches(
  current: TResourceStatus,
  expected: TResourceStatus | readonly TResourceStatus[],
): boolean {
  return Array.isArray(expected)
    ? expected.includes(current)
    : current === expected;
}

function memoryControlStore(initial: {
  resources?: readonly TResourceDescriptor[];
  placements?: readonly TResourcePlacement[];
} = {}) {
  const resources = new Map((initial.resources ?? []).map((resource) => [resource.id, resource]));
  const placements = new Map((initial.placements ?? []).map((entry) => [entry.resourceId, entry]));
  const controlStore = {
    listResources: async () => [...resources.values()],
    getResource: async (resourceId: string) => resources.get(resourceId) ?? null,
    createResource: async (request: Parameters<IResourceControlStore['createResource']>[0]) => {
      const resource: TResourceDescriptor = {
        id: request.id,
        kind: request.kind,
        name: request.name,
        status: 'created',
        lastError: null,
        createdAtSec: TIMESTAMP,
        updatedAtSec: TIMESTAMP,
      };
      resources.set(resource.id, resource);
      placements.set(resource.id, {
        resourceId: resource.id,
        cellId: request.cellId,
        placementEpoch: request.placementEpoch,
        storageKey: request.storageKey,
        status: 'reserved',
        createdAtSec: TIMESTAMP,
        updatedAtSec: TIMESTAMP,
      });
      return resource;
    },
    updateResourceState: async (request: Parameters<IResourceControlStore['updateResourceState']>[0]) => {
      const current = resources.get(request.resourceId);
      if (!current || !statusMatches(current.status, request.expectedStatus)) return null;
      const updated: TResourceDescriptor = {
        ...current,
        status: request.status,
        lastError: request.lastError,
        updatedAtSec: TIMESTAMP,
      };
      resources.set(updated.id, updated);
      return updated;
    },
    deleteResource: async (resourceId: string) => {
      placements.delete(resourceId);
      return resources.delete(resourceId);
    },
    getPlacement: async (resourceId: string) => placements.get(resourceId) ?? null,
    reservePlacement: async (request: Parameters<IResourceControlStore['reservePlacement']>[0]) => {
      const reserved: TResourcePlacement = {
        ...request,
        status: 'reserved',
        createdAtSec: TIMESTAMP,
        updatedAtSec: TIMESTAMP,
      };
      placements.set(request.resourceId, reserved);
      return reserved;
    },
    updatePlacement: async (request: Parameters<IResourceControlStore['updatePlacement']>[0]) => {
      const current = placements.get(request.resourceId);
      if (!current || current.placementEpoch !== request.expectedEpoch) return null;
      const updated: TResourcePlacement = {
        ...current,
        cellId: request.cellId,
        placementEpoch: request.placementEpoch,
        storageKey: request.storageKey,
        status: request.status,
        updatedAtSec: TIMESTAMP,
      };
      placements.set(request.resourceId, updated);
      return updated;
    },
    deletePlacement: async (resourceId: string) => placements.delete(resourceId),
  } as unknown as IResourceControlStore;
  return { controlStore, resources, placements };
}

function readCall(resourceId = 'resource-a'): TResolvedResourceCall {
  return {
    slot: 'preferences',
    resourceId,
    kind: 'kv',
    requirement: { slot: 'preferences', kind: 'kv', effect: 'read' },
    operation: 'get',
    effect: 'read',
    input: { key: 'theme' },
  };
}

function providerWith(
  dispatch: ILocalResourceStoreProvider['dispatch'],
  overrides: Partial<ILocalResourceStoreProvider> = {},
): ILocalResourceStoreProvider {
  return {
    kind: 'kv',
    effect: (operation) => operation === 'set' ? 'write' : 'read',
    dispatch,
    provision: async () => undefined,
    delete: async () => undefined,
    ...overrides,
  };
}

describe('Resource Store', () => {
  test('rejects a stale placement before provider dispatch', async () => {
    const resource = descriptor();
    const stale = { ...placement(), placementEpoch: CELL.placementEpoch + 1 };
    const memory = memoryControlStore({ resources: [resource], placements: [stale] });
    let dispatched = false;
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async () => { dispatched = true; })],
      placement: CELL,
      nowMs,
    });

    await expect(store.call(readCall())).rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
    expect(dispatched).toBe(false);
    await store.close();
  });

  test('dispatches an exact resolved read without identity scope', async () => {
    const memory = memoryControlStore({ resources: [descriptor()], placements: [placement()] });
    const contexts: unknown[] = [];
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async (context, operation, args) => {
        contexts.push({ context, operation, args });
        return { value: 'dark', revision: 1 };
      })],
      placement: CELL,
      nowMs,
    });

    await expect(store.call(readCall())).resolves.toEqual({
      output: { value: 'dark', revision: 1 },
    });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      context: { resource: { id: 'resource-a' }, canRead: true, canWrite: false },
      operation: 'get',
    });
    await store.close();
  });

  test('revalidates a function write permit at the provider commit edge', async () => {
    const memory = memoryControlStore({ resources: [descriptor()], placements: [placement()] });
    let commits = 0;
    let dispatches = 0;
    const writePermitCoordinator: IResourceWritePermitCoordinator = {
      runWithWritePermit: async (_scope, operation) => operation({
        assertCanCommit: async () => { commits += 1; },
      }),
    };
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async () => {
        dispatches += 1;
        return { value: 'dark', revision: 1 };
      })],
      placement: CELL,
      nowMs: () => 100,
      writeCapabilityVerifier: {
        verifyWriteCapability: async (capability) => capability === 'permit-a' ? {
          permitId: 'permit-a',
          resourceId: 'resource-a',
          invocationId: 'invocation-a',
          operation: 'set',
          operationId: 'operation-a',
          operationFingerprintSha256: OPERATION_FINGERPRINT,
          expiresAtMs: 200,
          nonce: 'nonce-a',
        } : null,
      },
      writePermitCoordinator,
    });
    const call: TResolvedResourceCall = {
      slot: 'preferences',
      resourceId: 'resource-a',
      kind: 'kv',
      requirement: { slot: 'preferences', kind: 'kv', effect: 'read_write' },
      operation: 'set',
      operationId: 'operation-a',
      effect: 'write',
      input: { key: 'theme', value: 'dark' },
      writeCapability: 'permit-a',
    };

    await expect(store.call(call)).resolves.toEqual({
      output: { value: 'dark', revision: 1 },
    });
    expect({ commits, dispatches }).toEqual({ commits: 1, dispatches: 1 });
    await store.close();
  });

  test('requires a write capability before provider dispatch', async () => {
    const memory = memoryControlStore({ resources: [descriptor()], placements: [placement()] });
    let dispatched = false;
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async () => { dispatched = true; })],
      placement: CELL,
      nowMs,
    });

    await expect(store.call({
      slot: 'preferences',
      resourceId: 'resource-a',
      kind: 'kv',
      requirement: { slot: 'preferences', kind: 'kv', effect: 'read_write' },
      operation: 'set',
      effect: 'write',
      input: { key: 'theme', value: 'dark' },
    })).rejects.toMatchObject({ code: 'RESOURCE_WRITE_CAPABILITY_INVALID' });
    expect(dispatched).toBe(false);
    await store.close();
  });

  test('atomically reserves, provisions, and activates a new resource', async () => {
    const memory = memoryControlStore();
    const provisioned: string[] = [];
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async () => undefined, {
        provision: async (resource) => { provisioned.push(resource.id); },
      })],
      placement: CELL,
      nowMs,
    });

    const created = await store.createResource({
      id: 'resource-new',
      kind: 'kv',
      name: 'New resource',
    });
    expect(created.status).toBe('ready');
    expect(provisioned).toEqual(['resource-new']);
    expect(memory.placements.get('resource-new')?.status).toBe('active');
    await store.close();
  });

  test('adopts an unplaced row only through explicit host authority', async () => {
    const unplaced = descriptor('created');
    const memory = memoryControlStore({ resources: [unplaced] });
    let provisioned = 0;
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async () => undefined, {
        provision: async () => { provisioned += 1; },
      })],
      placement: CELL,
      reconciliationAuthority: {
        canAdoptUnplacedResource: async (resource) => resource.id === unplaced.id,
        canDeleteUnplacedResource: async () => false,
      },
      nowMs,
    });

    await store.reconcile();
    expect(provisioned).toBe(1);
    expect(memory.resources.get(unplaced.id)?.status).toBe('ready');
    expect(memory.placements.get(unplaced.id)?.status).toBe('active');
    await store.close();
  });

  test('resolves a logical slot without exposing placement details', async () => {
    const memory = memoryControlStore({ resources: [descriptor()], placements: [placement()] });
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async () => ({ value: 'dark', revision: 1 }))],
      placement: CELL,
      nowMs,
    });
    const gateway = new ResourceGateway({
      store,
      bindings: {
        resolveBinding: async () => ({
          slot: 'preferences',
          resourceId: 'resource-a',
          kind: 'kv',
          allowRead: true,
          allowWrite: false,
        }),
      },
      requirements: {
        resolveRequirement: async () => ({ slot: 'preferences', kind: 'kv', effect: 'read' }),
      },
    });

    await expect(gateway.call({
      slot: 'preferences',
      operation: 'get',
      effect: 'read',
      input: { key: 'theme' },
    })).resolves.toEqual({
      output: { value: 'dark', revision: 1 },
    });
    await store.close();
  });

  test('drains an admitted call before closing providers', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let providerClosed = false;
    const memory = memoryControlStore({ resources: [descriptor()], placements: [placement()] });
    const store = new ResourceStoreService({
      controlStore: memory.controlStore,
      providers: [providerWith(async () => {
        await pending;
        return { value: 'done', revision: 1 };
      }, {
        close: async () => { providerClosed = true; },
      })],
      placement: CELL,
      nowMs,
    });

    const call = store.call(readCall());
    const closing = store.close();
    await Promise.resolve();
    expect(providerClosed).toBe(false);
    release();
    await expect(call).resolves.toEqual({
      output: { value: 'done', revision: 1 },
    });
    await closing;
    expect(providerClosed).toBe(true);
  });
});
