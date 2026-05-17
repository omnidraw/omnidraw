import { eq } from 'drizzle-orm';
import * as schema from '@vibecanvas/service-db/schema';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { WorkflowSuperviserService, type TWorkflowDb } from '@vibecanvas/service-workflow';
import { ACTOR_BOOT_MESSAGE_NAME, DEFAULT_ACTOR_POLL_INTERVAL_MS } from './core/CONSTANTS';
import { fnApplyBuiltinActorEffects } from './core/fn.builtin-effects';
import { fnCanProcessMessage, fnCreateBootMessage, fnCreateTransitionPlan, fnMergeEffectResults } from './core/fn.machine';
import { fnActorWorkflowRunId, fnCreateActorWorkflowDefinition } from './core/fn.workflow-definition';
import { fxGetActorRows, fxListActorInstances, fxListClaimedInbox, fxListOutputConnections, fxNextActorInboxSeq, fxNextActorOutputSeq, fxNextQueuedInbox } from './core/fx.actor-db';
import { txClaimInbox, txInsertInbox, txInsertOutput, txPatchActorInstance, txPatchInbox } from './core/tx.actor-db';
import type { TActorDb, TActorInboxRow, TActorInstanceRow, TActorMessage, TActorOutput, TActorSupervisorStatus } from './core/types';

function toMillis(value: number | Date): number {
  return typeof value === 'number' ? value : value.getTime();
}

export type TActorSupervisorConfig = {
  readonly db: TActorDb;
  readonly workflowDb: TWorkflowDb;
  readonly eventPublisher?: IEventPublisherService;
  readonly workerId?: string;
  readonly pollIntervalMs?: number;
  readonly idFactory?: () => string;
  readonly now?: () => Date;
};

export type TActorSupervisorRunOnceResult =
  | { readonly status: 'idle' }
  | { readonly status: 'scheduled'; readonly inbox: TActorInboxRow }
  | { readonly status: 'processed'; readonly inbox: TActorInboxRow }
  | { readonly status: 'failed'; readonly inbox: TActorInboxRow };

export type TActorSupervisorDrainResult = {
  readonly scheduled: number;
  readonly processed: number;
  readonly failed: number;
};

type TDbPortal = {
  readonly db: TActorDb;
  readonly tables: typeof schema;
  readonly idFactory: () => string;
  readonly eq: typeof eq;
};

export class ActorSupervisor {
  readonly db: TActorDb;
  readonly workflowDb: TWorkflowDb;
  readonly workflowSuperviser: WorkflowSuperviserService;
  readonly eventPublisher?: IEventPublisherService;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly idFactory: () => string;
  readonly now: () => Date;
  #polling = false;
  #lastError: string | null = null;

  constructor(config: TActorSupervisorConfig) {
    this.db = config.db;
    this.workflowDb = config.workflowDb;
    this.eventPublisher = config.eventPublisher;
    this.workflowSuperviser = new WorkflowSuperviserService({ db: config.workflowDb });
    this.workerId = config.workerId ?? 'actor-supervisor';
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_ACTOR_POLL_INTERVAL_MS;
    this.idFactory = config.idFactory ?? (() => crypto.randomUUID());
    this.now = config.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    await this.loadActors();
    this.startPolling();
  }

  stop(): void {
    this.#polling = false;
  }

