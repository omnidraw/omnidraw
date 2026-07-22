import type { TTenantContext } from '@vibecanvas/tenant-core';
import { ResourceError } from '../ResourceError';
import type { IResourceControlStore, IResourceUseCoordinator } from '../interface';
import type {
  TDbCellValue,
  TDbDraftOperation,
  TResourceDrainLease,
  TResourceKind,
  TResourceStatus,
} from '../types';
import type { DbResource } from './DbResource';

const RESOURCE_DRAIN_TIMEOUT_MS = 2_000;

type TDbResourceDraftStatus = 'editing' | 'applying' | 'applied' | 'discarded' | 'error';
type TDbResourceApplyStatus = 'preparing' | 'applying' | 'succeeded' | 'failed' | 'recovered';
type TSafeError = { readonly code: string; readonly message: string };

export type TDbCoordinatorResource = {
  readonly id: string;
  readonly kind: TResourceKind;
  readonly name: string;
  readonly status: TResourceStatus;
  readonly last_error: unknown | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type TDbCoordinatorDraft = {
  readonly id: string;
  readonly resource_id: string;
  readonly name: string;
  readonly status: TDbResourceDraftStatus;
  readonly last_error: unknown | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly applied_at: string | null;
};

export type TDbCoordinatorDraftChange = {
  readonly draft_id: string;
  readonly sequence: number;
  readonly kind: 'structure' | 'sql';
  readonly operation: unknown | null;
  readonly sql: string;
  readonly created_at: string;
};

export type TDbCoordinatorApplyRun = {
  readonly id: string;
  readonly resource_id: string;
  readonly draft_id: string | null;
  readonly source_apply_id: string | null;
  readonly status: TDbResourceApplyStatus;
  readonly last_error: unknown | null;
  readonly backup_retained: boolean;
  readonly created_at: string;
  readonly completed_at: string | null;
};

export type TDbResourceImpact = {
  readonly resource: TDbCoordinatorResource;
  readonly bindings: Awaited<ReturnType<IResourceControlStore['listBindingsForResource']>>;
  readonly uses: Awaited<ReturnType<IResourceUseCoordinator['inspect']>>;
};

export type TDbDraftDetails = {
  readonly draft: TDbCoordinatorDraft;
  readonly changes: TDbCoordinatorDraftChange[];
};

export type TDbApplyPreview = TDbDraftDetails & {
  readonly resource: TDbCoordinatorResource;
  readonly impact: TDbResourceImpact;
  readonly warnings: string[];
};

export type TDbApplyDetails = {
  readonly apply: TDbCoordinatorApplyRun;
  readonly drain: TResourceDrainLease | null;
};

export type TDbBackup = {
  readonly resourceId: string;
  readonly applyId: string;
  readonly createdAt: string;
};

export interface IDbResourceCoordinatorControlStore {
  readonly dbResource: {
    readonly draft: {
      create(args: { id: string; resourceId: string; name: string }): Promise<TDbCoordinatorDraft>;
      get(args: { id: string }): Promise<TDbCoordinatorDraft | null>;
      getActive(args: { resourceId: string }): Promise<TDbCoordinatorDraft | null>;
      list(args: {
        resourceId: string;
        status?: TDbResourceDraftStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }): Promise<TDbCoordinatorDraft[]>;
      updateStatus(args: {
        id: string;
        status: TDbResourceDraftStatus;
        expectedStatus?: TDbResourceDraftStatus;
        lastError?: unknown | null;
      }): Promise<TDbCoordinatorDraft | null>;
      discard(args: { id: string; lastError?: unknown | null }): Promise<TDbCoordinatorDraft | null>;
      readonly change: {
        list(args: { draftId: string }): Promise<TDbCoordinatorDraftChange[]>;
        append(args: {
          draftId: string;
          sequence: number;
          kind: 'structure' | 'sql';
          operation?: unknown | null;
          sql: string;
        }): Promise<TDbCoordinatorDraftChange>;
      };
    };
    readonly apply: {
      create(args: {
        id: string;
        resourceId: string;
        draftId?: string | null;
        sourceApplyId?: string | null;
        status?: TDbResourceApplyStatus;
      }): Promise<TDbCoordinatorApplyRun>;
      createFromDraft(args: {
        id: string;
        resourceId: string;
        draftId: string;
      }): Promise<{ apply: TDbCoordinatorApplyRun; draft: TDbCoordinatorDraft }>;
      get(args: { id: string }): Promise<TDbCoordinatorApplyRun | null>;
      list(args: {
        resourceId: string;
        status?: TDbResourceApplyStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }): Promise<TDbCoordinatorApplyRun[]>;
      update(args: {
        id: string;
        status: TDbResourceApplyStatus;
        expectedStatus?: TDbResourceApplyStatus;
        lastError?: unknown | null;
        backupRetained?: boolean;
      }): Promise<TDbCoordinatorApplyRun | null>;
      finishWithDraft(args: {
        id: string;
        draftId: string;
        status: 'succeeded' | 'failed' | 'recovered';
        expectedStatus?: TDbResourceApplyStatus;
        draftStatus: 'applied' | 'editing' | 'error';
        lastError?: unknown | null;
        backupRetained?: boolean;
      }): Promise<{ apply: TDbCoordinatorApplyRun; draft: TDbCoordinatorDraft } | null>;
    };
  };
}

export interface IDbResourceCoordinatorManager {
  getResource(resourceId: string): Promise<TDbCoordinatorResource | null>;
  listResources(filter: { kind?: TResourceKind; status?: TResourceStatus }): Promise<TDbCoordinatorResource[]>;
  withReadyResource<T>(resourceId: string, operation: (resource: TDbCoordinatorResource) => Promise<T>): Promise<T>;
  drainResource(resourceId: string): Promise<void>;
  coordinateResourceApply<T>(resourceId: string, operation: (resource: TDbCoordinatorResource) => Promise<T>): Promise<T>;
}

export type IDbResourceLifecycle = Pick<
  DbResource,
  | 'createDraft'
  | 'discardDraft'
  | 'applyDraftChange'
  | 'executeDraftSql'
  | 'listDraftChangeEvidence'
  | 'applyDraft'
  | 'restoreBackup'
  | 'discardBackup'
  | 'hasVerifiedBackup'
  | 'reconcileApply'
>;

export type TDbResourceCoordinatorConfig = {
  readonly tenant: TTenantContext;
  readonly controlStore: IDbResourceCoordinatorControlStore;
  readonly resourceControlStore: IResourceControlStore;
  readonly resourceManager: IDbResourceCoordinatorManager;
  readonly useCoordinator: IResourceUseCoordinator;
  readonly dbResource: IDbResourceLifecycle;
  readonly crypto: Pick<Crypto, 'randomUUID'>;
};

export type TDbResourceStartupReconcileOptions = Readonly<{
  tenant?: TTenantContext;
  isPlacementOwned?: (resource: TDbCoordinatorResource) => boolean | Promise<boolean>;
}>;

function safeError(error: unknown, fallbackCode: string, fallbackMessage: string): TSafeError {
  if (error instanceof ResourceError) return { code: error.code, message: error.message };
  return { code: fallbackCode, message: fallbackMessage };
}

function structuredWarnings(changes: TDbDraftDetails['changes']): string[] {
  const warnings: string[] = [];
  for (const change of changes) {
    if (change.kind === 'sql') {
      warnings.push(`Raw SQL change ${change.sequence} may be destructive and cannot be classified safely.`);
      continue;
    }
    const operation = change.operation as { kind?: unknown; table?: unknown; column?: unknown } | null;
    if (operation?.kind === 'dropTable') warnings.push(`Table "${String(operation.table)}" will be dropped with its data.`);
    if (operation?.kind === 'dropColumn') warnings.push(`Column "${String(operation.column)}" on "${String(operation.table)}" will be dropped with its data.`);
    if (operation?.kind === 'dropForeignKey') warnings.push(`A foreign key on "${String(operation.table)}" will be removed.`);
  }
  return warnings;
}

export class DbResourceCoordinator {
  readonly #tenant: TTenantContext;
  readonly #db: IDbResourceCoordinatorControlStore;
  readonly #resourceControlStore: IResourceControlStore;
  readonly #resourceManager: IDbResourceCoordinatorManager;
  readonly #useCoordinator: IResourceUseCoordinator;
  readonly #dbResource: IDbResourceLifecycle;
  readonly #crypto: Pick<Crypto, 'randomUUID'>;
  readonly #resourceTails = new Map<string, Promise<void>>();
  readonly #detachedTasks = new Set<Promise<void>>();
  readonly #drains = new Map<string, TResourceDrainLease>();
  #closed = false;

  constructor(config: TDbResourceCoordinatorConfig) {
    this.#tenant = config.tenant;
    this.#db = config.controlStore;
    this.#resourceControlStore = config.resourceControlStore;
    this.#resourceManager = config.resourceManager;
    this.#useCoordinator = config.useCoordinator;
    this.#dbResource = config.dbResource;
    this.#crypto = config.crypto;
  }

  async impact(tenant: TTenantContext, resourceId: string): Promise<TDbResourceImpact>;
  async impact(resourceId: string): Promise<TDbResourceImpact>;
  async impact(tenantOrResourceId: TTenantContext | string, explicitResourceId?: string): Promise<TDbResourceImpact> {
    this.#assertOpen();
    const { tenant, identifier } = this.#requestAuthority(tenantOrResourceId, explicitResourceId);
    const descriptor = await this.#resourceControlStore.getResource(tenant, identifier);
    if (!descriptor || descriptor.kind !== 'db') throw new ResourceError('RESOURCE_NOT_FOUND', 'DbResource was not found.');
    return {
      resource: {
        id: descriptor.id,
        kind: descriptor.kind,
        name: descriptor.name,
        status: descriptor.status,
        last_error: descriptor.lastError,
        created_at: new Date(descriptor.createdAtMs).toISOString(),
        updated_at: new Date(descriptor.updatedAtMs).toISOString(),
      },
      bindings: await this.#resourceControlStore.listBindingsForResource(tenant, identifier),
      uses: await this.#useCoordinator.inspect(tenant, identifier),
    };
  }

  async createDraft(resourceId: string, name: string): Promise<TDbDraftDetails> {
    this.#assertOpen();
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
      throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft name must be non-blank and at most 200 characters.');
    }
    return this.#resourceManager.withReadyResource(resourceId, () => this.#withResourceLane(resourceId, async () => {
      await this.#requireNoActiveApply(resourceId);
      if (await this.#db.dbResource.draft.getActive({ resourceId })) {
        throw new ResourceError('DB_RESOURCE_DRAFT_EXISTS', 'DbResource already has an active structure draft.');
      }
      const id = this.#crypto.randomUUID();
      const draft = await this.#db.dbResource.draft.create({ id, resourceId, name: name.trim() });
      try {
        await this.#dbResource.createDraft(resourceId, id);
        return { draft, changes: [] };
      } catch (error) {
        await this.#db.dbResource.draft.updateStatus({
          id,
          status: 'error',
          expectedStatus: 'editing',
          lastError: safeError(error, 'DB_RESOURCE_DRAFT_INVALID', 'The physical draft could not be created.'),
        }).catch(() => null);
        throw error;
      }
    }));
  }

  listDrafts(args: { resourceId: string; status?: TDbResourceDraftStatus; before?: { createdAt: string; id: string }; limit?: number }) {
    this.#assertOpen();
    return this.#db.dbResource.draft.list(args);
  }

  async getDraft(draftId: string): Promise<TDbDraftDetails> {
    this.#assertOpen();
    const draft = await this.#requireDraft(draftId);
    return this.#withResourceLane(draft.resource_id, () => this.#validatedDraftDetails(draftId));
  }

  async getActiveDraft(resourceId: string): Promise<TDbDraftDetails | null> {
    this.#assertOpen();
    const draft = await this.#db.dbResource.draft.getActive({ resourceId });
    return draft ? this.#withResourceLane(resourceId, () => this.#validatedDraftDetails(draft.id)) : null;
  }

  async changeDraft(draftId: string, operation: TDbDraftOperation) {
    const draft = await this.#requireEditingDraft(draftId);
    return this.#resourceManager.withReadyResource(draft.resource_id, () => this.#withResourceLane(draft.resource_id, async () => {
      await this.#requireEditingDraft(draftId);
      const evidence = await this.#dbResource.applyDraftChange(draft.id, operation);
      return this.#db.dbResource.draft.change.append({
        draftId,
        sequence: evidence.sequence,
        kind: 'structure',
        operation,
        sql: evidence.sql,
      });
    }));
  }

  async executeDraftSql(draftId: string, sql: string, parameters?: readonly TDbCellValue[]) {
    const draft = await this.#requireEditingDraft(draftId);
    return this.#resourceManager.withReadyResource(draft.resource_id, () => this.#withResourceLane(draft.resource_id, async () => {
      await this.#requireEditingDraft(draftId);
      const evidence = await this.#dbResource.executeDraftSql(draft.id, sql, parameters);
      return this.#db.dbResource.draft.change.append({
        draftId,
        sequence: evidence.sequence,
        kind: 'sql',
        operation: parameters === undefined ? null : { type: 'boundSql', parameters },
        sql: evidence.sql,
      });
    }));
  }

  async discardDraft(draftId: string): Promise<TDbCoordinatorDraft> {
    const draft = await this.#requireDraft(draftId);
    return this.#resourceManager.withReadyResource(draft.resource_id, () => this.#withResourceLane(draft.resource_id, async () => {
      if (draft.status !== 'editing' && draft.status !== 'error') {
        throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing or failed draft can be discarded.');
      }
      await this.#dbResource.discardDraft(draftId);
      const discarded = await this.#db.dbResource.draft.discard({ id: draftId, lastError: null });
      if (!discarded) throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft state changed before discard.');
      return discarded;
    }));
  }

  async previewApply(tenant: TTenantContext, draftId: string): Promise<TDbApplyPreview>;
  async previewApply(draftId: string): Promise<TDbApplyPreview>;
  async previewApply(tenantOrDraftId: TTenantContext | string, explicitDraftId?: string): Promise<TDbApplyPreview> {
    const { tenant, identifier } = this.#requestAuthority(tenantOrDraftId, explicitDraftId);
    const details = await this.getDraft(identifier);
    if (details.draft.status !== 'editing') throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing draft can be reviewed.');
    const impact = await this.impact(tenant, details.draft.resource_id);
    return { ...details, resource: impact.resource, impact, warnings: structuredWarnings(details.changes) };
  }

  async confirmApply(tenant: TTenantContext, draftId: string): Promise<TDbCoordinatorApplyRun>;
  async confirmApply(draftId: string): Promise<TDbCoordinatorApplyRun>;
  async confirmApply(tenantOrDraftId: TTenantContext | string, explicitDraftId?: string): Promise<TDbCoordinatorApplyRun> {
    const { tenant, identifier } = this.#requestAuthority(tenantOrDraftId, explicitDraftId);
    const draft = await this.#requireEditingDraft(identifier);
    const result = await this.#withResourceLane(draft.resource_id, async () => {
      await this.#requireNoActiveApply(draft.resource_id);
      return this.#db.dbResource.apply.createFromDraft({
        id: this.#crypto.randomUUID(),
        resourceId: draft.resource_id,
        draftId: draft.id,
      });
    });
    this.#track(this.#executeApply(tenant, result.apply));
    return result.apply;
  }

  async getApply(applyId: string): Promise<TDbApplyDetails> {
    const apply = await this.#db.dbResource.apply.get({ id: applyId });
    if (!apply) throw new ResourceError('RESOURCE_NOT_FOUND', 'DbResource apply was not found.');
    return { apply, drain: this.#drains.get(applyId) ?? null };
  }

  listApplies(args: { resourceId: string; status?: TDbResourceApplyStatus; before?: { createdAt: string; id: string }; limit?: number }) {
    this.#assertOpen();
    return this.#db.dbResource.apply.list(args);
  }

  async getBackup(resourceId: string): Promise<TDbBackup | null> {
    const applies = await this.#listAllApplies(resourceId);
    const apply = applies.find((candidate) => candidate.backup_retained && candidate.status !== 'preparing' && candidate.status !== 'applying');
    if (!apply || !await this.#dbResource.hasVerifiedBackup(resourceId, apply.id)) return null;
    return { resourceId, applyId: apply.id, createdAt: apply.created_at };
  }

  async discardBackup(resourceId: string, applyId: string): Promise<void> {
    await this.#withResourceLane(resourceId, async () => {
      const apply = await this.#requireApply(applyId, resourceId);
      if (!apply.backup_retained) return;
      await this.#dbResource.discardBackup(resourceId, applyId);
      await this.#db.dbResource.apply.update({
        id: applyId,
        status: apply.status,
        expectedStatus: apply.status,
        lastError: apply.last_error,
        backupRetained: false,
      });
    });
  }

  async previewRestore(tenant: TTenantContext, resourceId: string, applyId: string): Promise<{ backup: TDbBackup; impact: TDbResourceImpact; warning: string }>;
  async previewRestore(resourceId: string, applyId: string): Promise<{ backup: TDbBackup; impact: TDbResourceImpact; warning: string }>;
  async previewRestore(tenantOrResourceId: TTenantContext | string, resourceOrApplyId: string, explicitApplyId?: string) {
    const tenant = typeof tenantOrResourceId === 'string' ? this.#tenant : tenantOrResourceId;
    const resourceId = typeof tenantOrResourceId === 'string' ? tenantOrResourceId : resourceOrApplyId;
    const applyId = typeof tenantOrResourceId === 'string' ? resourceOrApplyId : explicitApplyId!;
    const apply = await this.#requireApply(applyId, resourceId);
    if (!apply.backup_retained || !await this.#dbResource.hasVerifiedBackup(resourceId, applyId)) {
      throw new ResourceError('DB_RESOURCE_BACKUP_NOT_FOUND', 'Verified backup was not found.');
    }
    return {
      backup: { resourceId, applyId, createdAt: apply.created_at },
      impact: await this.impact(tenant, resourceId),
      warning: 'Restoring replaces the current live database with the selected verified backup.',
    };
  }

  async restore(tenant: TTenantContext, resourceId: string, applyId: string): Promise<TDbCoordinatorApplyRun>;
  async restore(resourceId: string, applyId: string): Promise<TDbCoordinatorApplyRun>;
  async restore(tenantOrResourceId: TTenantContext | string, resourceOrApplyId: string, explicitApplyId?: string) {
    const tenant = typeof tenantOrResourceId === 'string' ? this.#tenant : tenantOrResourceId;
    const resourceId = typeof tenantOrResourceId === 'string' ? tenantOrResourceId : resourceOrApplyId;
    const applyId = typeof tenantOrResourceId === 'string' ? resourceOrApplyId : explicitApplyId!;
    await this.previewRestore(tenant, resourceId, applyId);
    const restore = await this.#withResourceLane(resourceId, async () => {
      await this.#requireNoActiveApply(resourceId);
      return this.#db.dbResource.apply.create({
        id: this.#crypto.randomUUID(),
        resourceId,
        sourceApplyId: applyId,
        status: 'preparing',
      });
    });
    this.#track(this.#executeRestore(tenant, restore));
    return restore;
  }

  restoreStatus(restoreId: string) {
    return this.getApply(restoreId);
  }

  async reconcileStartup(options: TDbResourceStartupReconcileOptions = {}): Promise<void> {
    this.#assertOpen();
    const tenant = options.tenant ?? this.#tenant;
    const resources = await this.#resourceManager.listResources({ kind: 'db' });
    for (const resource of resources) {
      if (options.isPlacementOwned && !await options.isPlacementOwned(resource)) continue;
      const applies = await this.#listAllApplies(resource.id);
      for (const apply of applies.filter((candidate) => candidate.status === 'preparing' || candidate.status === 'applying')) {
        await this.#reconcileApply(tenant, apply);
      }
      const activeDraft = await this.#db.dbResource.draft.getActive({ resourceId: resource.id });
      if (activeDraft?.status === 'applying') {
        const hasApply = applies.some((apply) => apply.draft_id === activeDraft.id && (apply.status === 'preparing' || apply.status === 'applying'));
        if (!hasApply) {
          await this.#db.dbResource.draft.updateStatus({
            id: activeDraft.id,
            status: 'error',
            expectedStatus: 'applying',
            lastError: { code: 'DB_RESOURCE_RECOVERY_FAILED', message: 'Apply ownership was lost before startup recovery.' },
          });
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled([...this.#detachedTasks, ...this.#resourceTails.values()]);
  }

  async #executeApply(tenant: TTenantContext, apply: TDbCoordinatorApplyRun): Promise<void> {
    if (!apply.draft_id) return;
    let lease: TResourceDrainLease | null = null;
    try {
      const drained = await this.#useCoordinator.drain(tenant, {
        resourceId: apply.resource_id,
        reason: 'schema_apply',
        timeoutMs: RESOURCE_DRAIN_TIMEOUT_MS,
      });
      if (!drained.ok) throw new ResourceError('DB_BUSY', 'Database apply timed out while draining active function invocations.');
      lease = drained.lease;
      this.#drains.set(apply.id, lease);
      await this.#db.dbResource.apply.update({ id: apply.id, status: 'applying', expectedStatus: 'preparing', lastError: null });
      const details = await this.#validatedDraftDetails(apply.draft_id);
      const result = await this.#resourceManager.coordinateResourceApply(apply.resource_id, () => this.#dbResource.applyDraft({
        resourceId: apply.resource_id,
        draftId: apply.draft_id!,
        applyId: apply.id,
        changes: details.changes,
      }));
      await this.#db.dbResource.apply.finishWithDraft({
        id: apply.id,
        draftId: apply.draft_id,
        status: result.outcome,
        expectedStatus: 'applying',
        draftStatus: result.outcome === 'succeeded' ? 'applied' : 'editing',
        lastError: result.error,
        backupRetained: result.backupRetained,
      });
    } catch (error) {
      const failure = safeError(error, 'DB_RESOURCE_APPLY_FAILED', 'Database apply failed.');
      const current = await this.#db.dbResource.apply.get({ id: apply.id });
      if (current && (current.status === 'preparing' || current.status === 'applying')) {
        await this.#db.dbResource.apply.finishWithDraft({
          id: apply.id,
          draftId: apply.draft_id,
          status: 'failed',
          expectedStatus: current.status,
          draftStatus: 'editing',
          lastError: failure,
          backupRetained: current.backup_retained,
        }).catch(() => null);
      }
    } finally {
      this.#drains.delete(apply.id);
      if (lease) await this.#useCoordinator.release(tenant, lease, 'resume').catch(() => null);
    }
  }

  async #executeRestore(tenant: TTenantContext, restore: TDbCoordinatorApplyRun): Promise<void> {
    let lease: TResourceDrainLease | null = null;
    try {
      if (!restore.source_apply_id) throw new ResourceError('DB_RESOURCE_BACKUP_NOT_FOUND', 'Restore source is missing.');
      const drained = await this.#useCoordinator.drain(tenant, {
        resourceId: restore.resource_id,
        reason: 'restore',
        timeoutMs: RESOURCE_DRAIN_TIMEOUT_MS,
      });
      if (!drained.ok) throw new ResourceError('DB_BUSY', 'Backup restore timed out while draining active function invocations.');
      lease = drained.lease;
      this.#drains.set(restore.id, lease);
      await this.#db.dbResource.apply.update({ id: restore.id, status: 'applying', expectedStatus: 'preparing', lastError: null });
      await this.#resourceManager.coordinateResourceApply(restore.resource_id, () => (
        this.#dbResource.restoreBackup(restore.resource_id, restore.source_apply_id!, restore.id)
      ));
      await this.#db.dbResource.apply.update({
        id: restore.id,
        status: 'succeeded',
        expectedStatus: 'applying',
        lastError: null,
        backupRetained: false,
      });
    } catch (error) {
      const failure = safeError(error, 'DB_RESOURCE_RESTORE_FAILED', 'Database restore failed.');
      const current = await this.#db.dbResource.apply.get({ id: restore.id });
      if (current && (current.status === 'preparing' || current.status === 'applying')) {
        await this.#db.dbResource.apply.update({
          id: restore.id,
          status: 'failed',
          expectedStatus: current.status,
          lastError: failure,
          backupRetained: false,
        }).catch(() => null);
      }
    } finally {
      this.#drains.delete(restore.id);
      if (lease) await this.#useCoordinator.release(tenant, lease, 'resume').catch(() => null);
    }
  }

  async #reconcileApply(tenant: TTenantContext, apply: TDbCoordinatorApplyRun): Promise<void> {
    const reconciliation = await this.#dbResource.reconcileApply(apply.resource_id, apply.id, {
      restoreSourceApplyId: apply.source_apply_id ?? undefined,
    });
    const outcome = reconciliation.outcome === 'committed'
      ? 'succeeded'
      : reconciliation.outcome === 'recovered'
        ? 'recovered'
        : 'failed';
    const error = outcome === 'succeeded' ? null : {
      code: outcome === 'recovered' ? 'DB_RESOURCE_APPLY_RECOVERED' : 'DB_RESOURCE_RECOVERY_FAILED',
      message: outcome === 'recovered'
        ? 'Interrupted database work was recovered from a verified backup.'
        : 'Interrupted database work could not be recovered safely.',
    };
    if (apply.draft_id) {
      await this.#db.dbResource.apply.finishWithDraft({
        id: apply.id,
        draftId: apply.draft_id,
        status: outcome,
        expectedStatus: apply.status,
        draftStatus: outcome === 'succeeded' ? 'applied' : outcome === 'recovered' ? 'editing' : 'error',
        lastError: error,
        backupRetained: reconciliation.retainedBackupApplyId !== null,
      });
    } else {
      await this.#db.dbResource.apply.update({
        id: apply.id,
        status: outcome,
        expectedStatus: apply.status,
        lastError: error,
        backupRetained: reconciliation.retainedBackupApplyId !== null,
      });
    }
    const inspection = await this.#useCoordinator.inspect(tenant, apply.resource_id);
    if (inspection.uses.some((use) => use.state === 'draining')) {
      const retry = await this.#useCoordinator.drain(tenant, {
        resourceId: apply.resource_id,
        reason: apply.source_apply_id ? 'restore' : 'schema_apply',
        timeoutMs: RESOURCE_DRAIN_TIMEOUT_MS,
      });
      if (retry.ok) await this.#useCoordinator.release(tenant, retry.lease, 'resume');
    }
  }

  async #validatedDraftDetails(draftId: string): Promise<TDbDraftDetails> {
    const draft = await this.#requireDraft(draftId);
    const [changes, evidence] = await Promise.all([
      this.#db.dbResource.draft.change.list({ draftId }),
      this.#dbResource.listDraftChangeEvidence(draftId),
    ]);
    if (changes.length !== evidence.length || changes.some((change, index) => {
      const proof = evidence[index];
      return !proof || proof.sequence !== change.sequence || proof.kind !== change.kind || proof.sql !== change.sql;
    })) {
      throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft evidence does not match the control record.');
    }
    return { draft, changes };
  }

  async #requireDraft(draftId: string): Promise<TDbCoordinatorDraft> {
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    return draft;
  }

  async #requireEditingDraft(draftId: string): Promise<TDbCoordinatorDraft> {
    this.#assertOpen();
    const draft = await this.#requireDraft(draftId);
    if (draft.status !== 'editing') throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'DbResource draft is not editable.');
    return draft;
  }

  async #requireApply(applyId: string, resourceId?: string): Promise<TDbCoordinatorApplyRun> {
    const apply = await this.#db.dbResource.apply.get({ id: applyId });
    if (!apply || (resourceId && apply.resource_id !== resourceId)) {
      throw new ResourceError('RESOURCE_NOT_FOUND', 'DbResource apply was not found.');
    }
    return apply;
  }

  async #requireNoActiveApply(resourceId: string): Promise<void> {
    const active = (await this.#listAllApplies(resourceId)).find((apply) => apply.status === 'preparing' || apply.status === 'applying');
    if (active) throw new ResourceError('DB_RESOURCE_APPLY_IN_PROGRESS', 'DbResource already has active database work.');
  }

  async #listAllApplies(resourceId: string): Promise<TDbCoordinatorApplyRun[]> {
    const result: TDbCoordinatorApplyRun[] = [];
    let before: { createdAt: string; id: string } | undefined;
    do {
      const page = await this.#db.dbResource.apply.list({ resourceId, before, limit: 100 });
      result.push(...page);
      const last = page.at(-1);
      before = page.length === 100 && last ? { createdAt: last.created_at, id: last.id } : undefined;
      if (!before) break;
    } while (true);
    return result;
  }

  #requestAuthority(tenantOrId: TTenantContext | string, explicitId?: string) {
    return typeof tenantOrId === 'string'
      ? { tenant: this.#tenant, identifier: tenantOrId }
      : { tenant: tenantOrId, identifier: explicitId! };
  }

  #withResourceLane<T>(resourceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#resourceTails.get(resourceId) ?? Promise.resolve();
    let queued!: Promise<T>;
    queued = previous.catch(() => undefined).then(operation).finally(() => {
      if (this.#resourceTails.get(resourceId) === queued) this.#resourceTails.delete(resourceId);
    });
    this.#resourceTails.set(resourceId, queued.then(() => undefined, () => undefined));
    return queued;
  }

  #track(task: Promise<void>): void {
    this.#detachedTasks.add(task);
    void task.finally(() => this.#detachedTasks.delete(task));
  }

  #assertOpen(): void {
    if (this.#closed) throw new ResourceError('RESOURCE_UNAVAILABLE', 'DbResource coordinator is closed.');
  }
}
