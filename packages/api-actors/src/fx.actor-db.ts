import { and as AND, asc as ASC, eq as EQ, inArray as IN_ARRAY } from 'drizzle-orm';
import { DEFAULT_OSS_ACCOUNT_ID } from '@vibecanvas/service-db/CONSTANTS';
import * as SCHEMA from '@vibecanvas/service-db/schema';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasMemberRole } from '@vibecanvas/service-db/schema';
import { fnToActorConnection, fnToActorInstance, fnToActorRevision } from './fn.actor-input';

export type TPortalActorDb = {
  db: TDrizzleDb;
};

export type TArgsAccount = {
  accountId?: string;
};

export type TArgsCanvasAccess = TArgsAccount & {
  canvasId: string;
};

export type TArgsActorInstanceById = {
  id: string;
};

export type TArgsActorInstanceByElement = {
  canvasId: string;
  elementId: string;
};

export type TArgsActorRevisionById = {
  id: string;
};

export type TArgsActorRevisionList = {
  definitionId?: string;
};

export type TArgsActorConnectionById = {
  id: string;
};

function fxAccountId(args: TArgsAccount): string {
  return args.accountId ?? DEFAULT_OSS_ACCOUNT_ID;
}

export function fxHasCanvasRole(portal: TPortalActorDb, args: TArgsCanvasAccess & { roles: TCanvasMemberRole[] }): boolean {
  return portal.db.query.canvas_members.findFirst({
    where: AND(
      EQ(SCHEMA.canvas_members.canvas_id, args.canvasId),
      EQ(SCHEMA.canvas_members.account_id, fxAccountId(args)),
      IN_ARRAY(SCHEMA.canvas_members.role, args.roles),
    ),
  }).sync() !== undefined;
}

export function fxCanViewCanvas(portal: TPortalActorDb, args: TArgsCanvasAccess): boolean {
  return fxHasCanvasRole(portal, { ...args, roles: ['owner', 'editor', 'viewer'] });
}

export function fxCanEditCanvas(portal: TPortalActorDb, args: TArgsCanvasAccess): boolean {
  return fxHasCanvasRole(portal, { ...args, roles: ['owner', 'editor'] });
}

export function fxCanRegisterActorRevision(portal: TPortalActorDb, args: TArgsAccount): boolean {
  const account = portal.db.query.accounts.findFirst({ where: EQ(SCHEMA.accounts.id, fxAccountId(args)) }).sync();
  return account?.role === 'owner' || account?.role === 'admin';
}

export function fxListActorInstances(portal: TPortalActorDb, args: TArgsCanvasAccess) {
  return portal.db.query.actor_instances.findMany({
    where: EQ(SCHEMA.actor_instances.canvas_id, args.canvasId),
    orderBy: [ASC(SCHEMA.actor_instances.created_at), ASC(SCHEMA.actor_instances.id)],
  }).sync().map(fnToActorInstance);
}

export function fxGetActorInstance(portal: TPortalActorDb, args: TArgsActorInstanceById) {
  const row = portal.db.query.actor_instances.findFirst({ where: EQ(SCHEMA.actor_instances.id, args.id) }).sync();
  return row ? fnToActorInstance(row) : null;
}

export function fxGetActorInstanceByElement(portal: TPortalActorDb, args: TArgsActorInstanceByElement) {
  const row = portal.db.query.actor_instances.findFirst({
    where: AND(
      EQ(SCHEMA.actor_instances.canvas_id, args.canvasId),
      EQ(SCHEMA.actor_instances.element_id, args.elementId),
    ),
  }).sync();
  return row ? fnToActorInstance(row) : null;
}

export function fxListActorRevisions(portal: TPortalActorDb, args: TArgsActorRevisionList) {
  if (!args.definitionId) {
    return portal.db.query.actor_revisions.findMany({ orderBy: [ASC(SCHEMA.actor_revisions.created_at), ASC(SCHEMA.actor_revisions.id)] }).sync().map(fnToActorRevision);
  }

  return portal.db.query.actor_revisions.findMany({
    where: EQ(SCHEMA.actor_revisions.actor_definition_id, args.definitionId),
    orderBy: [ASC(SCHEMA.actor_revisions.created_at), ASC(SCHEMA.actor_revisions.id)],
  }).sync().map(fnToActorRevision);
}

export function fxGetActorRevision(portal: TPortalActorDb, args: TArgsActorRevisionById) {
  const row = portal.db.query.actor_revisions.findFirst({ where: EQ(SCHEMA.actor_revisions.id, args.id) }).sync();
  return row ? fnToActorRevision(row) : null;
}

export function fxListActorConnections(portal: TPortalActorDb, args: TArgsCanvasAccess) {
  return portal.db.query.actor_connections.findMany({
    where: EQ(SCHEMA.actor_connections.canvas_id, args.canvasId),
    orderBy: [ASC(SCHEMA.actor_connections.created_at), ASC(SCHEMA.actor_connections.id)],
  }).sync().map(fnToActorConnection);
}

export function fxGetActorConnection(portal: TPortalActorDb, args: TArgsActorConnectionById) {
  const row = portal.db.query.actor_connections.findFirst({ where: EQ(SCHEMA.actor_connections.id, args.id) }).sync();
  return row ? fnToActorConnection(row) : null;
}
