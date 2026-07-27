import { describe, expect, test } from 'bun:test';
import type {
  IResourceControlStore,
  TResourceDescriptor,
  TResourcePlacement,
} from '../src';
import { ResourceGateway, ResourceStoreService } from '../src/local';
import type { ILocalResourceStoreProvider } from '../src/local';

const tenant = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 3,
  roles: ['member'],
  capabilities: [],
  requestId: 'request-a',
} as const;
const OPERATION_FINGERPRINT = 'a'.repeat(64);

function descriptor(status: TResourceDescriptor['status'] = 'ready'): TResourceDescriptor {
  return {
    orgId: tenant.orgId,
    id: 'resource-a',
    kind: 'kv',
    name: 'Preferences',
    status,
    lastError: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function placement(status: TResourcePlacement['status'] = 'active'): TResourcePlacement {
  return {
    orgId: tenant.orgId,
    resourceId: 'resource-a',
    cellId: tenant.cellId,
    placementEpoch: tenant.placementEpoch,
    storageKey: 'resource-a',
    status,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function fakeControlStore(state: {
  resource: TResourceDescriptor;
  placement: TResourcePlacement;
}): IResourceControlStore {
  return {
    listResources: async () => [state.resource],
    getResource: async () => state.resource,
    getPlacement: async () => state.placement,
    updateResourceState: async (
      _tenant: Parameters<IResourceControlStore['updateResourceState']>[0],
      request: Parameters<IResourceControlStore['updateResourceState']>[1],
    ) => {
      const expected = Array.isArray(request.expectedStatus)
        ? request.expectedStatus
        : [request.expectedStatus];
      if (!expected.includes(state.resource.status)) return null;
      state.resource = {
        ...state.resource,
        status: request.status,
        lastError: request.lastError,
        updatedAtMs: request.nowMs,
      };
      return state.resource;
    },
    updatePlacement: async (
      _tenant: Parameters<IResourceControlStore['updatePlacement']>[0],
      request: Parameters<IResourceControlStore['updatePlacement']>[1],
    ) => {
      if (state.placement.placementEpoch !== request.expectedEpoch) return null;
      state.placement = {
        ...state.placement,
        cellId: request.cellId,
        placementEpoch: request.placementEpoch,
        storageKey: request.storageKey,
        status: request.status,
        updatedAtMs: request.nowMs,
      };
      return state.placement;
    },
  } as unknown as IResourceControlStore;
}

describe('Resource Store', () => {
  test('rejects stale placement before provider dispatch', async () => {
    const state = {
      resource: descriptor(),
      placement: { ...placement(), placementEpoch: tenant.placementEpoch + 1 },
    };
    let dispatched = false;
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      effect: () => 'read',
      dispatch: async () => { dispatched = true; return null; },
      provision: async () => undefined,
      delete: async () => undefined,
    };
    const store = new ResourceStoreService({
      controlStore: fakeControlStore(state),
      providers: [provider],
    });
    try {
      await expect(store.call(tenant, {
        slot: 'preferences',
        resourceId: state.resource.id,
        kind: 'kv',
        requirement: { slot: 'preferences', kind: 'kv', effect: 'read' },
        operation: 'get',
        effect: 'read',
        input: { key: 'theme' },
      })).rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      expect(dispatched).toBe(false);
    } finally {
      await store.close();
    }
  });

  test('rejects forged catalog and placement identities before provider access', async () => {
    const mismatches = [
      {
        label: 'foreign catalog organization',
        resource: { ...descriptor(), orgId: 'org-b' },
        placement: placement(),
      },
      {
        label: 'substituted catalog resource',
        resource: { ...descriptor(), id: 'resource-b' },
        placement: placement(),
      },
      {
        label: 'foreign placement organization',
        resource: descriptor(),
        placement: { ...placement(), orgId: 'org-b' },
      },
      {
        label: 'substituted placement resource',
        resource: descriptor(),
        placement: { ...placement(), resourceId: 'resource-b' },
      },
    ];
    let providerAccesses = 0;
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      effect: () => { providerAccesses += 1; return 'read'; },
      dispatch: async () => { providerAccesses += 1; return null; },
      provision: async () => { providerAccesses += 1; },
      delete: async () => { providerAccesses += 1; },
    };

    for (const mismatch of mismatches) {
      const store = new ResourceStoreService({
        controlStore: fakeControlStore(mismatch),
        providers: [provider],
      });
      try {
        await expect(store.call(tenant, {
          slot: 'preferences',
          resourceId: 'resource-a',
          kind: 'kv',
          requirement: { slot: 'preferences', kind: 'kv', effect: 'read' },
          operation: 'get',
          effect: 'read',
          input: { key: 'theme' },
        })).rejects.toMatchObject({ code: 'RESOURCE_PLACEMENT_STALE' });
      } finally {
        await store.close();
      }
    }
    expect(providerAccesses).toBe(0);
  });

  test('serializes writes, validates their capability, and returns committed receipts', async () => {
    const state = { resource: descriptor(), placement: placement() };
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    let activePermitCallbacks = 0;
    let maximumPermitCallbacks = 0;
    const durableReceipts = new Map<string, { output: unknown }>();
    const identities: unknown[] = [];
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      effect: () => 'write',
      dispatch: async () => {
        throw new Error('Fenced writes must use the durable receipt seam.');
      },
      dispatchWithReceipt: async (_context, _operation, _input, identity) => {
        identities.push(identity);
        const durable = durableReceipts.get(identity.operationId);
        if (durable) {
          return { output: durable.output, committed: true, replayed: true };
        }
        started += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        const output = { revision: started };
        durableReceipts.set(identity.operationId, { output });
        return { output, committed: true, replayed: false };
      },
      provision: async () => undefined,
      delete: async () => undefined,
    };
    const store = new ResourceStoreService({
      controlStore: fakeControlStore(state),
      providers: [provider],
      nowMs: () => 100,
      writeCapabilityVerifier: {
        verifyWriteCapability: async (_tenant, capability) => capability.startsWith('valid:')
          ? {
            orgId: tenant.orgId,
            permitId: `permit-${capability.slice('valid:'.length)}`,
            resourceId: state.resource.id,
            invocationId: 'invocation-a',
            operation: 'set',
            operationId: capability.slice('valid:'.length),
            operationFingerprintSha256: OPERATION_FINGERPRINT,
            attemptId: 'attempt-a',
            leaseEpoch: 1,
            expiresAtMs: 200,
            nonce: 'nonce-a',
          }
          : null,
      },
      writePermitCoordinator: {
        runWithWritePermit: async (_tenant, _scope, operation) => {
          activePermitCallbacks += 1;
          maximumPermitCallbacks = Math.max(maximumPermitCallbacks, activePermitCallbacks);
          try {
            return await operation({ assertCanCommit: async () => undefined });
          } finally {
            activePermitCallbacks -= 1;
          }
        },
      },
    });
    try {
      const call = (operationId: string) => store.call(tenant, {
        slot: 'preferences',
        resourceId: state.resource.id,
        kind: 'kv',
        requirement: { slot: 'preferences', kind: 'kv', effect: 'write' },
        operation: 'set',
        operationId,
        effect: 'write',
        input: { key: operationId, value: true },
        writeCapability: `valid:${operationId}`,
      });
      const first = call('operation-a');
      await Bun.sleep(1);
      const second = call('operation-b');
      await Bun.sleep(1);
      expect(started).toBe(1);
      releases.shift()?.();
      await Bun.sleep(1);
      expect(started).toBe(2);
      releases.shift()?.();
      const results = await Promise.all([first, second]);
      expect(maximumActive).toBe(1);
      expect(maximumPermitCallbacks).toBe(1);
      expect(activePermitCallbacks).toBe(0);
      expect(results.map((result) => result.receipt)).toEqual([
        { operationId: 'operation-a', resourceId: 'resource-a', effect: 'write', committed: true, replayed: false },
        { operationId: 'operation-b', resourceId: 'resource-a', effect: 'write', committed: true, replayed: false },
      ]);
      expect(identities).toEqual([
        {
          orgId: tenant.orgId,
          resourceId: 'resource-a',
          invocationId: 'invocation-a',
          attemptId: 'attempt-a',
          operationId: 'operation-a',
          operationFingerprintSha256: OPERATION_FINGERPRINT,
        },
        {
          orgId: tenant.orgId,
          resourceId: 'resource-a',
          invocationId: 'invocation-a',
          attemptId: 'attempt-a',
          operationId: 'operation-b',
          operationFingerprintSha256: OPERATION_FINGERPRINT,
        },
      ]);

      const replay = await call('operation-a');
      expect(replay).toEqual({
        output: { revision: 1 },
        receipt: {
          operationId: 'operation-a',
          resourceId: 'resource-a',
          effect: 'write',
          committed: true,
          replayed: true,
        },
      });
      expect(started).toBe(2);
    } finally {
      releases.splice(0).forEach((release) => release());
      await store.close();
    }
  });

  test('reconciles a provider-owned commit receipt into one unresolved main-ledger permit', async () => {
    const state = { resource: descriptor(), placement: placement() };
    const candidate = {
      permitId: 'permit-a',
      resourceId: state.resource.id,
      invocationId: 'invocation-a',
      attemptId: 'attempt-a',
      leaseEpoch: 1,
      operationName: 'set',
      operationId: 'operation-a',
      operationFingerprintSha256: OPERATION_FINGERPRINT,
    } as const;
    let unresolved = true;
    const reconciled: unknown[] = [];
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      effect: () => 'write',
      dispatch: async () => { throw new Error('Recovery must not rerun the mutation.'); },
      dispatchWithReceipt: async () => { throw new Error('Recovery must not rerun the mutation.'); },
      readCommittedOperation: async () => ({
        invocationId: candidate.invocationId,
        operationId: candidate.operationId,
        attemptId: candidate.attemptId,
        operationName: candidate.operationName,
        operationFingerprintSha256: candidate.operationFingerprintSha256,
        output: { revision: 1 },
      }),
      provision: async () => undefined,
      delete: async () => undefined,
    };
    const store = new ResourceStoreService({
      controlStore: fakeControlStore(state),
      providers: [provider],
      nowMs: () => 200,
      writePermitCoordinator: {
        runWithWritePermit: async (_tenant, _scope, operation) => (
          operation({ assertCanCommit: async () => undefined })
        ),
        listRecoverableWritePermits: async () => unresolved ? [candidate] : [],
        reconcileCommittedWritePermit: async (_tenant, write) => {
          reconciled.push(write);
          unresolved = false;
          return { status: 'consumed' };
        },
      },
    });
    try {
      await store.reconcile(tenant);
      await store.reconcile(tenant);
      expect(reconciled).toEqual([{
        ...candidate,
        output: { revision: 1 },
        recordedAtMs: 200,
      }]);
    } finally {
      await store.close();
    }
  });

  test('recovers a created catalog row through provisioning and placement activation', async () => {
    const state = { resource: descriptor('created'), placement: placement('reserved') };
    let provisioned = 0;
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      reconcileReady: true,
      effect: () => null,
      dispatch: async () => null,
      provision: async () => { provisioned += 1; },
      delete: async () => undefined,
      reconcile: async () => ({ status: 'ready' }),
    };
    const store = new ResourceStoreService({
      controlStore: fakeControlStore(state),
      providers: [provider],
      nowMs: () => 50,
    });
    try {
      await store.reconcile(tenant);
      expect(provisioned).toBe(1);
      expect(state.resource.status).toBe('ready');
      expect(state.placement.status).toBe('active');
    } finally {
      await store.close();
    }
  });

  test('drains an admitted reconciliation before provider close', async () => {
    const state = { resource: descriptor(), placement: placement() };
    const controlStore = fakeControlStore(state);
    const events: string[] = [];
    let releaseList: (() => void) | undefined;
    let markListStarted: (() => void) | undefined;
    const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
    const listStarted = new Promise<void>((resolve) => { markListStarted = resolve; });
    Object.assign(controlStore, {
      listResources: async () => {
        events.push('list-start');
        markListStarted?.();
        await listGate;
        events.push('list-resume');
        return [state.resource];
      },
    });
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      reconcileReady: true,
      effect: () => null,
      dispatch: async () => undefined,
      provision: async () => undefined,
      delete: async () => undefined,
      reconcile: async () => {
        events.push('provider-reconcile');
        return { status: 'ready' };
      },
      close: async () => { events.push('provider-close'); },
    };
    const store = new ResourceStoreService({
      controlStore,
      providers: [provider],
    });

    try {
      const reconciling = store.reconcile(tenant);
      await listStarted;
      let closeSettled = false;
      const closing = store.close().finally(() => { closeSettled = true; });
      await Promise.resolve();

      expect(closeSettled).toBe(false);
      expect(events).toEqual(['list-start']);

      releaseList?.();
      await Promise.all([reconciling, closing]);
      expect(events).toEqual([
        'list-start',
        'list-resume',
        'provider-reconcile',
        'provider-close',
      ]);
    } finally {
      releaseList?.();
      await store.close().catch(() => undefined);
    }
  });

  test('does not touch a provider during startup reconciliation for an inactive placement', async () => {
    const state = { resource: descriptor('provisioning'), placement: placement('moving') };
    let reconciled = 0;
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      effect: () => null,
      dispatch: async () => null,
      provision: async () => undefined,
      delete: async () => undefined,
      reconcile: async () => {
        reconciled += 1;
        return { status: 'ready' };
      },
    };
    const store = new ResourceStoreService({
      controlStore: fakeControlStore(state),
      providers: [provider],
    });

    try {
      await store.reconcile(tenant);
      expect(reconciled).toBe(0);
      expect(state.resource.status).toBe('provisioning');
      expect(state.placement.status).toBe('moving');
    } finally {
      await store.close();
    }
  });

  test('atomically reserves and activates a resource created after store startup', async () => {
    const state = { resource: descriptor('error'), placement: placement('reserved') };
    const controlStore = fakeControlStore(state);
    Object.assign(controlStore, {
      createResource: async (
        _tenant: Parameters<IResourceControlStore['createResource']>[0],
        request: Parameters<IResourceControlStore['createResource']>[1],
      ) => {
        state.resource = {
          orgId: tenant.orgId,
          id: request.id,
          kind: request.kind,
          name: request.name,
          status: 'created',
          lastError: null,
          createdAtMs: request.nowMs,
          updatedAtMs: request.nowMs,
        };
        state.placement = {
          orgId: tenant.orgId,
          resourceId: request.id,
          cellId: request.cellId,
          placementEpoch: request.placementEpoch,
          storageKey: request.storageKey,
          status: 'reserved',
          createdAtMs: request.nowMs,
          updatedAtMs: request.nowMs,
        };
        return state.resource;
      },
    });
    let provisioned = 0;
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      provision: async () => { provisioned += 1; },
      delete: async () => undefined,
      effect: () => null,
      dispatch: async () => undefined,
    };
    const store = new ResourceStoreService({
      controlStore,
      providers: [provider],
      nowMs: () => 75,
    });

    try {
      await expect(store.createResource(tenant, {
        id: 'resource-a',
        kind: 'kv',
        name: 'Preferences',
      })).resolves.toMatchObject({ status: 'ready' });
      expect(provisioned).toBe(1);
      expect(state.placement.status).toBe('active');
      expect(state.placement.storageKey).toBe('resource-a');
    } finally {
      await store.close();
    }
  });

  test('does not publish ready or write an error when placement activation loses its CAS', async () => {
    const state = { resource: descriptor('error'), placement: placement('reserved') };
    const controlStore = fakeControlStore(state);
    Object.assign(controlStore, {
      createResource: async (
        _tenant: Parameters<IResourceControlStore['createResource']>[0],
        request: Parameters<IResourceControlStore['createResource']>[1],
      ) => {
        state.resource = {
          orgId: tenant.orgId,
          id: request.id,
          kind: request.kind,
          name: request.name,
          status: 'created',
          lastError: null,
          createdAtMs: request.nowMs,
          updatedAtMs: request.nowMs,
        };
        state.placement = {
          orgId: tenant.orgId,
          resourceId: request.id,
          cellId: tenant.cellId,
          placementEpoch: tenant.placementEpoch,
          storageKey: request.storageKey,
          status: 'reserved',
          createdAtMs: request.nowMs,
          updatedAtMs: request.nowMs,
        };
        return state.resource;
      },
      updatePlacement: async () => {
        state.placement = {
          ...state.placement,
          placementEpoch: tenant.placementEpoch + 1,
          status: 'moving',
        };
        return null;
      },
    });
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: () => null,
      dispatch: async () => undefined,
    };
    const store = new ResourceStoreService({
      controlStore,
      providers: [provider],
      nowMs: () => 80,
    });

    try {
      await expect(store.createResource(tenant, {
        id: 'resource-a',
        kind: 'kv',
        name: 'Preferences',
      })).rejects.toMatchObject({
        code: 'RESOURCE_NOT_READY',
      });
      expect(state.resource).toMatchObject({
        status: 'provisioning',
        lastError: null,
      });
      expect(state.placement).toMatchObject({
        placementEpoch: tenant.placementEpoch + 1,
        status: 'moving',
      });
    } finally {
      await store.close();
    }
  });

  test('adopts an unplaced resource only with explicit matching host authority', async () => {
    const state = { resource: descriptor('ready'), placement: placement('reserved') };
    const controlStore = fakeControlStore(state);
    let adoptedPlacement: TResourcePlacement | null = null;
    let reconciled = 0;
    Object.assign(controlStore, {
      getPlacement: async () => adoptedPlacement,
      reservePlacement: async (
        _tenant: Parameters<IResourceControlStore['reservePlacement']>[0],
        request: Parameters<IResourceControlStore['reservePlacement']>[1],
      ) => {
        adoptedPlacement = {
          orgId: tenant.orgId,
          resourceId: request.resourceId,
          cellId: request.cellId,
          placementEpoch: request.placementEpoch,
          storageKey: request.storageKey,
          status: 'reserved',
          createdAtMs: request.nowMs,
          updatedAtMs: request.nowMs,
        };
        return adoptedPlacement;
      },
      updatePlacement: async (
        _tenant: Parameters<IResourceControlStore['updatePlacement']>[0],
        request: Parameters<IResourceControlStore['updatePlacement']>[1],
      ) => {
        if (!adoptedPlacement || adoptedPlacement.placementEpoch !== request.expectedEpoch) return null;
        adoptedPlacement = {
          ...adoptedPlacement,
          cellId: request.cellId,
          placementEpoch: request.placementEpoch,
          storageKey: request.storageKey,
          status: request.status,
          updatedAtMs: request.nowMs,
        };
        return adoptedPlacement;
      },
    });
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      reconcileReady: true,
      provision: async () => undefined,
      delete: async () => undefined,
      reconcile: async () => { reconciled += 1; return { status: 'ready' }; },
      effect: () => null,
      dispatch: async () => undefined,
    };
    const store = new ResourceStoreService({
      controlStore,
      providers: [provider],
      reconciliationAuthority: {
        canAdoptUnplacedResource: (context, resource) => (
          context.orgId === tenant.orgId
          && context.cellId === tenant.cellId
          && context.placementEpoch === tenant.placementEpoch
          && resource.orgId === tenant.orgId
          && resource.id === 'resource-a'
        ),
        canDeleteUnplacedResource: () => false,
      },
      nowMs: () => 90,
    });

    try {
      await store.reconcile({
        ...tenant,
        cellId: 'cell-stale',
        placementEpoch: tenant.placementEpoch - 1,
        requestId: 'request-stale',
      });
      expect(reconciled).toBe(0);
      expect(adoptedPlacement).toBeNull();

      await store.reconcile(tenant);
      expect(reconciled).toBe(1);
      expect(adoptedPlacement).toMatchObject({
        resourceId: 'resource-a',
        storageKey: 'resource-a',
        status: 'active',
      });
    } finally {
      await store.close();
    }
  });

  test('does not delete an unplaced resource without explicit reconciliation authority', async () => {
    const state = { resource: descriptor('deleting'), placement: placement() };
    let deletedPhysical = 0;
    let deletedCatalog = 0;
    const controlStore = fakeControlStore(state);
    Object.assign(controlStore, {
      getPlacement: async () => null,
      deleteResource: async () => {
        deletedCatalog += 1;
        return true;
      },
    });
    const store = new ResourceStoreService({
      controlStore,
      providers: [{
        kind: 'kv',
        provision: async () => undefined,
        delete: async () => { deletedPhysical += 1; },
        effect: () => null,
        dispatch: async () => undefined,
      }],
    });

    try {
      await store.reconcile(tenant);
      expect(deletedPhysical).toBe(0);
      expect(deletedCatalog).toBe(0);
    } finally {
      await store.close();
    }
  });

  test('keeps placement authority until a placement-owned delete removes the catalog row', async () => {
    const state = { resource: descriptor('deleting'), placement: placement() };
    let deletedPhysical = 0;
    let deletedPlacement = 0;
    let deletedCatalog = 0;
    const controlStore = fakeControlStore(state);
    Object.assign(controlStore, {
      deletePlacement: async () => {
        deletedPlacement += 1;
        return true;
      },
      deleteResource: async () => {
        deletedCatalog += 1;
        return true;
      },
    });
    const store = new ResourceStoreService({
      controlStore,
      providers: [{
        kind: 'kv',
        provision: async () => undefined,
        delete: async () => { deletedPhysical += 1; },
        effect: () => null,
        dispatch: async () => undefined,
      }],
    });

    try {
      await store.reconcile(tenant);
      expect(deletedPhysical).toBe(1);
      expect(deletedPlacement).toBe(0);
      expect(deletedCatalog).toBe(1);
    } finally {
      await store.close();
    }
  });

  test('finishes an unplaced interrupted delete only with explicit matching host authority', async () => {
    const state = { resource: descriptor('deleting'), placement: placement() };
    let deletedPhysical = 0;
    let deletedCatalog = 0;
    const controlStore = fakeControlStore(state);
    Object.assign(controlStore, {
      getPlacement: async () => null,
      deletePlacement: async () => false,
      deleteResource: async () => {
        deletedCatalog += 1;
        return true;
      },
    });
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      provision: async () => undefined,
      delete: async () => { deletedPhysical += 1; },
      effect: () => null,
      dispatch: async () => undefined,
    };
    const store = new ResourceStoreService({
      controlStore,
      providers: [provider],
      reconciliationAuthority: {
        canAdoptUnplacedResource: () => false,
        canDeleteUnplacedResource: (context, resource) => (
          context.orgId === tenant.orgId
          && context.cellId === tenant.cellId
          && context.placementEpoch === tenant.placementEpoch
          && resource.orgId === tenant.orgId
          && resource.id === 'resource-a'
        ),
      },
    });

    try {
      await store.reconcile({
        ...tenant,
        cellId: 'cell-stale',
        placementEpoch: tenant.placementEpoch - 1,
        requestId: 'request-stale',
      });
      expect(deletedPhysical).toBe(0);
      expect(deletedCatalog).toBe(0);

      await store.reconcile(tenant);
      expect(deletedPhysical).toBe(1);
      expect(deletedCatalog).toBe(1);
    } finally {
      await store.close();
    }
  });

  test('preserves host-derived named DB operations through gateway and store dispatch', async () => {
    const state = {
      resource: { ...descriptor(), kind: 'db' as const },
      placement: placement(),
    };
    const namedOperation = {
      effect: 'read' as const,
      sql: 'SELECT value FROM settings WHERE name = :name',
      parameters: { name: { type: 'string' as const } },
      result: 'rows' as const,
    };
    let dispatchedRequirement: unknown;
    const provider: ILocalResourceStoreProvider = {
      kind: 'db',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: (_operation, requirement, input) => {
        const operationName = (input as { operation?: string }).operation;
        return operationName ? requirement.operations?.[operationName]?.effect ?? null : null;
      },
      dispatch: async (context) => {
        dispatchedRequirement = context.requirement;
        return [{ value: 'dark' }];
      },
    };
    const store = new ResourceStoreService({
      controlStore: fakeControlStore(state),
      providers: [provider],
    });
    const requirement = {
      slot: 'settings',
      kind: 'db' as const,
      effect: 'read' as const,
      required: true,
      arbitrarySql: false,
      operations: { getSetting: namedOperation },
    };
    const gateway = new ResourceGateway({
      store,
      bindings: {
        resolveBinding: async () => ({
          slot: 'settings',
          resourceId: state.resource.id,
          kind: 'db',
          allowRead: true,
          allowWrite: false,
        }),
      },
      requirements: { resolveRequirement: async () => requirement },
    });

    try {
      await expect(gateway.call(tenant, {
        slot: 'settings',
        kind: 'db',
        operation: 'invoke',
        effect: 'read',
        input: { operation: 'getSetting', parameters: { name: 'theme' } },
      })).resolves.toEqual({ output: [{ value: 'dark' }] });
      expect(dispatchedRequirement).toEqual({ ...requirement, scope: ['read'] });
    } finally {
      await store.close();
    }
  });

  test('surfaces provider close failures and supports a clean retry', async () => {
    const state = { resource: descriptor(), placement: placement() };
    let failClose = true;
    const provider: ILocalResourceStoreProvider = {
      kind: 'kv',
      provision: async () => undefined,
      delete: async () => undefined,
      effect: () => null,
      dispatch: async () => undefined,
      close: async () => {
        if (failClose) throw new Error('handle stayed open');
      },
    };
    const store = new ResourceStoreService({
      controlStore: fakeControlStore(state),
      providers: [provider],
    });

    await expect(store.close()).rejects.toBeInstanceOf(AggregateError);
    failClose = false;
    await store.close();
  });

  test('resolves a logical slot without exposing resource placement details', async () => {
    const calls: unknown[] = [];
    const gateway = new ResourceGateway({
      store: {
        call: async (_tenant, call) => { calls.push(call); return { output: 'dark' }; },
        reconcile: async () => undefined,
        close: async () => undefined,
      },
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

    await expect(gateway.call(tenant, {
      slot: 'preferences',
      kind: 'kv',
      operation: 'get',
      effect: 'read',
      input: { key: 'theme' },
    })).resolves.toEqual({ output: 'dark' });
    expect(calls).toEqual([{
      slot: 'preferences',
      resourceId: 'resource-a',
      kind: 'kv',
      requirement: { slot: 'preferences', kind: 'kv', effect: 'read' },
      operation: 'get',
      operationId: undefined,
      effect: 'read',
      input: { key: 'theme' },
    }]);
  });
});
