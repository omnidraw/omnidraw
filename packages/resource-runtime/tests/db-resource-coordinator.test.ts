import { describe, expect, test } from 'bun:test';
import type { IResourceUseCoordinator } from '../src/interface';
import {
  DbResourceCoordinator,
  type IDbResourceCoordinatorControlStore,
  type IDbResourceCoordinatorManager,
  type IDbResourceLifecycle,
} from '../src/local/DbResourceCoordinator';
import type { TTenantContext } from '@vibecanvas/tenant-core';

const TENANT = Object.freeze({
  orgId: 'org-coordinator',
  accountId: 'account-coordinator',
  cellId: 'cell-coordinator',
  placementEpoch: 3,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['*']),
  requestId: 'request-coordinator',
}) satisfies TTenantContext;

const SECOND_TENANT = Object.freeze({
  ...TENANT,
  accountId: 'account-second',
  requestId: 'request-second',
}) satisfies TTenantContext;

describe('DbResourceCoordinator', () => {
  test('reports legacy-compatible impact through the tenant-aware neutral use coordinator', async () => {
    const inspections: { tenant: TTenantContext; resourceId: string }[] = [];
    const useCoordinator: IResourceUseCoordinator = {
      inspect: async (tenant, resourceId) => {
        inspections.push({ tenant, resourceId });
        return {
          resourceId,
          uses: [{ id: 'instance-running', kind: 'actor', state: 'active' }],
        };
      },
      drain: async () => { throw new Error('not used'); },
      release: async () => { throw new Error('not used'); },
    };
    const resource = {
      id: 'resource-db',
      kind: 'db' as const,
      name: 'Notes',
      status: 'ready' as const,
      last_error: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const controlStore = {
      actorResource: {
        listBindingsForResource: async () => [{
          actor_definition_name: 'Notes widget',
          slot_name: 'notes',
          allow_read: true,
          allow_write: false,
        }],
      },
      dbResource: {
        listAffectedInstances: async () => [
          { id: 'instance-running', actor_definition_name: 'Notes widget', status: 'running' },
          { id: 'instance-stopped', actor_definition_name: 'Notes widget', status: 'stopped' },
        ],
      },
    } as unknown as IDbResourceCoordinatorControlStore;
    const resourceManager = {
      getResource: async () => resource,
    } as unknown as IDbResourceCoordinatorManager;
    const coordinator = new DbResourceCoordinator({
      tenant: TENANT,
      controlStore,
      resourceManager,
      useCoordinator,
      dbResource: {} as IDbResourceLifecycle,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    });

    await expect(coordinator.impact(TENANT, resource.id)).resolves.toEqual({
      resource,
      definitions: [{
        definitionName: 'Notes widget',
        slots: [{ slot: 'notes', scope: ['read'] }],
      }],
      instances: [
        {
          instanceId: 'instance-running',
          definitionName: 'Notes widget',
          status: 'running',
          running: true,
        },
        {
          instanceId: 'instance-stopped',
          definitionName: 'Notes widget',
          status: 'stopped',
          running: false,
        },
      ],
    });
    expect(inspections).toEqual([{ tenant: TENANT, resourceId: resource.id }]);
  });

  test('keeps concurrent request account authority distinct during impact inspection', async () => {
    const inspections: { tenant: TTenantContext; resourceId: string }[] = [];
    const useCoordinator: IResourceUseCoordinator = {
      inspect: async (tenant, resourceId) => {
        await Promise.resolve();
        inspections.push({ tenant, resourceId });
        return { resourceId, uses: [] };
      },
      drain: async () => { throw new Error('not used'); },
      release: async () => { throw new Error('not used'); },
    };
    const resourceManager = {
      getResource: async (resourceId: string) => ({
        id: resourceId,
        kind: 'db' as const,
        name: resourceId,
        status: 'ready' as const,
        last_error: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    } as unknown as IDbResourceCoordinatorManager;
    const controlStore = {
      actorResource: { listBindingsForResource: async () => [] },
      dbResource: { listAffectedInstances: async () => [] },
    } as unknown as IDbResourceCoordinatorControlStore;
    const coordinator = new DbResourceCoordinator({
      tenant: TENANT,
      controlStore,
      resourceManager,
      useCoordinator,
      dbResource: {} as IDbResourceLifecycle,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000002' },
    });

    await Promise.all([
      coordinator.impact(TENANT, 'resource-first'),
      coordinator.impact(SECOND_TENANT, 'resource-second'),
    ]);

    expect(inspections).toEqual(expect.arrayContaining([
      { tenant: TENANT, resourceId: 'resource-first' },
      { tenant: SECOND_TENANT, resourceId: 'resource-second' },
    ]));
    expect(inspections).toHaveLength(2);
  });

  test('filters startup physical reconciliation by active placement ownership', async () => {
    const touchedResources: string[] = [];
    const resources = ['resource-owned', 'resource-stale'].map((id) => ({
      id,
      kind: 'db' as const,
      name: id,
      status: 'ready' as const,
      last_error: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }));
    const controlStore = {
      actorResource: {},
      dbResource: {
        apply: {
          list: async ({ resourceId }: { resourceId: string }) => {
            touchedResources.push(resourceId);
            return [];
          },
        },
        draft: {
          getActive: async ({ resourceId }: { resourceId: string }) => {
            touchedResources.push(resourceId);
            return null;
          },
        },
      },
    } as unknown as IDbResourceCoordinatorControlStore;
    const resourceManager = {
      listResources: async () => resources,
    } as unknown as IDbResourceCoordinatorManager;
    const coordinator = new DbResourceCoordinator({
      tenant: TENANT,
      controlStore,
      resourceManager,
      useCoordinator: {} as IResourceUseCoordinator,
      dbResource: {} as IDbResourceLifecycle,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000003' },
    });

    await coordinator.reconcileStartup({
      tenant: TENANT,
      isPlacementOwned: (resource) => resource.id === 'resource-owned',
    });

    expect(touchedResources).toEqual([
      'resource-owned',
      'resource-owned',
      'resource-owned',
    ]);
  });

  test('retains request tenants and drains apply work detached after shutdown begins', async () => {
    const resource = (id: string) => ({
      id,
      kind: 'db' as const,
      name: id,
      status: 'ready' as const,
      last_error: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const resources = new Map([
      ['resource-first', resource('resource-first')],
      ['resource-second', resource('resource-second')],
    ]);
    const draft = (id: string, resourceId: string) => ({
      id,
      resource_id: resourceId,
      name: id,
      status: 'editing' as const,
      last_error: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      applied_at: null,
    });
    const drafts = new Map([
      ['draft-first', draft('draft-first', 'resource-first')],
      ['draft-second', draft('draft-second', 'resource-second')],
    ]);
    const applies = new Map<string, {
      id: string;
      resource_id: string;
      draft_id: string;
      source_apply_id: null;
      status: 'preparing' | 'stopping' | 'applying' | 'restarting' | 'succeeded' | 'failed' | 'recovered';
      last_error: unknown | null;
      backup_retained: boolean;
      created_at: string;
      completed_at: string | null;
    }>();
    const useCalls: Array<{
      method: 'inspect' | 'drain' | 'release';
      tenant: TTenantContext;
      resourceId: string;
    }> = [];
    let releaseDetachedRun!: () => void;
    let markDetachedRunStarted!: () => void;
    const detachedRunGate = new Promise<void>((resolve) => { releaseDetachedRun = resolve; });
    const detachedRunStarted = new Promise<void>((resolve) => { markDetachedRunStarted = resolve; });
    let heldDetachedRun = false;
    const useCoordinator: IResourceUseCoordinator = {
      inspect: async (tenant, resourceId) => {
        useCalls.push({ method: 'inspect', tenant, resourceId });
        return { resourceId, uses: [] };
      },
      drain: async (tenant, request) => {
        useCalls.push({ method: 'drain', tenant, resourceId: request.resourceId });
        if (request.resourceId === 'resource-first' && !heldDetachedRun) {
          heldDetachedRun = true;
          markDetachedRunStarted();
          await detachedRunGate;
        }
        return {
          ok: true,
          lease: {
            resourceId: request.resourceId,
            leaseId: `lease:${request.resourceId}`,
            leaseEpoch: 1,
            expiresAtMs: 1_000,
            drainedUses: [],
          },
        };
      },
      release: async (tenant, lease, mode) => {
        useCalls.push({ method: 'release', tenant, resourceId: lease.resourceId });
        return { resourceId: lease.resourceId, released: true, mode, resumedUseIds: [] };
      },
    };
    let releaseValidation!: () => void;
    let markValidationStarted!: () => void;
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const validationStarted = new Promise<void>((resolve) => { markValidationStarted = resolve; });
    let heldValidation = false;
    const controlStore = {
      actorResource: {
        listBindingsForResource: async () => [],
        updateProviderState: async ({ id }: { id: string }) => resources.get(id) ?? null,
      },
      dbResource: {
        draft: {
          get: async ({ id }: { id: string }) => drafts.get(id) ?? null,
          getActive: async () => null,
          change: {
            list: async ({ draftId }: { draftId: string }) => {
              if (draftId === 'draft-first' && !heldValidation) {
                heldValidation = true;
                markValidationStarted();
                await validationGate;
              }
              return [];
            },
          },
        },
        apply: {
          createFromDraft: async ({ id, resourceId, draftId }: {
            id: string;
            resourceId: string;
            draftId: string;
          }) => {
            const apply = {
              id,
              resource_id: resourceId,
              draft_id: draftId,
              source_apply_id: null,
              status: 'preparing' as const,
              last_error: null,
              backup_retained: false,
              created_at: '2026-01-01T00:00:00.000Z',
              completed_at: null,
            };
            applies.set(id, apply);
            return { apply, draft: drafts.get(draftId)! };
          },
          get: async ({ id }: { id: string }) => applies.get(id) ?? null,
          list: async ({ resourceId }: { resourceId: string }) => (
            [...applies.values()].filter((apply) => apply.resource_id === resourceId)
          ),
          update: async (args: {
            id: string;
            status: 'preparing' | 'stopping' | 'applying' | 'restarting' | 'succeeded' | 'failed' | 'recovered';
            lastError?: unknown | null;
            backupRetained?: boolean;
          }) => {
            const current = applies.get(args.id);
            if (!current) return null;
            const updated = {
              ...current,
              status: args.status,
              last_error: args.lastError ?? current.last_error,
              backup_retained: args.backupRetained ?? current.backup_retained,
            };
            applies.set(args.id, updated);
            return updated;
          },
          finishWithDraft: async (args: {
            id: string;
            draftId: string;
            status: 'succeeded' | 'failed' | 'recovered';
          }) => {
            const current = applies.get(args.id);
            const currentDraft = drafts.get(args.draftId);
            if (!current || !currentDraft) return null;
            const updated = { ...current, status: args.status };
            applies.set(args.id, updated);
            return { apply: updated, draft: currentDraft };
          },
          instanceResult: {
            upsert: async () => { throw new Error('no instances expected'); },
            listByApply: async () => [],
          },
        },
        listAffectedInstances: async () => [],
      },
    } as unknown as IDbResourceCoordinatorControlStore;
    const resourceManager = {
      getResource: async (resourceId: string) => resources.get(resourceId) ?? null,
      withReadyResource: async <T>(
        resourceId: string,
        operation: (current: ReturnType<typeof resource>) => Promise<T>,
      ) => operation(resources.get(resourceId)!),
      coordinateResourceApply: async <T>(
        resourceId: string,
        operation: (current: ReturnType<typeof resource>) => Promise<T>,
      ) => operation(resources.get(resourceId)!),
      drainResource: async () => undefined,
    } as unknown as IDbResourceCoordinatorManager;
    const dbResource = {
      listDraftChangeEvidence: async () => [],
      applyDraft: async () => ({ outcome: 'succeeded', error: null, backupRetained: false }),
      discardDraft: async () => undefined,
    } as unknown as IDbResourceLifecycle;
    let uuid = 0;
    const coordinator = new DbResourceCoordinator({
      tenant: TENANT,
      controlStore,
      resourceManager,
      useCoordinator,
      dbResource,
      crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    });

    const confirmations = Promise.all([
      coordinator.confirmApply(TENANT, 'draft-first'),
      coordinator.confirmApply(SECOND_TENANT, 'draft-second'),
    ]);
    await validationStarted;
    let closeSettled = false;
    const closing = coordinator.close().finally(() => { closeSettled = true; });
    releaseValidation();
    await confirmations;
    await detachedRunStarted;
    await Bun.sleep(10);
    expect(closeSettled).toBe(false);
    releaseDetachedRun();
    await closing;

    const expectedAccountByResource = new Map([
      ['resource-first', TENANT.accountId],
      ['resource-second', SECOND_TENANT.accountId],
    ]);
    expect(useCalls).toHaveLength(8);
    for (const call of useCalls) {
      expect(call.tenant.accountId).toBe(expectedAccountByResource.get(call.resourceId)!);
    }
    for (const resourceId of expectedAccountByResource.keys()) {
      expect(useCalls.filter((call) => call.resourceId === resourceId).map((call) => call.method)).toEqual([
        'inspect',
        'drain',
        'release',
        'inspect',
      ]);
    }
  });
});
