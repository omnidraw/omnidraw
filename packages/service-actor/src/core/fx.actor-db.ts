import type { TActorDb, TActorRows, TActorTables } from './types';

type TPortal = {
  readonly db: TActorDb;
  readonly tables: TActorTables;
};

type TArgsActor = {
  readonly actorInstanceId: string;
};

function toMillis(value: number | Date): number {
  return typeof value === 'number' ? value : value.getTime();
}

export function fxGetActorRows(portal: TPortal, args: TArgsActor): TActorRows {
  const instance = portal.db.select().from(portal.tables.actor_instances).all().find((row) => row.id === args.actorInstanceId);
  if (!instance) throw new Error(`Unknown actor instance "${args.actorInstanceId}"`);

  const revision = portal.db.select().from(portal.tables.actor_revisions).all().find((row) => row.id === instance.actor_revision_id);
  if (!revision) throw new Error(`Unknown actor revision "${instance.actor_revision_id}"`);

  return { instance, revision };
}

type TArgsEmpty = Record<string, never>;

export function fxListActorInstances(portal: TPortal, args: TArgsEmpty) {
  void args;
  return portal.db.select().from(portal.tables.actor_instances).all();
}

export function fxNextQueuedInbox(portal: TPortal, args: TArgsEmpty) {
  void args;
  return portal.db.select().from(portal.tables.actor_inbox).all()
    .filter((row) => row.status === 'queued')
    .sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at) || a.seq - b.seq)[0];
}

export function fxListClaimedInbox(portal: TPortal, args: TArgsEmpty) {
  void args;
  return portal.db.select().from(portal.tables.actor_inbox).all().filter((row) => row.status === 'claimed');
}

type TArgsConnections = {
  readonly actorInstanceId: string;
  readonly outputName: string;
};

export function fxListOutputConnections(portal: TPortal, args: TArgsConnections) {
  return portal.db.select().from(portal.tables.actor_connections).all()
    .filter((connection) => connection.source_actor_instance_id === args.actorInstanceId && connection.enabled)
    .filter((connection) => {
      const whitelist = connection.event_name_whitelist as readonly string[] | null;
      return !whitelist || whitelist.length === 0 || whitelist.includes(args.outputName);
    });
}

export function fxNextActorInboxSeq(portal: TPortal, args: TArgsActor): number {
  const rows = portal.db.select().from(portal.tables.actor_inbox).all().filter((row) => row.actor_instance_id === args.actorInstanceId);
  return rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
}

export function fxNextActorOutputSeq(portal: TPortal, args: TArgsActor): number {
  const rows = portal.db.select().from(portal.tables.actor_outputs).all().filter((row) => row.actor_instance_id === args.actorInstanceId);
  return rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
}
