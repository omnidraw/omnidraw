import type { TTenantContext } from '@vibecanvas/tenant-core';
import { ResourceError } from '../ResourceError';
import type { IResourceUseCoordinator } from '../interface';
import type {
  TDbDraftOperation,
  TDbCellValue,
  TResourceDrainLease,
  TResourceKind,
  TResourceStatus,
} from '../types';
import type { DbResource } from './DbResource';

const COMPATIBILITY_NOTICE = 'Actor compatibility cannot be guaranteed. Restart results are observed runtime outcomes only.';
const RESOURCE_DRAIN_TIMEOUT_MS = 2_000;

type TDbResourceDraftStatus = 'editing' | 'applying' | 'applied' | 'discarded' | 'error';
type TDbResourceApplyStatus = 'preparing' | 'stopping' | 'applying' | 'restarting' | 'succeeded' | 'failed' | 'recovered';
type TDbResourceApplyInstanceStatus = 'notRunning' | 'pendingStop' | 'stopped' | 'stopFailed' | 'pendingRestart' | 'restarted' | 'startFailed' | 'crashed';
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

export type TDbCoordinatorApplyInstanceResult = {
  readonly apply_id: string;
  readonly actor_instance_id: string;
  readonly actor_definition_name: string;
  readonly was_running: boolean;
  readonly status: TDbResourceApplyInstanceStatus;
  readonly error: unknown | null;
  readonly updated_at: string;
};

type TDbCoordinatorBinding = {
  readonly actor_definition_name: string;
  readonly slot_name: string;
  readonly allow_read: boolean;
  readonly allow_write: boolean;
};

type TDbCoordinatorAffectedInstance = {
  readonly id: string;
  readonly actor_definition_name: string;
  readonly status: string;
};

export type TDbResourceImpact = {
  readonly resource: TDbCoordinatorResource;
  readonly definitions: {
    readonly definitionName: string;
    readonly slots: { readonly slot: string; readonly scope: ('read' | 'write')[] }[];
  }[];
  readonly instances: {
    readonly instanceId: string;
    readonly definitionName: string;
    readonly status: string;
    readonly running: boolean;
  }[];
};

export type TDbDraftDetails = {
  readonly draft: TDbCoordinatorDraft;
  readonly changes: TDbCoordinatorDraftChange[];
};

export type TDbApplyPreview = TDbDraftDetails & {
  readonly resource: TDbCoordinatorResource;
  readonly impact: TDbResourceImpact;
  readonly warnings: string[];
  readonly compatibilityNotice: string;
};

export type TDbApplyDetails = {
  readonly apply: TDbCoordinatorApplyRun;
  readonly instances: TDbCoordinatorApplyInstanceResult[];
};

export type TDbBackup = {
  readonly resourceId: string;
  readonly applyId: string;
  readonly createdAt: string;
};

export interface IDbResourceCoordinatorControlStore {
  readonly actorResource: {
    listBindingsForResource(args: { resourceId: string }): Promise<TDbCoordinatorBinding[]>;
    updateProviderState(args: {
      id: string;
      status?: TResourceStatus;
      lastError?: unknown | null;
    }): Promise<TDbCoordinatorResource | null>;
  };
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
      readonly instanceResult: {
        upsert(args: {
          applyId: string;
          actorInstanceId: string;
          actorDefinitionName: string;
          wasRunning: boolean;
          status: TDbResourceApplyInstanceStatus;
          error?: unknown | null;
        }): Promise<TDbCoordinatorApplyInstanceResult>;
        listByApply(args: { applyId: string }): Promise<TDbCoordinatorApplyInstanceResult[]>;
      };
    };
    listAffectedInstances(args: { resourceId: string }): Promise<TDbCoordinatorAffectedInstance[]>;
  };
}

export interface IDbResourceCoordinatorManager {
  getResource(resourceId: string): Promise<TDbCoordinatorResource | null>;
  listResources(filter: { kind?: TResourceKind; status?: TResourceStatus }): Promise<TDbCoordinatorResource[]>;
  withReadyResource<T>(
    resourceId: string,
    operation: (resource: TDbCoordinatorResource) => Promise<T>,
  ): Promise<T>;
  drainResource(resourceId: string): Promise<void>;
  coordinateResourceApply<T>(
    resourceId: string,
    operation: (resource: TDbCoordinatorResource) => Promise<T>,
  ): Promise<T>;
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
  /** Legacy/default authority only; request-serving methods accept an explicit tenant. */
  readonly tenant: TTenantContext;
  readonly controlStore: IDbResourceCoordinatorControlStore;
  readonly resourceManager: IDbResourceCoordinatorManager;
  readonly useCoordinator: IResourceUseCoordinator;
  readonly dbResource: IDbResourceLifecycle;
  readonly crypto: Pick<Crypto, 'randomUUID'>;
};

export type TDbResourceStartupReconcileOptions = Readonly<{
  /** Startup authority used only for neutral active-use inspection and release. */
  tenant?: TTenantContext;
  /** Must return true only when this process owns the resource's active placement. */
  isPlacementOwned?: (resource: TDbCoordinatorResource) => boolean | Promise<boolean>;
}>;

type TApplyResolution = {
  readonly safeToRestart: boolean;
  readonly outcome: 'succeeded' | 'recovered' | 'failed';
  readonly error: { code: string; message: string } | null;
  readonly backupRetained: boolean;
  readonly expectedStatus?: 'restarting';
};

type TRestoreResolution = {
  readonly safeToRestart: boolean;
  readonly ok: boolean;
  readonly error: { code: string; message: string } | null;
  readonly expectedStatus?: 'restarting';
};

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
    const operation = change.operation as { kind?: unknown; table?: unknown; column?: unknown; name?: unknown } | null;
    if (operation?.kind === 'dropTable') warnings.push(`Table "${String(operation.table)}" will be dropped with its data.`);
    if (operation?.kind === 'dropColumn') warnings.push(`Column "${String(operation.column)}" on "${String(operation.table)}" will be dropped with its data.`);
    if (operation?.kind === 'dropForeignKey') warnings.push(`A foreign key on "${String(operation.table)}" will be removed.`);
  }
  return warnings;
}

