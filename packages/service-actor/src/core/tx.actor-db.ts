import type { TActorDb, TActorInboxRow, TActorInstanceRow, TActorMessage, TActorOutput } from './types';

type TPortal = {
  readonly db: TActorDb;
  readonly idFactory: () => string;
};

type TArgsClaimInbox = {
  readonly inbox: TActorInboxRow;
  readonly workerId: string;
};

export function txClaimInbox(portal: TPortal, args: TArgsClaimInbox): TActorInboxRow {
  return portal.db.claimInbox(args.inbox, args.workerId);
}

type TArgsFindInbox = {
  readonly inboxId: string;
};

export function txFindInbox(portal: TPortal, args: TArgsFindInbox): TActorInboxRow {
  return portal.db.findInbox(args.inboxId);
}

type TArgsPatchInbox = {
  readonly inboxId: string;
  readonly patch: Partial<Omit<TActorInboxRow, 'id'>>;
};

export function txPatchInbox(portal: TPortal, args: TArgsPatchInbox): TActorInboxRow {
  return portal.db.patchInbox(args.inboxId, args.patch);
}

type TArgsPatchActor = {
  readonly actorInstanceId: string;
  readonly patch: Partial<Omit<TActorInstanceRow, 'id'>>;
};

export function txPatchActorInstance(portal: TPortal, args: TArgsPatchActor): TActorInstanceRow {
  return portal.db.patchActorInstance(args.actorInstanceId, args.patch);
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
  return portal.db.insertInbox(args);
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
  return portal.db.insertOutput(args);
}
