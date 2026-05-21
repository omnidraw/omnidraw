import type { TActorDb, TActorRows } from './types';

type TPortal = {
  readonly db: TActorDb;
};

type TArgsActor = {
  readonly actorInstanceId: string;
};

export function fxGetActorRows(portal: TPortal, args: TArgsActor): TActorRows {
  return portal.db.getActorRows(args.actorInstanceId);
}

type TArgsEmpty = Record<string, never>;

export function fxListActorInstances(portal: TPortal, args: TArgsEmpty) {
  void args;
  return portal.db.listActorInstances();
}

export function fxNextQueuedInbox(portal: TPortal, args: TArgsEmpty) {
  void args;
  return portal.db.nextQueuedInbox();
}

export function fxListClaimedInbox(portal: TPortal, args: TArgsEmpty) {
  void args;
  return portal.db.listClaimedInbox();
}

type TArgsConnections = {
  readonly actorInstanceId: string;
  readonly outputName: string;
};

export function fxListOutputConnections(portal: TPortal, args: TArgsConnections) {
  return portal.db.listOutputConnections(args);
}

export function fxNextActorInboxSeq(portal: TPortal, args: TArgsActor): number {
  return portal.db.nextActorInboxSeq(args.actorInstanceId);
}

export function fxNextActorOutputSeq(portal: TPortal, args: TArgsActor): number {
  return portal.db.nextActorOutputSeq(args.actorInstanceId);
}
