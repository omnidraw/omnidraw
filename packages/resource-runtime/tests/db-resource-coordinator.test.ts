import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { IResourceControlStore, IResourceUseCoordinator } from '../src/interface';
import { DbResourceCoordinator } from '../src/local/DbResourceCoordinator';
import type {
  IDbResourceCoordinatorControlStore,
  IDbResourceLifecycle,
  TDbCoordinatorApplyRun,
  TDbCoordinatorDraft,
  TDbCoordinatorDraftChange,
  TDbResourceCoordinatorDiagnostic,
} from '../src/local/DbResourceCoordinator';
import type { TResourceDescriptor } from '../src/types';

const tenant: TTenantContext = {
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: ['owner'],
  capabilities: ['*'],
  requestId: 'request-a',
};

const useCoordinator: IResourceUseCoordinator = {
  inspect: async (_tenant, resourceId) => ({ resourceId, uses: [] }),
  drain: async (_tenant, request) => ({
    ok: true,
    lease: {
      resourceId: request.resourceId,
      leaseId: 'lease-a',
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

function createMemoryStore(now: () => number) {
  const drafts = new Map<string, TDbCoordinatorDraft>();
  const changes = new Map<string, TDbCoordinatorDraftChange[]>();
  const applies = new Map<string, TDbCoordinatorApplyRun>();
  const iso = () => new Date(now()).toISOString();
  let failTerminalWrites = false;
  const store: IDbResourceCoordinatorControlStore = {
    dbResource: {
      draft: {
        create: async ({ id, resourceId, name }) => {
          const draft: TDbCoordinatorDraft = {
            id, resource_id: resourceId, name, status: 'editing',
            last_error: null, created_at: iso(), updated_at: iso(), applied_at: null,
          };
          drafts.set(id, draft);
          return draft;
        },
        get: async ({ id }) => drafts.get(id) ?? null,
        getActive: async ({ resourceId }) => [...drafts.values()].find((draft) => (
          draft.resource_id === resourceId && (draft.status === 'editing' || draft.status === 'applying')
        )) ?? null,
        list: async ({ resourceId, status }) => [...drafts.values()].filter((draft) => (
          draft.resource_id === resourceId && (!status || draft.status === status)
        )),
        updateStatus: async ({ id, status, expectedStatus, lastError }) => {
          const draft = drafts.get(id);
          if (!draft || (expectedStatus && draft.status !== expectedStatus)) return null;
          const next: TDbCoordinatorDraft = {
            ...draft, status, last_error: lastError ?? null, updated_at: iso(),
            applied_at: status === 'applied' ? iso() : draft.applied_at,
          };
          drafts.set(id, next);
          return next;
        },
        discard: async ({ id, lastError }) => {
          const draft = drafts.get(id);
          if (!draft) return null;
          const next: TDbCoordinatorDraft = { ...draft, status: 'discarded', last_error: lastError ?? null, updated_at: iso() };
          drafts.set(id, next);
          return next;
        },
        change: {
          list: async ({ draftId }) => changes.get(draftId) ?? [],
          append: async (args) => {
            const change: TDbCoordinatorDraftChange = {
              draft_id: args.draftId, sequence: args.sequence, kind: args.kind,
              operation: args.operation ?? null, sql: args.sql, created_at: iso(),
            };
            changes.set(args.draftId, [...changes.get(args.draftId) ?? [], change]);
            return change;
          },
        },
      },
      apply: {
        create: async ({ id, resourceId, draftId, sourceApplyId, status }) => {
          const apply: TDbCoordinatorApplyRun = {
            id, resource_id: resourceId, draft_id: draftId ?? null, source_apply_id: sourceApplyId ?? null,
            status: status ?? 'preparing', last_error: null, backup_retained: false,
            created_at: iso(), completed_at: null,
          };
          applies.set(id, apply);
          return apply;
        },
        createFromDraft: async ({ id, resourceId, draftId }) => {
          const draft = drafts.get(draftId);
          if (!draft) throw new Error('draft missing');
          const apply: TDbCoordinatorApplyRun = {
            id, resource_id: resourceId, draft_id: draftId, source_apply_id: null,
            status: 'preparing', last_error: null, backup_retained: false,
            created_at: iso(), completed_at: null,
          };
          applies.set(id, apply);
          const nextDraft: TDbCoordinatorDraft = { ...draft, status: 'applying', updated_at: iso() };
          drafts.set(draftId, nextDraft);
          return { apply, draft: nextDraft };
        },
        get: async ({ id }) => applies.get(id) ?? null,
        list: async ({ resourceId, status, limit }) => [...applies.values()]
          .filter((apply) => apply.resource_id === resourceId && (!status || apply.status === status))
          .slice(0, limit ?? 100),
        update: async ({ id, status, expectedStatus, lastError, backupRetained }) => {
          const apply = applies.get(id);
          if (!apply || (expectedStatus && apply.status !== expectedStatus)) return null;
          const terminal = status === 'succeeded' || status === 'failed' || status === 'recovered';
          const next: TDbCoordinatorApplyRun = {
            ...apply, status, last_error: lastError ?? null,
            backup_retained: backupRetained ?? apply.backup_retained,
            completed_at: terminal ? iso() : apply.completed_at,
          };
          applies.set(id, next);
          return next;
        },
        finishWithDraft: async ({ id, draftId, status, expectedStatus, draftStatus, lastError, backupRetained }) => {
          if (failTerminalWrites) throw new Error('terminal write lost');
          const apply = applies.get(id);
          if (!apply || (expectedStatus && apply.status !== expectedStatus)) return null;
          const next: TDbCoordinatorApplyRun = {
            ...apply, status, last_error: lastError ?? null,
            backup_retained: backupRetained ?? apply.backup_retained,
            completed_at: iso(),
          };
          applies.set(id, next);
          const draft = drafts.get(draftId);
          if (!draft) return null;
          const nextDraft: TDbCoordinatorDraft = {
            ...draft, status: draftStatus, last_error: lastError ?? null, updated_at: iso(),
            applied_at: draftStatus === 'applied' ? iso() : draft.applied_at,
          };
          drafts.set(draftId, nextDraft);
          return { apply: next, draft: nextDraft };
        },
      },
    },
  };
  return {
    store,
    drafts,
    applies,
    setFailTerminalWrites: (value: boolean) => { failTerminalWrites = value; },
  };
}

function createHarness(options: {
  staleApplyGraceMs?: number;
  applyDraft?: IDbResourceLifecycle['applyDraft'];
  reconcileApply?: IDbResourceLifecycle['reconcileApply'];
  onDiagnostic?: (entry: TDbResourceCoordinatorDiagnostic) => void;
} = {}) {
  const currentMs = Date.now();
  const now = () => Date.now();
  const memory = createMemoryStore(now);
  const descriptor: TResourceDescriptor = {
    id: 'db-1',
    kind: 'db',
    name: 'Notes',
    status: 'ready',
    lastError: null,
    createdAtMs: currentMs,
    updatedAtMs: currentMs,
  } as TResourceDescriptor;
  const dbResource: IDbResourceLifecycle = {
    createDraft: async () => undefined,
    discardDraft: async () => undefined,
    applyDraftChange: async () => ({ sequence: 1, kind: 'structure', sql: '' }),
    executeDraftSql: async () => ({ sequence: 1, kind: 'sql', sql: '' }),
    listDraftChangeEvidence: async () => [],
    applyDraft: options.applyDraft ?? (async () => ({ outcome: 'succeeded' as const, backupRetained: false, error: null })),
    restoreBackup: async () => undefined,
    discardBackup: async () => undefined,
    hasVerifiedBackup: async () => false,
    reconcileApply: options.reconcileApply ?? (async () => ({ outcome: 'committed' as const, retainedBackupApplyId: null })),
  };
  const coordinator = new DbResourceCoordinator({
    tenant,
    controlStore: memory.store,
    resourceControlStore: {
      getResource: async () => descriptor,
      listBindingsForResource: async () => [],
    } as unknown as IResourceControlStore,
    resourceManager: {
      getResource: async () => ({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        status: descriptor.status,
        last_error: null,
        created_at: new Date(currentMs).toISOString(),
        updated_at: new Date(currentMs).toISOString(),
      }),
      listResources: async () => [],
      withReadyResource: async (_resourceId, operation) => operation(await (async () => ({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        status: descriptor.status,
        last_error: null,
        created_at: new Date(currentMs).toISOString(),
        updated_at: new Date(currentMs).toISOString(),
      }))()),
      drainResource: async () => undefined,
      coordinateResourceApply: async (_resourceId, operation) => operation(await (async () => ({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        status: descriptor.status,
        last_error: null,
        created_at: new Date(currentMs).toISOString(),
        updated_at: new Date(currentMs).toISOString(),
      }))()),
    },
    useCoordinator,
    dbResource,
    crypto,
    onDiagnostic: options.onDiagnostic,
    staleApplyGraceMs: options.staleApplyGraceMs,
  });
  return {
    coordinator,
    memory,
    dbResource,
    backdate: (applyId: string, ms: number) => {
      const apply = memory.applies.get(applyId);
      if (apply) memory.applies.set(applyId, { ...apply, created_at: new Date(Date.now() - ms).toISOString() });
    },
  };
}

describe('DbResourceCoordinator apply lifecycle', () => {
  test('confirmApply returns the preparing snapshot while the detached apply reaches succeeded', async () => {
    const { coordinator, memory } = createHarness();
    const draft = await coordinator.createDraft('db-1', 'add notes');
    const apply = await coordinator.confirmApply(draft.draft.id);
    expect(apply.status).toBe('preparing');
    await coordinator.close();
    expect(memory.applies.get(apply.id)?.status).toBe('succeeded');
    expect(memory.drafts.get(draft.draft.id)?.status).toBe('applied');
    await expect(coordinator.getApply(apply.id)).resolves.toMatchObject({ apply: { status: 'succeeded' } });
  });

  test('self-heals a wedged preparing run instead of blocking every future write', async () => {
    const { coordinator, memory, backdate } = createHarness({ staleApplyGraceMs: 0 });
    const wedged = await memory.store.dbResource.apply.create({
      id: 'apply-wedged',
      resourceId: 'db-1',
      draftId: null,
      status: 'preparing',
    });
    backdate(wedged.id, 1_000);
    const draft = await coordinator.createDraft('db-1', 'recovered write');
    expect(memory.applies.get(wedged.id)?.status).toBe('succeeded');
    const apply = await coordinator.confirmApply(draft.draft.id);
    await coordinator.close();
    expect(memory.applies.get(apply.id)?.status).toBe('succeeded');
  });

  test('getApply reconciles a stale unowned run to a terminal status', async () => {
    const { coordinator, memory, backdate } = createHarness({ staleApplyGraceMs: 0 });
    const wedged = await memory.store.dbResource.apply.create({
      id: 'apply-stale',
      resourceId: 'db-1',
      draftId: null,
      status: 'applying',
    });
    backdate(wedged.id, 1_000);
    const details = await coordinator.getApply(wedged.id);
    expect(details.apply.status).toBe('succeeded');
    await coordinator.close();
  });

  test('keeps blocking while a fresh run is still inside the grace window', async () => {
    const { coordinator, memory } = createHarness({ staleApplyGraceMs: 60_000 });
    await memory.store.dbResource.apply.create({
      id: 'apply-fresh',
      resourceId: 'db-1',
      draftId: null,
      status: 'preparing',
    });
    await expect(coordinator.createDraft('db-1', 'blocked write')).rejects.toMatchObject({
      code: 'DB_RESOURCE_APPLY_IN_PROGRESS',
    });
    await coordinator.close();
  });

  test('reports a lost terminal write through diagnostics and leaves the row reconcilable', async () => {
    const diagnostics: TDbResourceCoordinatorDiagnostic[] = [];
    const { coordinator, memory, backdate } = createHarness({
      staleApplyGraceMs: 0,
      applyDraft: async () => { throw new Error('physical apply exploded'); },
      onDiagnostic: (entry) => diagnostics.push(entry),
    });
    memory.setFailTerminalWrites(true);
    const draft = await coordinator.createDraft('db-1', 'doomed write');
    const apply = await coordinator.confirmApply(draft.draft.id);
    await coordinator.close();
    expect(diagnostics.some((entry) => entry.code === 'DB_RESOURCE_APPLY_STATUS_WRITE_FAILED' && entry.applyId === apply.id)).toBe(true);
    expect(memory.applies.get(apply.id)?.status).toBe('applying');
    memory.setFailTerminalWrites(false);
    backdate(apply.id, 1_000);
    const healed = await coordinator.getApply(apply.id);
    expect(['succeeded', 'recovered', 'failed']).toContain(healed.apply.status);
  });
});