  startPolling(): void {
    if (this.#polling) return;
    this.#polling = true;
    void this.poll();
  }

  getStatus(): TActorSupervisorStatus {
    return { polling: this.#polling, lastError: this.#lastError };
  }

  async loadActors(): Promise<void> {
    const portal = this.portal();
    for (const actor of fxListActorInstances(portal, {})) {
      if (actor.status !== 'created') continue;
      const bootExists = this.db.select().from(schema.actor_inbox).all()
        .some((row) => row.actor_instance_id === actor.id && row.event_name === ACTOR_BOOT_MESSAGE_NAME);
      if (bootExists) continue;
      await txInsertInbox(portal, {
        workspaceId: actor.workspace_id,
        canvasId: actor.canvas_id,
        actorInstanceId: actor.id,
        seq: fxNextActorInboxSeq(portal, { actorInstanceId: actor.id }),
        messageId: `boot:${actor.id}`,
        correlationId: `boot:${actor.id}`,
        idempotencyKey: `boot:${actor.id}`,
        message: fnCreateBootMessage({ correlationId: `boot:${actor.id}` }),
        createdAt: this.now(),
      });
      const updated = await txPatchActorInstance(portal, { actorInstanceId: actor.id, patch: { status: 'starting' } });
      this.publishActorInstanceUpdated(updated);
    }
  }

  async runOnce(): Promise<TActorSupervisorRunOnceResult> {
    const reconciled = await this.reconcileOneClaimedInbox();
    if (reconciled.status !== 'idle') return reconciled;
    const inbox = fxNextQueuedInbox(this.portal(), {});
    if (!inbox) return { status: 'idle' };
    return await this.scheduleInbox(inbox);
  }

  async drain(): Promise<TActorSupervisorDrainResult> {
    let scheduled = 0;
    let processed = 0;
    let failed = 0;
    while (true) {
      const result = await this.runOnce();
      if (result.status === 'idle') return { scheduled, processed, failed };
      if (result.status === 'scheduled') scheduled += 1;
      if (result.status === 'processed') processed += 1;
      if (result.status === 'failed') failed += 1;
    }
  }

  private async scheduleInbox(inbox: TActorInboxRow): Promise<TActorSupervisorRunOnceResult> {
    const portal = this.portal();
    const claimed = txClaimInbox(portal, { inbox, workerId: this.workerId });
    const rows = fxGetActorRows(portal, { actorInstanceId: claimed.actor_instance_id });
    const message = this.messageFromInbox(claimed);

    if (!fnCanProcessMessage({ instance: rows.instance, message })) {
      const rejected = txPatchInbox(portal, { inboxId: claimed.id, patch: { status: 'rejected', processed_at: this.now(), error: { message: `Actor "${rows.instance.id}" is ${rows.instance.status}` } } });
      return { status: 'failed', inbox: rejected };
    }

    const plan = fnCreateTransitionPlan({ rows, message });
    if (!plan.changed) {
      const processed = txPatchInbox(portal, { inboxId: claimed.id, patch: { status: 'processed', processed_at: this.now() } });
      return { status: 'processed', inbox: processed };
    }
    if (plan.guard) {
      const rejected = txPatchInbox(portal, { inboxId: claimed.id, patch: { status: 'rejected', processed_at: this.now(), error: { message: `Actor transition guard "${plan.guard}" is not supported by ActorService workflows yet` } } });
      return { status: 'failed', inbox: rejected };
    }
    if (plan.effects.length === 0) {
      const updated = await txPatchActorInstance(portal, { actorInstanceId: rows.instance.id, patch: { status: 'running', machine_state: plan.targetState, workflow_run_id: null } });
      this.publishActorInstanceUpdated(updated);
      const processed = txPatchInbox(portal, { inboxId: claimed.id, patch: { status: 'processed', processed_at: this.now() } });
      return { status: 'processed', inbox: processed };
    }

    const builtin = fnApplyBuiltinActorEffects({ manifest: rows.revision.server_manifest, context: rows.instance.machine_context as never, message, effects: plan.effects });
    if (builtin.handled) {
      const updated = await txPatchActorInstance(portal, { actorInstanceId: rows.instance.id, patch: { status: 'running', machine_state: plan.targetState, machine_context: builtin.context, workflow_run_id: null } });
      this.publishActorInstanceUpdated(updated);
      for (const output of builtin.outputs) await this.commitOutput(updated, claimed, output, `builtin:${claimed.id}`);
      const processed = txPatchInbox(portal, { inboxId: claimed.id, patch: { status: 'processed', processed_at: this.now() } });
      return { status: 'processed', inbox: processed };
    }

    const run = await this.workflowSuperviser.ensureRun({
      definition: fnCreateActorWorkflowDefinition({ inbox: claimed, revision: rows.revision, plan }),
      runId: fnActorWorkflowRunId({ inbox: claimed }),
      workspaceId: claimed.workspace_id ?? undefined,
      canvasId: claimed.canvas_id,
      subjectId: claimed.actor_instance_id,
      triggerId: claimed.message_id,
      correlationId: claimed.correlation_id,
      causationId: claimed.causation_id ?? undefined,
    });
    const updated = await txPatchActorInstance(portal, { actorInstanceId: rows.instance.id, patch: { status: 'running', workflow_run_id: run.id } });
    this.publishActorInstanceUpdated(updated);
    return { status: 'scheduled', inbox: claimed };
  }

  private async reconcileOneClaimedInbox(): Promise<TActorSupervisorRunOnceResult> {
    const portal = this.portal();
    const claimedRows = fxListClaimedInbox(portal, {}).sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at) || a.seq - b.seq);
    for (const inbox of claimedRows) {
      const rows = fxGetActorRows(portal, { actorInstanceId: inbox.actor_instance_id });
      if (!rows.instance.workflow_run_id) continue;
      const run = await this.workflowDb.getRun(rows.instance.workflow_run_id);
      if (run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') continue;
      if (run.status !== 'completed') {
        const updated = await txPatchActorInstance(portal, { actorInstanceId: rows.instance.id, patch: { status: 'error', workflow_run_id: null } });
        this.publishActorInstanceUpdated(updated);
        const failed = txPatchInbox(portal, { inboxId: inbox.id, patch: { status: 'deadLettered', processed_at: this.now(), error: run.error ?? { message: `Actor workflow ${run.status}` } } });
        return { status: 'failed', inbox: failed };
      }

      const message = this.messageFromInbox(inbox);
      const plan = fnCreateTransitionPlan({ rows, message });
      const steps = await this.workflowDb.getStepsForRun(run.id);
      const merged = fnMergeEffectResults({ initialContext: rows.instance.machine_context as never, results: steps.map((step) => step.result) });
      const updated = await txPatchActorInstance(portal, { actorInstanceId: rows.instance.id, patch: { status: 'running', machine_state: plan.targetState, machine_context: merged.context, workflow_run_id: null } });
      this.publishActorInstanceUpdated(updated);

      for (const output of merged.outputs) {
        await this.commitOutput(updated, inbox, output, run.id);
      }

      const processed = txPatchInbox(portal, { inboxId: inbox.id, patch: { status: 'processed', processed_at: this.now() } });
      return { status: 'processed', inbox: processed };
    }
    return { status: 'idle' };
  }

  private async commitOutput(instance: Parameters<typeof txInsertOutput>[1]['instance'], inbox: TActorInboxRow, output: TActorOutput, workflowRunId: string): Promise<void> {
    const portal = this.portal();
    const persisted = txInsertOutput(portal, {
      instance,
      seq: fxNextActorOutputSeq(portal, { actorInstanceId: instance.id }),
      outputId: this.idFactory(),
      messageId: inbox.message_id,
      correlationId: inbox.correlation_id,
      causationId: inbox.causation_id ?? undefined,
      output,
      machineState: instance.machine_state,
      workflowRunId,
      createdAt: this.now(),
    });

    this.eventPublisher?.publishActorEvent(persisted.canvas_id, { type: 'actor.output.committed', canvasId: persisted.canvas_id, output: persisted });

    for (const connection of fxListOutputConnections(portal, { actorInstanceId: instance.id, outputName: output.name })) {
      txInsertInbox(portal, {
        workspaceId: persisted.workspace_id,
        canvasId: persisted.canvas_id,
        actorInstanceId: connection.target_actor_instance_id,
        seq: fxNextActorInboxSeq(portal, { actorInstanceId: connection.target_actor_instance_id }),
        messageId: this.idFactory(),
        correlationId: inbox.correlation_id,
        causationId: inbox.message_id,
        idempotencyKey: `connection:${connection.id}:output:${persisted.output_id}`,
        sourceActorInstanceId: instance.id,
        sourceOutputId: persisted.id,
        connectionId: connection.id,
        message: { name: output.name.replace('msg.out.', 'msg.in.'), payload: output.payload },
        createdAt: this.now(),
      });
    }
  }

  private messageFromInbox(inbox: TActorInboxRow): TActorMessage {
    return { name: inbox.event_name, payload: inbox.params as never };
  }

  private async poll(): Promise<void> {
    while (this.#polling) {
      try {
        await this.runOnce();
        this.#lastError = null;
      } catch (error) {
        this.#lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private portal(): TDbPortal {
    return { db: this.db, tables: schema, idFactory: this.idFactory, eq };
  }

  private publishActorInstanceUpdated(instance: TActorInstanceRow): void {
    this.eventPublisher?.publishActorEvent(instance.canvas_id, { type: 'actor.instance.updated', canvasId: instance.canvas_id, instance });
  }
}