export class DbResourceCoordinator {
  readonly #legacyTenant: TTenantContext;
  readonly #db: IDbResourceCoordinatorControlStore;
  readonly #resourceManager: IDbResourceCoordinatorManager;
  readonly #useCoordinator: IResourceUseCoordinator;
  readonly #dbResource: IDbResourceLifecycle;
  readonly #crypto: Pick<Crypto, 'randomUUID'>;
  readonly #resourceTails = new Map<string, Promise<void>>();
  readonly #detachedTasks = new Set<Promise<void>>();
  #closed = false;

  constructor(config: TDbResourceCoordinatorConfig) {
    this.#legacyTenant = config.tenant;
    this.#db = config.controlStore;
    this.#resourceManager = config.resourceManager;
    this.#useCoordinator = config.useCoordinator;
    this.#dbResource = config.dbResource;
    this.#crypto = config.crypto;
  }

  async impact(tenant: TTenantContext, resourceId: string): Promise<TDbResourceImpact>;
  async impact(resourceId: string): Promise<TDbResourceImpact>;
  async impact(
    tenantOrResourceId: TTenantContext | string,
    explicitResourceId?: string,
  ): Promise<TDbResourceImpact> {
    this.#assertOpen();
    const { tenant, identifier: resourceId } = this.#requestAuthority(
      tenantOrResourceId,
      explicitResourceId,
    );
    return this.#impact(tenant, resourceId);
  }

  async #impact(tenant: TTenantContext, resourceId: string): Promise<TDbResourceImpact> {
    const resource = await this.#requireResource(resourceId);
    const bindings = await this.#db.actorResource.listBindingsForResource({ resourceId });
    const useInspection = await this.#useCoordinator.inspect(tenant, resourceId);
    const activeUseIds = new Set(
      useInspection.uses
        .filter((use) => use.state === 'active')
        .map((use) => use.id),
    );
    const definitions = [...new Set(bindings.map((binding) => binding.actor_definition_name))].map((definitionName) => ({
      definitionName,
      slots: bindings
        .filter((binding) => binding.actor_definition_name === definitionName)
        .map((binding) => ({
          slot: binding.slot_name,
          scope: [
            ...(binding.allow_read ? ['read' as const] : []),
            ...(binding.allow_write ? ['write' as const] : []),
          ],
        })),
    }));
    const instances = await this.#db.dbResource.listAffectedInstances({ resourceId });
    return {
      resource,
      definitions,
      instances: instances.map((instance) => ({
        instanceId: instance.id,
        definitionName: instance.actor_definition_name,
        status: instance.status,
        running: activeUseIds.has(instance.id),
      })),
    };
  }

  async createDraft(resourceId: string, name: string): Promise<TDbDraftDetails> {
    this.#assertOpen();
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 256) {
      throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft name must be non-blank and at most 256 characters.');
    }
    return this.#resourceManager.withReadyResource(resourceId, () => this.#withResourceLane(resourceId, async () => {
      const resource = await this.#requireReadyResource(resourceId);
      await this.#requireNoActiveApply(resourceId);
      const active = await this.#db.dbResource.draft.getActive({ resourceId });
      if (active) throw new ResourceError('DB_RESOURCE_DRAFT_EXISTS', `DbResource "${resource.name}" already has an active structure draft.`);
      const id = this.#crypto.randomUUID();
      const draft = await this.#db.dbResource.draft.create({ id, resourceId, name: name.trim() });
      try {
        await this.#dbResource.createDraft(resourceId, id);
        return { draft, changes: [] };
      } catch (error) {
        const safe = safeError(error, 'DB_RESOURCE_DRAFT_INVALID', 'The physical structure draft could not be created.');
        await this.#db.dbResource.draft.updateStatus({ id, status: 'error', expectedStatus: 'editing', lastError: safe }).catch(() => null);
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
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    return this.#withResourceLane(draft.resource_id, () => this.#validatedDraftDetails(draftId));
  }

  async getActiveDraft(resourceId: string): Promise<TDbDraftDetails | null> {
    this.#assertOpen();
    const draft = await this.#db.dbResource.draft.getActive({ resourceId });
    return draft ? this.#withResourceLane(resourceId, () => this.#validatedDraftDetails(draft.id)) : null;
  }

  async changeDraft(draftId: string, operation: TDbDraftOperation) {
    this.#assertOpen();
    const draft = await this.#requireEditingDraft(draftId);
    return this.#resourceManager.withReadyResource(draft.resource_id, () => this.#withResourceLane(draft.resource_id, async () => {
      await this.#requireValidatedEditingDraft(draftId);
      try {
        const evidence = await this.#dbResource.applyDraftChange(draft.id, operation);
        return await this.#db.dbResource.draft.change.append({
          draftId,
          sequence: evidence.sequence,
          kind: 'structure',
          operation: operation,
          sql: evidence.sql,
        });
      } catch (error) {
        if (!(error instanceof ResourceError) || error.details?.uncertain === true) {
          await this.#markDraftError(draft.id, 'The draft may have changed physically but its ordered change is not safely recorded.');
        }
        throw error;
      }
    }));
  }

  async executeDraftSql(draftId: string, sqlValue: string, parameters?: readonly TDbCellValue[]) {
    this.#assertOpen();
    const draft = await this.#requireEditingDraft(draftId);
    return this.#resourceManager.withReadyResource(draft.resource_id, () => this.#withResourceLane(draft.resource_id, async () => {
      await this.#requireValidatedEditingDraft(draftId);
      try {
        const evidence = await this.#dbResource.executeDraftSql(draft.id, sqlValue, parameters);
        const operation = parameters === undefined ? null : { type: 'boundSql', parameters };
        return await this.#db.dbResource.draft.change.append({ draftId, sequence: evidence.sequence, kind: 'sql', operation, sql: evidence.sql });
      } catch (error) {
        if (!(error instanceof ResourceError) || error.details?.uncertain === true) {
          await this.#markDraftError(draft.id, 'The draft may have changed physically but its SQL change is not safely recorded.');
        }
        throw error;
      }
    }));
  }

  async discardDraft(draftId: string): Promise<TDbCoordinatorDraft> {
    this.#assertOpen();
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    return this.#resourceManager.withReadyResource(draft.resource_id, () => this.#withResourceLane(draft.resource_id, async () => {
      const current = await this.#db.dbResource.draft.get({ id: draftId });
      if (!current || (current.status !== 'editing' && current.status !== 'error')) throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing or failed draft can be discarded.');
      try {
        await this.#dbResource.discardDraft(draftId);
        const discarded = await this.#db.dbResource.draft.discard({ id: draftId, lastError: null });
        if (!discarded) throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft state changed before it could be discarded.');
        return discarded;
      } catch (error) {
        await this.#markDraftError(draftId, 'Draft cleanup failed and can be retried.');
        throw error;
      }
    }));
  }

  async previewApply(tenant: TTenantContext, draftId: string): Promise<TDbApplyPreview>;
  async previewApply(draftId: string): Promise<TDbApplyPreview>;
  async previewApply(
    tenantOrDraftId: TTenantContext | string,
    explicitDraftId?: string,
  ): Promise<TDbApplyPreview> {
    this.#assertOpen();
    const { tenant, identifier: draftId } = this.#requestAuthority(
      tenantOrDraftId,
      explicitDraftId,
    );
    const details = await this.getDraft(draftId);
    if (details.draft.status !== 'editing') throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing draft can be reviewed for apply.');
    const resource = await this.#requireReadyResource(details.draft.resource_id);
    const impact = await this.#impact(tenant, resource.id);
    return { ...details, resource, impact, warnings: structuredWarnings(details.changes), compatibilityNotice: COMPATIBILITY_NOTICE };
  }

  async confirmApply(tenant: TTenantContext, draftId: string): Promise<TDbCoordinatorApplyRun>;
  async confirmApply(draftId: string): Promise<TDbCoordinatorApplyRun>;
  async confirmApply(
    tenantOrDraftId: TTenantContext | string,
    explicitDraftId?: string,
  ): Promise<TDbCoordinatorApplyRun> {
    this.#assertOpen();
    const { tenant, identifier: draftId } = this.#requestAuthority(
      tenantOrDraftId,
      explicitDraftId,
    );
    const candidate = await this.#requireEditingDraft(draftId);
    return this.#resourceManager.withReadyResource(candidate.resource_id, async () => {
      const { apply, draft } = await this.#withResourceLane(candidate.resource_id, async () => {
        const details = await this.#validatedDraftDetails(draftId);
        if (details.draft.status !== 'editing') throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing draft can be applied.');
        await this.#requireReadyResource(candidate.resource_id);
        await this.#requireNoActiveApply(candidate.resource_id);
        return this.#db.dbResource.apply.createFromDraft({
          id: this.#crypto.randomUUID(),
          resourceId: candidate.resource_id,
          draftId,
        });
      });
      this.#detach(this.#runApply(tenant, apply, draft));
      return apply;
    });
  }

  async getApply(applyId: string): Promise<TDbApplyDetails> {
    this.#assertOpen();
    const apply = await this.#db.dbResource.apply.get({ id: applyId });
    if (!apply) throw new ResourceError('DB_RESOURCE_APPLY_FAILED', 'DbResource apply run was not found.');
    return { apply, instances: await this.#db.dbResource.apply.instanceResult.listByApply({ applyId }) };
  }

  listApplies(args: { resourceId: string; before?: { createdAt: string; id: string }; limit?: number }) {
    this.#assertOpen();
    return this.#db.dbResource.apply.list(args);
  }

  async getBackup(resourceId: string): Promise<TDbBackup | null> {
    this.#assertOpen();
    return this.#withResourceLane(resourceId, () => this.#getVerifiedBackup(resourceId));
  }

  async discardBackup(resourceId: string, applyId: string): Promise<void> {
    this.#assertOpen();
    await this.#resourceManager.withReadyResource(resourceId, () => this.#withResourceLane(resourceId, async () => {
      const apply = await this.#db.dbResource.apply.get({ id: applyId });
      if (!apply || apply.resource_id !== resourceId || !apply.backup_retained) throw new ResourceError('DB_RESOURCE_RESTORE_FAILED', 'Retained backup was not found.');
      await this.#db.dbResource.apply.update({ id: applyId, status: apply.status, backupRetained: false, lastError: apply.last_error });
      await this.#dbResource.discardBackup(resourceId, applyId);
    }));
  }

  async previewRestore(tenant: TTenantContext, resourceId: string, applyId: string): Promise<{
    backup: TDbBackup;
    impact: TDbResourceImpact;
    warning: string;
    compatibilityNotice: string;
  }>;
  async previewRestore(resourceId: string, applyId: string): Promise<{
    backup: TDbBackup;
    impact: TDbResourceImpact;
    warning: string;
    compatibilityNotice: string;
  }>;
  async previewRestore(
    tenantOrResourceId: TTenantContext | string,
    resourceOrApplyId: string,
    explicitApplyId?: string,
  ) {
    this.#assertOpen();
    const tenant = typeof tenantOrResourceId === 'string'
      ? this.#legacyTenant
      : tenantOrResourceId;
    const resourceId = typeof tenantOrResourceId === 'string'
      ? tenantOrResourceId
      : resourceOrApplyId;
    const applyId = typeof tenantOrResourceId === 'string'
      ? resourceOrApplyId
      : explicitApplyId;
    if (!applyId) {
      throw new ResourceError('DB_RESOURCE_RESTORE_FAILED', 'A restore apply identifier is required.');
    }
    const backup = await this.getBackup(resourceId);
    if (!backup || backup.applyId !== applyId) throw new ResourceError('DB_RESOURCE_RESTORE_FAILED', 'Retained backup was not found.');
    return {
      backup,
      impact: await this.#impact(tenant, resourceId),
      warning: 'Restoring this backup permanently loses live writes made after the backup was created.',
      compatibilityNotice: COMPATIBILITY_NOTICE,
    };
  }

  async restore(
    tenant: TTenantContext,
    resourceId: string,
    applyId: string,
  ): Promise<TDbCoordinatorApplyRun>;
  async restore(resourceId: string, applyId: string): Promise<TDbCoordinatorApplyRun>;
  async restore(
    tenantOrResourceId: TTenantContext | string,
    resourceOrApplyId: string,
    explicitApplyId?: string,
  ): Promise<TDbCoordinatorApplyRun> {
    this.#assertOpen();
    const tenant = typeof tenantOrResourceId === 'string'
      ? this.#legacyTenant
      : tenantOrResourceId;
    const resourceId = typeof tenantOrResourceId === 'string'
      ? tenantOrResourceId
      : resourceOrApplyId;
    const applyId = typeof tenantOrResourceId === 'string'
      ? resourceOrApplyId
      : explicitApplyId;
    if (!applyId) {
      throw new ResourceError('DB_RESOURCE_RESTORE_FAILED', 'A restore apply identifier is required.');
    }
    return this.#resourceManager.withReadyResource(resourceId, async () => {
      const restore = await this.#withResourceLane(resourceId, async () => {
        await this.#requireReadyResource(resourceId);
        await this.#requireNoActiveApply(resourceId);
        const activeDraft = await this.#db.dbResource.draft.getActive({ resourceId });
        if (activeDraft) throw new ResourceError('DB_RESOURCE_DRAFT_EXISTS', 'Discard or apply the active structure draft before restoring a backup.');
        const backup = await this.#getVerifiedBackup(resourceId);
        if (!backup || backup.applyId !== applyId) throw new ResourceError('DB_RESOURCE_RESTORE_FAILED', 'Retained backup was not found or failed physical verification.');
        return this.#db.dbResource.apply.create({ id: this.#crypto.randomUUID(), resourceId, draftId: null, sourceApplyId: applyId, status: 'preparing' });
      });
      this.#detach(this.#runRestore(tenant, restore, applyId));
      return restore;
    });
  }

  restoreStatus(restoreId: string) {
    this.#assertOpen();
    return this.getApply(restoreId);
  }

  async reconcileStartup(options: TDbResourceStartupReconcileOptions = {}): Promise<void> {
    this.#assertOpen();
    const tenant = options.tenant ?? this.#legacyTenant;
    const resources = await this.#resourceManager.listResources({ kind: 'db' });
    for (const resource of resources) {
      if (options.isPlacementOwned && !await options.isPlacementOwned(resource)) continue;
      await this.#withResourceLane(resource.id, async () => {
        await this.#getVerifiedBackup(resource.id);
        const runs = await this.#listAllApplies(resource.id);
        const retained = runs.find((run) => run.backup_retained);
        for (const apply of runs.filter((run) => ['preparing', 'stopping', 'applying', 'restarting'].includes(run.status))) {
          const reconciliation = await this.#dbResource.reconcileApply(resource.id, apply.id, {
            fallbackBackupApplyId: apply.source_apply_id ? undefined : retained?.id,
            restoreSourceApplyId: apply.source_apply_id ?? undefined,
          });
          const physical = reconciliation.outcome;
          const retainedBackupApplyId = reconciliation.retainedBackupApplyId;
          const results = await this.#db.dbResource.apply.instanceResult.listByApply({ applyId: apply.id });
          if (physical === 'unrecoverable') {
            const error = { code: 'DB_RESOURCE_RECOVERY_FAILED', message: 'Interrupted database work could not verify either the active database or a retained backup.' };
            await this.#db.actorResource.updateProviderState({ id: resource.id, status: 'error', lastError: error });
            if (apply.draft_id) {
              await this.#db.dbResource.apply.finishWithDraft({
                id: apply.id,
                draftId: apply.draft_id,
                status: 'failed',
                draftStatus: 'error',
                lastError: error,
                backupRetained: retainedBackupApplyId === apply.id,
              });
            } else {
              await this.#db.dbResource.apply.update({ id: apply.id, status: 'failed', lastError: error, backupRetained: retainedBackupApplyId === apply.id });
            }
            await this.#syncBackupMetadata(resource.id, retainedBackupApplyId);
            continue;
          }
          await this.#db.actorResource.updateProviderState({
            id: resource.id,
            status: 'ready',
            lastError: physical === 'recovered'
              ? { code: 'DB_RESOURCE_APPLY_RECOVERED', message: 'Interrupted database work restored a verified retained backup.' }
              : null,
          });
          await this.#restartInstances(
            tenant,
            apply.id,
            results.filter((result) => result.was_running).map((result) => result.actor_instance_id),
          );
          const status = physical === 'committed' ? 'succeeded' : physical === 'recovered' ? 'recovered' : 'failed';
          const error = physical === 'committed' ? null
            : physical === 'recovered'
              ? { code: 'DB_RESOURCE_APPLY_RECOVERED', message: 'Interrupted database work restored a verified retained backup.' }
              : { code: 'DB_RESOURCE_APPLY_FAILED', message: 'Interrupted apply did not commit to the live database.' };
          if (apply.draft_id) {
            await this.#db.dbResource.apply.finishWithDraft({
              id: apply.id,
              draftId: apply.draft_id,
              status,
              draftStatus: physical === 'committed' ? 'applied' : physical === 'uncommitted' ? 'editing' : 'error',
              lastError: error,
              backupRetained: retainedBackupApplyId === apply.id,
            });
          } else {
            await this.#db.dbResource.apply.update({ id: apply.id, status, lastError: error, backupRetained: retainedBackupApplyId === apply.id });
          }
          if (retainedBackupApplyId !== null) {
            await this.#discardOlderBackups(resource.id, retainedBackupApplyId);
          }
          await this.#syncBackupMetadata(resource.id, retainedBackupApplyId);
          if (apply.draft_id && physical === 'committed') await this.#dbResource.discardDraft(apply.draft_id).catch(() => undefined);
        }
        const activeDraft = await this.#db.dbResource.draft.getActive({ resourceId: resource.id });
        if (activeDraft?.status === 'editing') {
          await this.#validatedDraftDetails(activeDraft.id).catch(() => undefined);
        } else if (activeDraft?.status === 'applying') {
          const hasRun = runs.some((run) => run.draft_id === activeDraft.id && ['preparing', 'stopping', 'applying', 'restarting'].includes(run.status));
          if (!hasRun) {
            await this.#db.dbResource.draft.updateStatus({
              id: activeDraft.id,
              status: 'error',
              expectedStatus: 'applying',
              lastError: { code: 'DB_RESOURCE_DRAFT_INVALID', message: 'Applying draft has no durable active apply run.' },
            });
          }
        }
      });
    }
  }

  async #runApply(
    tenant: TTenantContext,
    apply: TDbCoordinatorApplyRun,
    draft: TDbCoordinatorDraft,
  ): Promise<void> {
    let resolution: TApplyResolution | null = null;
    let physicalAttempted = false;
    let restartIds: string[] = [];
    let drainLease: TResourceDrainLease | null = null;
    let restartsCompleted = false;
    try {
      const coordinated = await this.#resourceManager.coordinateResourceApply(apply.resource_id, () => this.#withResourceLane(apply.resource_id, async () => {
        await this.#validateDraftSynchronization(draft, await this.#db.dbResource.draft.change.list({ draftId: draft.id }));
        const impact = await this.#impact(tenant, apply.resource_id);
        await this.#db.dbResource.apply.update({ id: apply.id, status: 'stopping', expectedStatus: 'preparing', lastError: null });
        for (const instance of impact.instances) {
          await this.#db.dbResource.apply.instanceResult.upsert({
            applyId: apply.id,
            actorInstanceId: instance.instanceId,
            actorDefinitionName: instance.definitionName,
            wasRunning: instance.running,
            status: instance.running ? 'pendingStop' : 'notRunning',
            error: null,
          });
        }
        const drained = await this.#drainUses(
          tenant,
          apply.id,
          apply.resource_id,
          impact,
          'schema_apply',
          'Actor could not stop before database apply.',
        );
        if (!drained.ok) {
          const ready = await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'ready', lastError: null });
          if (!ready) throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared while aborting apply.');
          return { safeToRestart: true, outcome: 'failed' as const, error: { code: 'DB_BUSY', message: 'Database apply was aborted before live mutation because an actor could not stop.' }, backupRetained: false };
        }
        drainLease = drained.lease;
        restartIds = drained.restartIds;
        await this.#resourceManager.drainResource(apply.resource_id);
        await this.#db.dbResource.apply.update({ id: apply.id, status: 'applying', expectedStatus: 'stopping', lastError: null });
        const changes = await this.#db.dbResource.draft.change.list({ draftId: draft.id });
        physicalAttempted = true;
        try {
          const physical = await this.#dbResource.applyDraft({ resourceId: apply.resource_id, draftId: draft.id, applyId: apply.id, changes });
          resolution = {
            safeToRestart: true,
            outcome: physical.outcome,
            error: physical.error,
            backupRetained: physical.backupRetained,
            expectedStatus: 'restarting',
          };
        } catch (error) {
          const failure = safeError(error, 'DB_RESOURCE_APPLY_FAILED', 'DbResource apply failed.');
          const reconciliation = await this.#dbResource.reconcileApply(apply.resource_id, apply.id);
          resolution = reconciliation.outcome === 'committed'
            ? { safeToRestart: true, outcome: 'succeeded', error: null, backupRetained: reconciliation.retainedBackupApplyId === apply.id, expectedStatus: 'restarting' }
            : reconciliation.outcome === 'recovered'
              ? { safeToRestart: true, outcome: 'recovered', error: { code: 'DB_RESOURCE_APPLY_RECOVERED', message: 'The apply failed and the verified previous database was restored.' }, backupRetained: reconciliation.retainedBackupApplyId === apply.id, expectedStatus: 'restarting' }
              : reconciliation.outcome === 'uncommitted'
                ? { safeToRestart: true, outcome: 'failed', error: failure, backupRetained: reconciliation.retainedBackupApplyId === apply.id, expectedStatus: 'restarting' }
                : { safeToRestart: false, outcome: 'failed', error: failure, backupRetained: reconciliation.retainedBackupApplyId === apply.id };
        }
        if (!resolution.safeToRestart) {
          const failed = await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'error', lastError: resolution.error });
          if (!failed) throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after an unrecoverable apply.');
          return resolution;
        }
        const ready = await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'ready', lastError: resolution.outcome === 'recovered' ? resolution.error : null });
        if (!ready) throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after apply.');
        await this.#db.dbResource.apply.update({ id: apply.id, status: 'restarting', expectedStatus: 'applying', lastError: resolution.error, backupRetained: resolution.backupRetained });
        return resolution;
      }, true));
      resolution = coordinated;
      if (coordinated.safeToRestart) {
        await this.#restartInstances(tenant, apply.id, restartIds, drainLease);
        restartsCompleted = true;
      } else if (drainLease) {
        await this.#useCoordinator.release(tenant, drainLease, 'hold').catch(() => undefined);
      }
      await this.#db.dbResource.apply.finishWithDraft({
        id: apply.id,
        draftId: draft.id,
        status: coordinated.outcome,
        expectedStatus: coordinated.expectedStatus,
        draftStatus: coordinated.outcome === 'succeeded' ? 'applied' : coordinated.safeToRestart && coordinated.outcome === 'failed' ? 'editing' : 'error',
        lastError: coordinated.error,
        backupRetained: coordinated.backupRetained,
      });
      if (coordinated.backupRetained) await this.#discardOlderBackups(apply.resource_id, apply.id);
      if (coordinated.outcome === 'succeeded') await this.#dbResource.discardDraft(draft.id).catch(() => undefined);
    } catch (error) {
      const failure = safeError(error, 'DB_RESOURCE_APPLY_FAILED', 'DbResource apply failed.');
      if (!resolution && physicalAttempted) {
        await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'error', lastError: failure }).catch(() => null);
        return;
      }
      resolution ??= { safeToRestart: true, outcome: 'failed', error: failure, backupRetained: false };
      if (!resolution.safeToRestart) {
        if (drainLease) await this.#useCoordinator.release(tenant, drainLease, 'hold').catch(() => undefined);
        const failed = await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'error', lastError: resolution.error ?? failure }).catch(() => null);
        if (!failed) return;
        await this.#db.dbResource.apply.finishWithDraft({
          id: apply.id,
          draftId: draft.id,
          status: 'failed',
          draftStatus: 'error',
          lastError: resolution.error ?? failure,
          backupRetained: resolution.backupRetained,
        }).catch(() => null);
        return;
      }
      const ready = await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'ready', lastError: resolution.outcome === 'recovered' ? resolution.error : null }).catch(() => null);
      if (!ready) return;
      if (restartIds.length === 0) restartIds = await this.#restartIntentIds(tenant, apply.id);
      if (!restartsCompleted) {
        try {
          await this.#restartInstances(tenant, apply.id, restartIds, drainLease);
          restartsCompleted = true;
        } catch {
          return;
        }
      }
      const completed = await this.#db.dbResource.apply.finishWithDraft({
        id: apply.id,
        draftId: draft.id,
        status: resolution.outcome,
        draftStatus: resolution.outcome === 'succeeded' ? 'applied' : resolution.outcome === 'failed' ? 'editing' : 'error',
        lastError: resolution.error,
        backupRetained: resolution.backupRetained,
      }).catch(() => null);
      if (!completed) return;
      if (resolution.backupRetained) await this.#discardOlderBackups(apply.resource_id, apply.id);
      if (resolution.outcome === 'succeeded') await this.#dbResource.discardDraft(draft.id).catch(() => undefined);
    }
  }

  async #runRestore(
    tenant: TTenantContext,
    restore: TDbCoordinatorApplyRun,
    sourceApplyId: string,
  ): Promise<void> {
    let resolution: TRestoreResolution | null = null;
    let physicalAttempted = false;
    let restartIds: string[] = [];
    let drainLease: TResourceDrainLease | null = null;
    let restartsCompleted = false;
    try {
      const coordinated = await this.#resourceManager.coordinateResourceApply(restore.resource_id, () => this.#withResourceLane(restore.resource_id, async () => {
        const impact = await this.#impact(tenant, restore.resource_id);
        await this.#db.dbResource.apply.update({ id: restore.id, status: 'stopping', expectedStatus: 'preparing', lastError: null });
        for (const instance of impact.instances) {
          await this.#db.dbResource.apply.instanceResult.upsert({ applyId: restore.id, actorInstanceId: instance.instanceId, actorDefinitionName: instance.definitionName, wasRunning: instance.running, status: instance.running ? 'pendingStop' : 'notRunning', error: null });
        }
        const drained = await this.#drainUses(
          tenant,
          restore.id,
          restore.resource_id,
          impact,
          'restore',
          'Actor could not stop before backup restore.',
        );
        if (!drained.ok) {
          await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'ready', lastError: null });
          return { safeToRestart: true, ok: false, error: { code: 'DB_BUSY', message: 'Restore was aborted before live mutation because an actor could not stop.' } };
        }
        drainLease = drained.lease;
        restartIds = drained.restartIds;
        await this.#resourceManager.drainResource(restore.resource_id);
        await this.#db.dbResource.apply.update({ id: restore.id, status: 'applying', expectedStatus: 'stopping', lastError: null });
        physicalAttempted = true;
        try {
          await this.#dbResource.restoreBackup(restore.resource_id, sourceApplyId, restore.id);
          resolution = { safeToRestart: true, ok: true, error: null, expectedStatus: 'restarting' };
        } catch (error) {
          const failure = safeError(error, 'DB_RESOURCE_RESTORE_FAILED', 'DbResource backup restore failed.');
          const reconciliation = await this.#dbResource.reconcileApply(restore.resource_id, restore.id, { restoreSourceApplyId: sourceApplyId });
          resolution = reconciliation.outcome === 'committed' || reconciliation.outcome === 'recovered'
            ? { safeToRestart: true, ok: true, error: null, expectedStatus: 'restarting' }
            : reconciliation.outcome === 'uncommitted'
              ? { safeToRestart: true, ok: false, error: failure, expectedStatus: 'restarting' }
              : { safeToRestart: false, ok: false, error: failure };
        }
        if (!resolution.safeToRestart) {
          const failed = await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'error', lastError: resolution.error });
          if (!failed) throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after an unrecoverable restore.');
          return resolution;
        }
        const ready = await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'ready', lastError: null });
        if (!ready) throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after restore.');
        await this.#db.dbResource.apply.update({ id: restore.id, status: 'restarting', expectedStatus: 'applying', lastError: resolution.error });
        return resolution;
      }, true));
      resolution = coordinated;
      if (coordinated.safeToRestart) {
        await this.#restartInstances(tenant, restore.id, restartIds, drainLease);
        restartsCompleted = true;
      } else if (drainLease) {
        await this.#useCoordinator.release(tenant, drainLease, 'hold').catch(() => undefined);
      }
      await this.#db.dbResource.apply.update({ id: restore.id, status: coordinated.ok ? 'succeeded' : 'failed', expectedStatus: coordinated.expectedStatus, lastError: coordinated.error });
    } catch (error) {
      const failure = safeError(error, 'DB_RESOURCE_RESTORE_FAILED', 'DbResource backup restore failed.');
      if (!resolution && physicalAttempted) {
        await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'error', lastError: failure }).catch(() => null);
        return;
      }
      resolution ??= { safeToRestart: true, ok: false, error: failure };
      if (!resolution.safeToRestart) {
        if (drainLease) await this.#useCoordinator.release(tenant, drainLease, 'hold').catch(() => undefined);
        const failed = await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'error', lastError: resolution.error ?? failure }).catch(() => null);
        if (!failed) return;
        await this.#db.dbResource.apply.update({ id: restore.id, status: 'failed', lastError: resolution.error ?? failure }).catch(() => null);
        return;
      }
      const ready = await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'ready', lastError: null }).catch(() => null);
      if (!ready) return;
      if (restartIds.length === 0) restartIds = await this.#restartIntentIds(tenant, restore.id);
      if (!restartsCompleted) {
        try {
          await this.#restartInstances(tenant, restore.id, restartIds, drainLease);
          restartsCompleted = true;
        } catch {
          return;
        }
      }
      await this.#db.dbResource.apply.update({ id: restore.id, status: resolution.ok ? 'succeeded' : 'failed', lastError: resolution.error }).catch(() => null);
    }
  }

  async #drainUses(
    tenant: TTenantContext,
    applyId: string,
    resourceId: string,
    impact: TDbResourceImpact,
    reason: 'schema_apply' | 'restore',
    stopFailureMessage: string,
  ): Promise<
    | { readonly ok: true; readonly lease: TResourceDrainLease; readonly restartIds: string[] }
    | { readonly ok: false }
  > {
    const running = impact.instances.filter((instance) => instance.running);
    const result = await this.#useCoordinator.drain(tenant, {
      resourceId,
      reason,
      timeoutMs: RESOURCE_DRAIN_TIMEOUT_MS,
    });
    if (!result.ok) {
      const stillActive = new Set(
        result.inspection.uses
          .filter((use) => use.state === 'active')
          .map((use) => use.id),
      );
      const stopped = running.filter((instance) => !stillActive.has(instance.instanceId));
      const rollbackLease = this.#syntheticDrainLease(resourceId, applyId, stopped);
      const rollback = stopped.length === 0
        ? null
        : await this.#useCoordinator.release(tenant, rollbackLease, 'resume').catch(() => null);
      const resumed = new Set(rollback?.resumedUseIds ?? []);
      for (const instance of running) {
        const wasStopped = stopped.some((candidate) => candidate.instanceId === instance.instanceId);
        const restarted = wasStopped && resumed.has(instance.instanceId);
        await this.#db.dbResource.apply.instanceResult.upsert({
          applyId,
          actorInstanceId: instance.instanceId,
          actorDefinitionName: instance.definitionName,
          wasRunning: true,
          status: restarted ? 'restarted' : 'stopFailed',
          error: restarted ? null : { code: 'ACTOR_STOP_FAILED', message: stopFailureMessage },
        });
      }
      return { ok: false };
    }

    const drainedIds = new Set(result.lease.drainedUses.map((use) => use.id));
    if (running.some((instance) => !drainedIds.has(instance.instanceId))) {
      await this.#useCoordinator.release(tenant, result.lease, 'resume').catch(() => undefined);
      for (const instance of running) {
        await this.#db.dbResource.apply.instanceResult.upsert({
          applyId,
          actorInstanceId: instance.instanceId,
          actorDefinitionName: instance.definitionName,
          wasRunning: true,
          status: 'stopFailed',
          error: { code: 'ACTOR_STOP_FAILED', message: stopFailureMessage },
        });
      }
      return { ok: false };
    }

    for (const instance of running) {
      await this.#db.dbResource.apply.instanceResult.upsert({
        applyId,
        actorInstanceId: instance.instanceId,
        actorDefinitionName: instance.definitionName,
        wasRunning: true,
        status: 'stopped',
        error: null,
      });
    }
    return {
      ok: true,
      lease: result.lease,
      restartIds: running.map((instance) => instance.instanceId),
    };
  }

  #syntheticDrainLease(
    resourceId: string,
    applyId: string,
    instances: readonly TDbResourceImpact['instances'][number][],
  ): TResourceDrainLease {
    return {
      resourceId,
      leaseId: `db-resource-apply:${applyId}`,
      leaseEpoch: 0,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      drainedUses: instances.map((instance) => ({
        id: instance.instanceId,
        kind: 'legacy-actor',
        state: 'stopped',
        label: instance.definitionName,
      })),
    };
  }

  async #restartIntentIds(tenant: TTenantContext, applyId: string): Promise<string[]> {
    const results = await this.#db.dbResource.apply.instanceResult.listByApply({ applyId });
    const apply = await this.#db.dbResource.apply.get({ id: applyId });
    if (!apply) return [];
    const inspection = await this.#useCoordinator.inspect(tenant, apply.resource_id);
    const activeUseIds = new Set(
      inspection.uses
        .filter((use) => use.state === 'active')
        .map((use) => use.id),
    );
    return results
      .filter((result) => result.was_running && result.status !== 'stopFailed' && !activeUseIds.has(result.actor_instance_id))
      .map((result) => result.actor_instance_id);
  }

  async #restartInstances(
    tenant: TTenantContext,
    applyId: string,
    instanceIds: readonly string[],
    acceptedLease: TResourceDrainLease | null = null,
  ): Promise<void> {
    const apply = await this.#db.dbResource.apply.get({ id: applyId });
    if (!apply) return;
    const results = await this.#db.dbResource.apply.instanceResult.listByApply({ applyId });
    const currentById = new Map(results.map((result) => [result.actor_instance_id, result]));
    const instances = instanceIds.flatMap((instanceId) => {
      const current = currentById.get(instanceId);
      return current === undefined ? [] : [{
        instanceId,
        definitionName: current.actor_definition_name,
        status: current.status,
        running: false,
      }];
    });
    const lease = acceptedLease ?? this.#syntheticDrainLease(apply.resource_id, applyId, instances);
    for (const instance of instances) {
      await this.#db.dbResource.apply.instanceResult.upsert({
        applyId,
        actorInstanceId: instance.instanceId,
        actorDefinitionName: instance.definitionName,
        wasRunning: true,
        status: 'pendingRestart',
        error: null,
      });
    }
    const release = await this.#useCoordinator.release(tenant, lease, 'resume').catch(() => null);
    const resumed = new Set(release?.resumedUseIds ?? []);
    const inspection = await this.#useCoordinator.inspect(tenant, apply.resource_id).catch(() => null);
    for (const use of inspection?.uses ?? []) {
      if (use.state === 'active') resumed.add(use.id);
    }
    for (const instance of instances) {
      const running = resumed.has(instance.instanceId);
      await this.#db.dbResource.apply.instanceResult.upsert({
        applyId,
        actorInstanceId: instance.instanceId,
        actorDefinitionName: instance.definitionName,
        wasRunning: true,
        status: running ? 'restarted' : 'startFailed',
        error: running ? null : { code: 'ACTOR_START_FAILED', message: 'Actor could not start after database work.' },
      });
    }
  }

  async #requireResource(resourceId: string) {
    const resource = await this.#resourceManager.getResource(resourceId);
    if (!resource) throw new ResourceError('RESOURCE_NOT_FOUND', `Resource "${resourceId}" was not found.`);
    if (resource.kind !== 'db') throw new ResourceError('RESOURCE_KIND_MISMATCH', `Resource "${resourceId}" is not a DbResource.`);
    return resource;
  }

  async #requireReadyResource(resourceId: string) {
    const resource = await this.#requireResource(resourceId);
    if (resource.status !== 'ready') throw new ResourceError('RESOURCE_NOT_READY', `DbResource "${resource.name}" is ${resource.status}.`);
    return resource;
  }

  async #requireEditingDraft(draftId: string) {
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    if (draft.status !== 'editing') throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'DbResource structure draft is not editable.');
    return draft;
  }

  async #requireValidatedEditingDraft(draftId: string): Promise<TDbCoordinatorDraft> {
    const details = await this.#validatedDraftDetails(draftId);
    if (details.draft.status !== 'editing') throw new ResourceError('DB_RESOURCE_DRAFT_INVALID', 'DbResource structure draft is not editable.');
    return details.draft;
  }

  async #validatedDraftDetails(draftId: string): Promise<TDbDraftDetails> {
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    const changes = await this.#db.dbResource.draft.change.list({ draftId });
    if (draft.status === 'editing' || draft.status === 'applying') {
      await this.#validateDraftSynchronization(draft, changes);
    }
    return { draft, changes };
  }

  async #validateDraftSynchronization(draft: TDbCoordinatorDraft, changes: TDbDraftDetails['changes']): Promise<void> {
    let synchronized = false;
    try {
      const evidence = await this.#dbResource.listDraftChangeEvidence(draft.id);
      synchronized = evidence.length === changes.length && evidence.every((entry, index) => (
        entry.sequence === changes[index]?.sequence
        && entry.kind === changes[index]?.kind
        && entry.sql === changes[index]?.sql
      ));
    } catch {
      synchronized = false;
    }
    if (synchronized) return;
    const error = { code: 'DB_RESOURCE_DRAFT_INVALID', message: 'Physical draft changes diverged from the durable ordered change log.' };
    if (draft.status === 'editing') {
      await this.#db.dbResource.draft.updateStatus({ id: draft.id, status: 'error', expectedStatus: 'editing', lastError: error }).catch(() => null);
    }
    throw new ResourceError(error.code as 'DB_RESOURCE_DRAFT_INVALID', error.message);
  }

  async #requireNoActiveApply(resourceId: string): Promise<void> {
    const active = (await this.#listAllApplies(resourceId)).find((apply) => ['preparing', 'stopping', 'applying', 'restarting'].includes(apply.status));
    if (active) throw new ResourceError('DB_RESOURCE_APPLY_IN_PROGRESS', 'DbResource already has an active apply or restore run.');
  }

  async #getVerifiedBackup(resourceId: string): Promise<TDbBackup | null> {
    const applies = await this.#listAllApplies(resourceId);
    for (const apply of applies.filter((candidate) => candidate.backup_retained)) {
      if (await this.#dbResource.hasVerifiedBackup(resourceId, apply.id)) {
        return { resourceId, applyId: apply.id, createdAt: apply.created_at };
      }
      await this.#db.dbResource.apply.update({
        id: apply.id,
        status: apply.status,
        lastError: apply.last_error,
        backupRetained: false,
      });
    }
    return null;
  }

  async #markDraftError(draftId: string, message: string): Promise<void> {
    await this.#db.dbResource.draft.updateStatus({ id: draftId, status: 'error', expectedStatus: 'editing', lastError: { code: 'DB_RESOURCE_DRAFT_INVALID', message } }).catch(() => null);
  }

  async #discardOlderBackups(resourceId: string, keepApplyId: string): Promise<void> {
    const applies = await this.#listAllApplies(resourceId);
    for (const apply of applies) {
      if (apply.id === keepApplyId || !apply.backup_retained) continue;
      try {
        await this.#db.dbResource.apply.update({
          id: apply.id,
          status: apply.status,
          lastError: apply.last_error,
          backupRetained: false,
        });
        await this.#dbResource.discardBackup(resourceId, apply.id);
      } catch {
        // Metadata-first deletion may leave an unreferenced physical orphan, never a phantom retained backup.
      }
    }
  }

  async #syncBackupMetadata(resourceId: string, retainedApplyId: string | null): Promise<void> {
    const applies = await this.#listAllApplies(resourceId);
    for (const apply of applies) {
      const retained = apply.id === retainedApplyId;
      if (apply.backup_retained === retained) continue;
      await this.#db.dbResource.apply.update({
        id: apply.id,
        status: apply.status,
        lastError: apply.last_error,
        backupRetained: retained,
      });
    }
  }

  async #listAllApplies(resourceId: string): Promise<TDbCoordinatorApplyRun[]> {
    const applies: TDbCoordinatorApplyRun[] = [];
    let before: { createdAt: string; id: string } | undefined;
    while (true) {
      const page = await this.#db.dbResource.apply.list({ resourceId, before, limit: 100 });
      applies.push(...page);
      if (page.length < 100) return applies;
      const last = page.at(-1)!;
      before = { createdAt: last.created_at, id: last.id };
    }
  }

  #withResourceLane<T>(resourceId: string, operation: () => Promise<T>, accepted = false): Promise<T> {
    if (this.#closed && !accepted) return Promise.reject(new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource coordinator is closed.'));
    const previous = this.#resourceTails.get(resourceId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.#resourceTails.set(resourceId, tail);
    void tail.finally(() => {
      if (this.#resourceTails.get(resourceId) === tail) this.#resourceTails.delete(resourceId);
    });
    return result;
  }

  #requestAuthority(
    tenantOrIdentifier: TTenantContext | string,
    explicitIdentifier?: string,
  ): Readonly<{ tenant: TTenantContext; identifier: string }> {
    if (typeof tenantOrIdentifier === 'string') {
      return { tenant: this.#legacyTenant, identifier: tenantOrIdentifier };
    }
    if (!explicitIdentifier) {
      throw new ResourceError('RESOURCE_CALL_INVALID', 'A resource coordinator identifier is required.');
    }
    return { tenant: tenantOrIdentifier, identifier: explicitIdentifier };
  }

  #assertOpen(): void {
    if (this.#closed) throw new ResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource coordinator is closed.');
  }

  #detach(task: Promise<void>): void {
    this.#detachedTasks.add(task);
    void task.then(
      () => this.#detachedTasks.delete(task),
      () => this.#detachedTasks.delete(task),
    );
  }

  async close(): Promise<void> {
    this.#closed = true;
    while (this.#detachedTasks.size > 0 || this.#resourceTails.size > 0) {
      await Promise.allSettled([
        ...this.#resourceTails.values(),
        ...this.#detachedTasks,
      ]);
    }
  }
}
