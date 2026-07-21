import type { TTenantDb } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type {
  TDbResourceApplyRun,
  TDbResourceDraft,
  TDbResourceDraftStatus,
  TJson,
} from '@vibecanvas/service-db/model';
import type { ActorSupervisor } from '../ActorSupervisor';
import { ActorResourceError } from './ActorResourceError';
import type { ActorResourceManager } from './ActorResourceManager';
import type { DbResource } from './DbResource';
import type {
  TDbApplyDetails,
  TDbApplyPreview,
  TDbBackup,
  TDbDraftDetails,
  TDbDraftOperation,
  TDbResourceImpact,
  TDbCellValue,
} from './resource-types';

const COMPATIBILITY_NOTICE = 'Actor compatibility cannot be guaranteed. Restart results are observed runtime outcomes only.';

type TDbResourceCoordinatorConfig = {
  readonly db: TTenantDb;
  readonly resourceManager: ActorResourceManager;
  readonly supervisor: ActorSupervisor;
  readonly dbResource: DbResource;
  readonly crypto: Pick<Crypto, 'randomUUID'>;
};

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

function safeError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  if (error instanceof ActorResourceError) return { code: error.code, message: error.message };
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
  readonly #db: TTenantDb;
  readonly #resourceManager: ActorResourceManager;
  readonly #supervisor: ActorSupervisor;
  readonly #dbResource: DbResource;
  readonly #crypto: Pick<Crypto, 'randomUUID'>;
  readonly #resourceTails = new Map<string, Promise<void>>();
  readonly #detachedTasks = new Set<Promise<void>>();
  #closed = false;

  constructor(config: TDbResourceCoordinatorConfig) {
    this.#db = config.db;
    this.#resourceManager = config.resourceManager;
    this.#supervisor = config.supervisor;
    this.#dbResource = config.dbResource;
    this.#crypto = config.crypto;
  }

  async impact(resourceId: string): Promise<TDbResourceImpact> {
    this.#assertOpen();
    return this.#impact(resourceId);
  }

  async #impact(resourceId: string): Promise<TDbResourceImpact> {
    const resource = await this.#requireResource(resourceId);
    const bindings = await this.#db.actorResource.listBindingsForResource({ resourceId });
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
        running: this.#supervisor.isInstanceRunning(instance.id),
      })),
    };
  }

  async createDraft(resourceId: string, name: string): Promise<TDbDraftDetails> {
    this.#assertOpen();
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 256) {
      throw new ActorResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft name must be non-blank and at most 256 characters.');
    }
    return this.#resourceManager.withReadyResource(resourceId, () => this.#withResourceLane(resourceId, async () => {
      const resource = await this.#requireReadyResource(resourceId);
      await this.#requireNoActiveApply(resourceId);
      const active = await this.#db.dbResource.draft.getActive({ resourceId });
      if (active) throw new ActorResourceError('DB_RESOURCE_DRAFT_EXISTS', `DbResource "${resource.name}" already has an active structure draft.`);
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
    if (!draft) throw new ActorResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
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
          operation: operation as unknown as TJson,
          sql: evidence.sql,
        });
      } catch (error) {
        if (!(error instanceof ActorResourceError) || error.details?.uncertain === true) {
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
        const operation = parameters === undefined ? null : { type: 'boundSql', parameters } as TJson;
        return await this.#db.dbResource.draft.change.append({ draftId, sequence: evidence.sequence, kind: 'sql', operation, sql: evidence.sql });
      } catch (error) {
        if (!(error instanceof ActorResourceError) || error.details?.uncertain === true) {
          await this.#markDraftError(draft.id, 'The draft may have changed physically but its SQL change is not safely recorded.');
        }
        throw error;
      }
    }));
  }

  async discardDraft(draftId: string): Promise<TDbResourceDraft> {
    this.#assertOpen();
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ActorResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    return this.#resourceManager.withReadyResource(draft.resource_id, () => this.#withResourceLane(draft.resource_id, async () => {
      const current = await this.#db.dbResource.draft.get({ id: draftId });
      if (!current || (current.status !== 'editing' && current.status !== 'error')) throw new ActorResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing or failed draft can be discarded.');
      try {
        await this.#dbResource.discardDraft(draftId);
        const discarded = await this.#db.dbResource.draft.discard({ id: draftId, lastError: null });
        if (!discarded) throw new ActorResourceError('DB_RESOURCE_DRAFT_INVALID', 'Draft state changed before it could be discarded.');
        return discarded;
      } catch (error) {
        await this.#markDraftError(draftId, 'Draft cleanup failed and can be retried.');
        throw error;
      }
    }));
  }

  async previewApply(draftId: string): Promise<TDbApplyPreview> {
    this.#assertOpen();
    const details = await this.getDraft(draftId);
    if (details.draft.status !== 'editing') throw new ActorResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing draft can be reviewed for apply.');
    const resource = await this.#requireReadyResource(details.draft.resource_id);
    const impact = await this.impact(resource.id);
    return { ...details, resource, impact, warnings: structuredWarnings(details.changes), compatibilityNotice: COMPATIBILITY_NOTICE };
  }

  async confirmApply(draftId: string): Promise<TDbResourceApplyRun> {
    this.#assertOpen();
    const candidate = await this.#requireEditingDraft(draftId);
    return this.#resourceManager.withReadyResource(candidate.resource_id, async () => {
      const { apply, draft } = await this.#withResourceLane(candidate.resource_id, async () => {
        const details = await this.#validatedDraftDetails(draftId);
        if (details.draft.status !== 'editing') throw new ActorResourceError('DB_RESOURCE_DRAFT_INVALID', 'Only an editing draft can be applied.');
        await this.#requireReadyResource(candidate.resource_id);
        await this.#requireNoActiveApply(candidate.resource_id);
        return this.#db.dbResource.apply.createFromDraft({
          id: this.#crypto.randomUUID(),
          resourceId: candidate.resource_id,
          draftId,
        });
      });
      this.#detach(this.#runApply(apply, draft));
      return apply;
    });
  }

  async getApply(applyId: string): Promise<TDbApplyDetails> {
    this.#assertOpen();
    const apply = await this.#db.dbResource.apply.get({ id: applyId });
    if (!apply) throw new ActorResourceError('DB_RESOURCE_APPLY_FAILED', 'DbResource apply run was not found.');
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
      if (!apply || apply.resource_id !== resourceId || !apply.backup_retained) throw new ActorResourceError('DB_RESOURCE_RESTORE_FAILED', 'Retained backup was not found.');
      await this.#db.dbResource.apply.update({ id: applyId, status: apply.status, backupRetained: false, lastError: apply.last_error });
      await this.#dbResource.discardBackup(resourceId, applyId);
    }));
  }

  async previewRestore(resourceId: string, applyId: string) {
    this.#assertOpen();
    const backup = await this.getBackup(resourceId);
    if (!backup || backup.applyId !== applyId) throw new ActorResourceError('DB_RESOURCE_RESTORE_FAILED', 'Retained backup was not found.');
    return {
      backup,
      impact: await this.impact(resourceId),
      warning: 'Restoring this backup permanently loses live writes made after the backup was created.',
      compatibilityNotice: COMPATIBILITY_NOTICE,
    };
  }

  async restore(resourceId: string, applyId: string): Promise<TDbResourceApplyRun> {
    this.#assertOpen();
    return this.#resourceManager.withReadyResource(resourceId, async () => {
      const restore = await this.#withResourceLane(resourceId, async () => {
        await this.#requireReadyResource(resourceId);
        await this.#requireNoActiveApply(resourceId);
        const activeDraft = await this.#db.dbResource.draft.getActive({ resourceId });
        if (activeDraft) throw new ActorResourceError('DB_RESOURCE_DRAFT_EXISTS', 'Discard or apply the active structure draft before restoring a backup.');
        const backup = await this.#getVerifiedBackup(resourceId);
        if (!backup || backup.applyId !== applyId) throw new ActorResourceError('DB_RESOURCE_RESTORE_FAILED', 'Retained backup was not found or failed physical verification.');
        return this.#db.dbResource.apply.create({ id: this.#crypto.randomUUID(), resourceId, draftId: null, sourceApplyId: applyId, status: 'preparing' });
      });
      this.#detach(this.#runRestore(restore, applyId));
      return restore;
    });
  }

  restoreStatus(restoreId: string) {
    this.#assertOpen();
    return this.getApply(restoreId);
  }

  async reconcileStartup(): Promise<void> {
    this.#assertOpen();
    const resources = await this.#resourceManager.listResources({ kind: 'db' });
    for (const resource of resources) {
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
          await this.#restartInstances(apply.id, results.filter((result) => result.was_running).map((result) => result.actor_instance_id));
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

  async #runApply(apply: TDbResourceApplyRun, draft: TDbResourceDraft): Promise<void> {
    let resolution: TApplyResolution | null = null;
    let physicalAttempted = false;
    let restartIds: string[] = [];
    let restartsCompleted = false;
    try {
      const coordinated = await this.#resourceManager.coordinateResourceApply(apply.resource_id, () => this.#withResourceLane(apply.resource_id, async () => {
        await this.#validateDraftSynchronization(draft, await this.#db.dbResource.draft.change.list({ draftId: draft.id }));
        const impact = await this.#impact(apply.resource_id);
        const stopped: string[] = [];
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
        for (const instance of impact.instances) {
          if (!instance.running) continue;
          const didStop = await this.#supervisor.stopInstanceForResourceApply(instance.instanceId);
          if (!didStop) {
            await this.#db.dbResource.apply.instanceResult.upsert({ applyId: apply.id, actorInstanceId: instance.instanceId, actorDefinitionName: instance.definitionName, wasRunning: true, status: 'stopFailed', error: { code: 'ACTOR_STOP_FAILED', message: 'Actor could not stop before database apply.' } });
            const ready = await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'ready', lastError: null });
            if (!ready) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared while aborting apply.');
            return { safeToRestart: true, outcome: 'failed' as const, error: { code: 'DB_BUSY', message: 'Database apply was aborted before live mutation because an actor could not stop.' }, backupRetained: false };
          }
          stopped.push(instance.instanceId);
          restartIds = [...stopped];
          await this.#db.dbResource.apply.instanceResult.upsert({ applyId: apply.id, actorInstanceId: instance.instanceId, actorDefinitionName: instance.definitionName, wasRunning: true, status: 'stopped', error: null });
        }
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
          if (!failed) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after an unrecoverable apply.');
          return resolution;
        }
        const ready = await this.#db.actorResource.updateProviderState({ id: apply.resource_id, status: 'ready', lastError: resolution.outcome === 'recovered' ? resolution.error : null });
        if (!ready) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after apply.');
        await this.#db.dbResource.apply.update({ id: apply.id, status: 'restarting', expectedStatus: 'applying', lastError: resolution.error, backupRetained: resolution.backupRetained });
        return resolution;
      }, true));
      resolution = coordinated;
      if (coordinated.safeToRestart) {
        await this.#restartInstances(apply.id, restartIds);
        restartsCompleted = true;
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
      if (restartIds.length === 0) restartIds = await this.#restartIntentIds(apply.id);
      if (!restartsCompleted) {
        try {
          await this.#restartInstances(apply.id, restartIds);
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

  async #runRestore(restore: TDbResourceApplyRun, sourceApplyId: string): Promise<void> {
    let resolution: TRestoreResolution | null = null;
    let physicalAttempted = false;
    let restartIds: string[] = [];
    let restartsCompleted = false;
    try {
      const coordinated = await this.#resourceManager.coordinateResourceApply(restore.resource_id, () => this.#withResourceLane(restore.resource_id, async () => {
        const impact = await this.#impact(restore.resource_id);
        const stopped: string[] = [];
        await this.#db.dbResource.apply.update({ id: restore.id, status: 'stopping', expectedStatus: 'preparing', lastError: null });
        for (const instance of impact.instances) {
          await this.#db.dbResource.apply.instanceResult.upsert({ applyId: restore.id, actorInstanceId: instance.instanceId, actorDefinitionName: instance.definitionName, wasRunning: instance.running, status: instance.running ? 'pendingStop' : 'notRunning', error: null });
          if (!instance.running) continue;
          if (!await this.#supervisor.stopInstanceForResourceApply(instance.instanceId)) {
            await this.#db.dbResource.apply.instanceResult.upsert({ applyId: restore.id, actorInstanceId: instance.instanceId, actorDefinitionName: instance.definitionName, wasRunning: true, status: 'stopFailed', error: { code: 'ACTOR_STOP_FAILED', message: 'Actor could not stop before backup restore.' } });
            await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'ready', lastError: null });
            return { safeToRestart: true, ok: false, error: { code: 'DB_BUSY', message: 'Restore was aborted before live mutation because an actor could not stop.' } };
          }
          stopped.push(instance.instanceId);
          restartIds = [...stopped];
          await this.#db.dbResource.apply.instanceResult.upsert({ applyId: restore.id, actorInstanceId: instance.instanceId, actorDefinitionName: instance.definitionName, wasRunning: true, status: 'stopped', error: null });
        }
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
          if (!failed) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after an unrecoverable restore.');
          return resolution;
        }
        const ready = await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'ready', lastError: null });
        if (!ready) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource disappeared after restore.');
        await this.#db.dbResource.apply.update({ id: restore.id, status: 'restarting', expectedStatus: 'applying', lastError: resolution.error });
        return resolution;
      }, true));
      resolution = coordinated;
      if (coordinated.safeToRestart) {
        await this.#restartInstances(restore.id, restartIds);
        restartsCompleted = true;
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
        const failed = await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'error', lastError: resolution.error ?? failure }).catch(() => null);
        if (!failed) return;
        await this.#db.dbResource.apply.update({ id: restore.id, status: 'failed', lastError: resolution.error ?? failure }).catch(() => null);
        return;
      }
      const ready = await this.#db.actorResource.updateProviderState({ id: restore.resource_id, status: 'ready', lastError: null }).catch(() => null);
      if (!ready) return;
      if (restartIds.length === 0) restartIds = await this.#restartIntentIds(restore.id);
      if (!restartsCompleted) {
        try {
          await this.#restartInstances(restore.id, restartIds);
          restartsCompleted = true;
        } catch {
          return;
        }
      }
      await this.#db.dbResource.apply.update({ id: restore.id, status: resolution.ok ? 'succeeded' : 'failed', lastError: resolution.error }).catch(() => null);
    }
  }

  async #restartIntentIds(applyId: string): Promise<string[]> {
    const results = await this.#db.dbResource.apply.instanceResult.listByApply({ applyId });
    return results
      .filter((result) => result.was_running && result.status !== 'stopFailed' && !this.#supervisor.isInstanceRunning(result.actor_instance_id))
      .map((result) => result.actor_instance_id);
  }

  async #restartInstances(applyId: string, instanceIds: readonly string[]): Promise<void> {
    for (const instanceId of instanceIds) {
      const current = (await this.#db.dbResource.apply.instanceResult.listByApply({ applyId })).find((result) => result.actor_instance_id === instanceId);
      if (!current) continue;
      await this.#db.dbResource.apply.instanceResult.upsert({ applyId, actorInstanceId: instanceId, actorDefinitionName: current.actor_definition_name, wasRunning: true, status: 'pendingRestart', error: null });
      try {
        const actor = await this.#supervisor.restartInstanceAfterResourceApply(instanceId);
        const running = actor !== null && this.#supervisor.isInstanceRunning(instanceId);
        await this.#db.dbResource.apply.instanceResult.upsert({ applyId, actorInstanceId: instanceId, actorDefinitionName: current.actor_definition_name, wasRunning: true, status: running ? 'restarted' : actor ? 'crashed' : 'startFailed', error: running ? null : { code: actor ? 'ACTOR_CRASHED' : 'ACTOR_START_FAILED', message: actor ? 'Actor crashed immediately after restart.' : 'Actor could not start after database work.' } });
      } catch {
        await this.#db.dbResource.apply.instanceResult.upsert({ applyId, actorInstanceId: instanceId, actorDefinitionName: current.actor_definition_name, wasRunning: true, status: 'startFailed', error: { code: 'ACTOR_START_FAILED', message: 'Actor could not start after database work.' } });
      }
    }
  }

  async #requireResource(resourceId: string) {
    const resource = await this.#resourceManager.getResource(resourceId);
    if (!resource) throw new ActorResourceError('RESOURCE_NOT_FOUND', `Resource "${resourceId}" was not found.`);
    if (resource.kind !== 'db') throw new ActorResourceError('RESOURCE_KIND_MISMATCH', `Resource "${resourceId}" is not a DbResource.`);
    return resource;
  }

  async #requireReadyResource(resourceId: string) {
    const resource = await this.#requireResource(resourceId);
    if (resource.status !== 'ready') throw new ActorResourceError('RESOURCE_NOT_READY', `DbResource "${resource.name}" is ${resource.status}.`);
    return resource;
  }

  async #requireEditingDraft(draftId: string) {
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ActorResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    if (draft.status !== 'editing') throw new ActorResourceError('DB_RESOURCE_DRAFT_INVALID', 'DbResource structure draft is not editable.');
    return draft;
  }

  async #requireValidatedEditingDraft(draftId: string): Promise<TDbResourceDraft> {
    const details = await this.#validatedDraftDetails(draftId);
    if (details.draft.status !== 'editing') throw new ActorResourceError('DB_RESOURCE_DRAFT_INVALID', 'DbResource structure draft is not editable.');
    return details.draft;
  }

  async #validatedDraftDetails(draftId: string): Promise<TDbDraftDetails> {
    const draft = await this.#db.dbResource.draft.get({ id: draftId });
    if (!draft) throw new ActorResourceError('DB_RESOURCE_DRAFT_NOT_FOUND', 'DbResource structure draft was not found.');
    const changes = await this.#db.dbResource.draft.change.list({ draftId });
    if (draft.status === 'editing' || draft.status === 'applying') {
      await this.#validateDraftSynchronization(draft, changes);
    }
    return { draft, changes };
  }

  async #validateDraftSynchronization(draft: TDbResourceDraft, changes: TDbDraftDetails['changes']): Promise<void> {
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
    throw new ActorResourceError(error.code as 'DB_RESOURCE_DRAFT_INVALID', error.message);
  }

  async #requireNoActiveApply(resourceId: string): Promise<void> {
    const active = (await this.#listAllApplies(resourceId)).find((apply) => ['preparing', 'stopping', 'applying', 'restarting'].includes(apply.status));
    if (active) throw new ActorResourceError('DB_RESOURCE_APPLY_IN_PROGRESS', 'DbResource already has an active apply or restore run.');
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

  async #listAllApplies(resourceId: string): Promise<TDbResourceApplyRun[]> {
    const applies: TDbResourceApplyRun[] = [];
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
    if (this.#closed && !accepted) return Promise.reject(new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource coordinator is closed.'));
    const previous = this.#resourceTails.get(resourceId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.#resourceTails.set(resourceId, tail);
    void tail.finally(() => {
      if (this.#resourceTails.get(resourceId) === tail) this.#resourceTails.delete(resourceId);
    });
    return result;
  }

  #assertOpen(): void {
    if (this.#closed) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource coordinator is closed.');
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
    await Promise.allSettled([...this.#detachedTasks]);
    await Promise.allSettled([...this.#resourceTails.values()]);
  }
}
