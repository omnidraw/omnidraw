import type { TActorDb, TActorInboxRow, TActorInstanceRow, TActorMessage, TActorOutput, TActorTables } from './types';

type TPortal = {
  readonly db: TActorDb;
  readonly tables: TActorTables;
  readonly idFactory: () => string;
  readonly eq: (left: unknown, right: unknown) => unknown;
};

type TArgsClaimInbox = {
  readonly inbox: TActorInboxRow;
  readonly workerId: string;
};

export function txClaimInbox(portal: TPortal, args: TArgsClaimInbox): TActorInboxRow {
  portal.db.update(portal.tables.actor_inbox).set({
    status: 'claimed',
    claimed_by_run_id: args.workerId,
    attempt: args.inbox.attempt + 1,
  }).where(portal.eq(portal.tables.actor_inbox.id, args.inbox.id) as never).run();
  return txFindInbox(portal, { inboxId: args.inbox.id });
}

type TArgsFindInbox = {
  readonly inboxId: string;
};

export function txFindInbox(portal: TPortal, args: TArgsFindInbox): TActorInboxRow {
  const row = portal.db.select().from(portal.tables.actor_inbox).all().find((inbox) => inbox.id === args.inboxId);
  if (!row) throw new Error(`Unknown actor inbox "${args.inboxId}"`);
  return row;
}

type TArgsPatchInbox = {
  readonly inboxId: string;
  readonly patch: Partial<Omit<TActorInboxRow, 'id'>>;
};

export function txPatchInbox(portal: TPortal, args: TArgsPatchInbox): TActorInboxRow {
  portal.db.update(portal.tables.actor_inbox).set(args.patch).where(portal.eq(portal.tables.actor_inbox.id, args.inboxId) as never).run();
  return txFindInbox(portal, { inboxId: args.inboxId });
}

type TArgsPatchActor = {
  readonly actorInstanceId: string;
  readonly patch: Partial<Omit<TActorInstanceRow, 'id'>>;
};

export function txPatchActorInstance(portal: TPortal, args: TArgsPatchActor): TActorInstanceRow {
  portal.db.update(portal.tables.actor_instances).set(args.patch).where(portal.eq(portal.tables.actor_instances.id, args.actorInstanceId) as never).run();
  const row = portal.db.select().from(portal.tables.actor_instances).all().find((actor) => actor.id === args.actorInstanceId);
  if (!row) throw new Error(`Unknown actor instance "${args.actorInstanceId}"`);
  return row;
}

type TArgsInsertInbox = {
  readonly workspaceId?: string | null;
  readonly canvasId: string;
  readonly actorInstanceId: string;
  readonly seq: number;
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly idempotencyKey: string;
  readonly sourceActorInstanceId?: string;
  readonly sourceOutputId?: string;
  readonly connectionId?: string;
  readonly message: TActorMessage;
  readonly createdAt: Date;
};

export function txInsertInbox(portal: TPortal, args: TArgsInsertInbox): TActorInboxRow {
  return portal.db.insert(portal.tables.actor_inbox).values({
    id: portal.idFactory(),
    workspace_id: args.workspaceId ?? null,
    canvas_id: args.canvasId,
    actor_instance_id: args.actorInstanceId,
    seq: args.seq,
    message_id: args.messageId,
    correlation_id: args.correlationId,
    causation_id: args.causationId ?? null,
    idempotency_key: args.idempotencyKey,
    source_actor_instance_id: args.sourceActorInstanceId ?? null,
    source_output_id: args.sourceOutputId ?? null,
    connection_id: args.connectionId ?? null,
    event_name: args.message.name,
    params: args.message.payload,
    status: 'queued',
    attempt: 0,
    created_at: args.createdAt,
  }).returning().all()[0]!;
}

type TArgsInsertOutput = {
  readonly instance: TActorInstanceRow;
  readonly seq: number;
  readonly outputId: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly output: TActorOutput;
  readonly machineState: string;
  readonly workflowRunId?: string;
  readonly workflowStepId?: string;
  readonly createdAt: Date;
};

export function txInsertOutput(portal: TPortal, args: TArgsInsertOutput) {
  return portal.db.insert(portal.tables.actor_outputs).values({
    id: portal.idFactory(),
    workspace_id: args.instance.workspace_id,
    canvas_id: args.instance.canvas_id,
    actor_instance_id: args.instance.id,
    seq: args.seq,
    output_id: args.outputId,
    message_id: args.messageId,
    correlation_id: args.correlationId,
    causation_id: args.causationId ?? null,
    output_name: args.output.name,
    payload: args.output.payload,
    machine_state: args.machineState,
    workflow_run_id: args.workflowRunId ?? null,
    workflow_step_id: args.workflowStepId ?? null,
    commit_status: 'committed',
    created_at: args.createdAt,
  }).returning().all()[0]!;
}
