import { describe, expect, test } from 'bun:test';
import type { IResourceControlStore, IResourceUseCoordinator } from '#backend/shell/resources/interface';
import { DbResourceCoordinator } from '../local/DbResourceCoordinator';
import type {
  IDbResourceCoordinatorControlStore,
  IDbResourceLifecycle,
  TDbCoordinatorApplyRun,
  TDbCoordinatorDraft,
  TDbCoordinatorDraftChange,
  TDbResourceCoordinatorDiagnostic,
} from '../local/DbResourceCoordinator';
import type { TResourceDescriptor } from '#backend/core/resources/types';

const useCoordinator: IResourceUseCoordinator = {
  inspect: async (resourceId) => ({ resourceId, uses: [] }),
  drain: async (request) => ({
    ok: true as const,
    lease: {
      resourceId: request.resourceId,
      leaseId: 'lease-a',
      leaseEpoch: 1,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      drainedUses: [],
    },
  }),
  release: async (lease, mode) => ({
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
            id, resourceId, name, status: 'editing',
            lastError: null, createdAtSec: iso(), updatedAtSec: iso(), appliedAtSec: null,
          };
          drafts.set(id, draft);
          return draft;
        },
        get: async ({ id }) => drafts.get(id) ?? null,
        getActive: async ({ resourceId }) => [...drafts.values()].find((draft) => (
          draft.resourceId === resourceId && (draft.status === 'editing' || draft.status === 'applying')
        )) ?? null,
        list: async ({ resourceId, status }) => [...drafts.values()].filter((draft) => (
          draft.resourceId === resourceId && (!status || draft.status === status)
        )),
        updateStatus: async ({ id, status, expectedStatus, lastError }) => {
          const draft = drafts.get(id);
          if (!draft || (expectedStatus && draft.status !== expectedStatus)) return null;
          const next: TDbCoordinatorDraft = {
            ...draft, status, lastError: lastError ?? null, updatedAtSec: iso(),
            appliedAtSec: status === 'applied' ? iso() : draft.appliedAtSec,
          };
          drafts.set(id, next);
          return next;
        },
        discard: async ({ id, lastError }) => {
          const draft = drafts.get(id);
          if (!draft) return null;
          const next: TDbCoordinatorDraft = { ...draft, status: 'discarded', lastError: lastError ?? null, updatedAtSec: iso() };
          drafts.set(id, next);
          return next;
        },
        change: {
          list: async ({ draftId }) => changes.get(draftId) ?? [],
          append: async (args) => {
            const change: TDbCoordinatorDraftChange = {
              draftId: args.draftId, sequence: args.sequence, kind: args.kind,
              operation: args.operation ?? null, sql: args.sql, createdAtSec: iso(),
            };
            changes.set(args.draftId, [...changes.get(args.draftId) ?? [], change]);
            return change;
          },
        },
      },
      apply: {
        create: async ({ id, resourceId, draftId, sourceApplyId, status }) => {
          const apply: TDbCoordinatorApplyRun = {
            id, resourceId, draftId: draftId ?? null, sourceApplyId: sourceApplyId ?? null,
            status: status ?? 'preparing', lastError: null, backupRetained: false,
            createdAtSec: iso(), completedAtSec: null,
          };
          applies.set(id, apply);
          return apply;
        },
        createFromDraft: async ({ id, resourceId, draftId }) => {
          const draft = drafts.get(draftId);
          if (!draft) throw new Error('draft missing');
          const apply: TDbCoordinatorApplyRun = {
            id, resourceId, draftId, sourceApplyId: null,
            status: 'preparing', lastError: null, backupRetained: false,
            createdAtSec: iso(), completedAtSec: null,
          };
          applies.set(id, apply);
          const nextDraft: TDbCoordinatorDraft = { ...draft, status: 'applying', updatedAtSec: iso() };
          drafts.set(draftId, nextDraft);
          return { apply, draft: nextDraft };
        },
        get: async ({ id }) => applies.get(id) ?? null,
        list: async ({ resourceId, status, limit }) => [...applies.values()]
          .filter((apply) => apply.resourceId === resourceId && (!status || apply.status === status))
          .slice(0, limit ?? 100),
        update: async ({ id, status, expectedStatus, lastError, backupRetained }) => {
          const apply = applies.get(id);
          if (!apply || (expectedStatus && apply.status !== expectedStatus)) return null;
          const terminal = status === 'succeeded' || status === 'failed' || status === 'recovered';
          const next: TDbCoordinatorApplyRun = {
            ...apply, status, lastError: lastError ?? null,
            backupRetained: backupRetained ?? apply.backupRetained,
            completedAtSec: terminal ? iso() : apply.completedAtSec,
          };
          applies.set(id, next);
          return next;
        },
        finishWithDraft: async ({ id, draftId, status, expectedStatus, draftStatus, lastError, backupRetained }) => {
          if (failTerminalWrites) throw new Error('terminal write lost');
          const apply = applies.get(id);
          if (!apply || (expectedStatus && apply.status !== expectedStatus)) return null;
          const next: TDbCoordinatorApplyRun = {
            ...apply, status, lastError: lastError ?? null,
            backupRetained: backupRetained ?? apply.backupRetained,
            completedAtSec: iso(),
          };
          applies.set(id, next);
          const draft = drafts.get(draftId);
          if (!draft) return null;
          const nextDraft: TDbCoordinatorDraft = {
            ...draft, status: draftStatus, lastError: lastError ?? null, updatedAtSec: iso(),
            appliedAtSec: draftStatus === 'applied' ? iso() : draft.appliedAtSec,
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
  resourceStatus?: 'ready' | 'migrating';
} = {}) {
  const currentMs = Date.now();
  const now = () => Date.now();
  const memory = createMemoryStore(now);
  const descriptor: TResourceDescriptor = {
    id: 'db-1',
    kind: 'db',
    name: 'Notes',
    status: options.resourceStatus ?? 'ready',
    lastError: null,
    createdAtSec: new Date(currentMs).toISOString(),
    updatedAtSec: new Date(currentMs).toISOString(),
  };
  const settlements: { resourceId: string; settlement: unknown }[] = [];
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
    controlStore: memory.store,
    resourceControlStore: {
      getResource: async () => descriptor,
    } as unknown as IResourceControlStore,
    resourceManager: {
      getResource: async () => ({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        status: descriptor.status,
        lastError: null,
        createdAtSec: new Date(currentMs).toISOString(),
        updatedAtSec: new Date(currentMs).toISOString(),
      }),
      listResources: async () => [],
      settleResourceMigration: async (resourceId, settlement) => {
        settlements.push({ resourceId, settlement });
      },
      withReadyResource: async (_resourceId, operation) => operation(await (async () => ({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        status: descriptor.status,
        lastError: null,
        createdAtSec: new Date(currentMs).toISOString(),
        updatedAtSec: new Date(currentMs).toISOString(),
      }))()),
      drainResource: async () => undefined,
      coordinateResourceApply: async (_resourceId, operation) => operation(await (async () => ({
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        status: descriptor.status,
        lastError: null,
        createdAtSec: new Date(currentMs).toISOString(),
        updatedAtSec: new Date(currentMs).toISOString(),
      }))()),
    },
    useCoordinator,
    dbResource,
    crypto,
    nowMs: now,
    onDiagnostic: options.onDiagnostic,
    staleApplyGraceMs: options.staleApplyGraceMs,
  });
  return {
    coordinator,
    memory,
    dbResource,
    settlements,
    backdate: (applyId: string, ms: number) => {
      const apply = memory.applies.get(applyId);
      if (apply) memory.applies.set(applyId, { ...apply, createdAtSec: new Date(Date.now() - ms).toISOString() });
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

  test('settles the catalog migration after reconciling an interrupted apply', async () => {
    const { coordinator, memory, settlements, backdate } = createHarness({
      staleApplyGraceMs: 0,
      resourceStatus: 'migrating',
    });
    const wedged = await memory.store.dbResource.apply.create({
      id: 'apply-interrupted',
      resourceId: 'db-1',
      draftId: null,
      status: 'applying',
    });
    backdate(wedged.id, 1_000);
    const details = await coordinator.getApply(wedged.id);
    expect(details.apply.status).toBe('succeeded');
    expect(settlements).toEqual([{ resourceId: 'db-1', settlement: { status: 'ready' } }]);
    await coordinator.close();
  });

  test('settles the catalog to error when interrupted work cannot be recovered', async () => {
    const { coordinator, memory, settlements, backdate } = createHarness({
      staleApplyGraceMs: 0,
      resourceStatus: 'migrating',
      reconcileApply: async () => ({ outcome: 'unrecoverable' as const, retainedBackupApplyId: null }),
    });
    const wedged = await memory.store.dbResource.apply.create({
      id: 'apply-doomed',
      resourceId: 'db-1',
      draftId: null,
      status: 'applying',
    });
    backdate(wedged.id, 1_000);
    const details = await coordinator.getApply(wedged.id);
    expect(details.apply.status).toBe('failed');
    expect(settlements).toEqual([{
      resourceId: 'db-1',
      settlement: {
        status: 'error',
        code: 'DB_RESOURCE_RECOVERY_FAILED',
        message: 'Interrupted database work could not be recovered safely.',
      },
    }]);
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
