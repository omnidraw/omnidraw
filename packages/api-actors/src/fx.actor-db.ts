import { and as AND, asc as ASC, eq as EQ, gt as GT, inArray as IN_ARRAY } from 'drizzle-orm';
import { DEFAULT_OSS_ACCOUNT_ID } from '@vibecanvas/service-db/CONSTANTS';
import * as SCHEMA from '@vibecanvas/service-db/schema';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { TCanvasMemberRole } from '@vibecanvas/service-db/schema';
import { fnToActorConnection, fnToActorDefinition, fnToActorInstance } from './fn.actor-input';
import type { TActorOutput } from './contract';

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

export type TArgsActorDefinitionById = {
  id: string;
};

export type TArgsActorDefinitionBySlug = {
  slug: string;
};

export type TArgsActorDefinitionList = {
  slug?: string;
};

export type TArgsActorOutputList = {
  actorInstanceId: string;
  afterSeq?: number;
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

export function fxCanListActorDefinitions(portal: TPortalActorDb, args: TArgsAccount): boolean {
  const account = portal.db.query.accounts.findFirst({ where: EQ(SCHEMA.accounts.id, fxAccountId(args)) }).sync();
  return account !== undefined;
}

export function fxListActorDefinitions(portal: TPortalActorDb, args: TArgsActorDefinitionList = {}) {
  const rows = portal.db.query.actor_definitions.findMany({
    where: args.slug ? EQ(SCHEMA.actor_definitions.slug, args.slug) : undefined,
    orderBy: [ASC(SCHEMA.actor_definitions.name), ASC(SCHEMA.actor_definitions.slug), ASC(SCHEMA.actor_definitions.id)],
  }).sync();
  return rows.map(fnToActorDefinition);
}

export function fxGetActorDefinition(portal: TPortalActorDb, args: TArgsActorDefinitionById) {
  const row = portal.db.query.actor_definitions.findFirst({ where: EQ(SCHEMA.actor_definitions.id, args.id) }).sync();
  return row ? fnToActorDefinition(row) : null;
}

export function fxGetActorDefinitionBySlug(portal: TPortalActorDb, args: TArgsActorDefinitionBySlug) {
  const row = portal.db.query.actor_definitions.findFirst({ where: EQ(SCHEMA.actor_definitions.slug, args.slug) }).sync();
  return row ? fnToActorDefinition(row) : null;
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

export function fxListActorOutputs(portal: TPortalActorDb, args: TArgsActorOutputList): TActorOutput[] {
  const where = args.afterSeq === undefined
    ? EQ(SCHEMA.actor_outputs.actor_instance_id, args.actorInstanceId)
    : AND(EQ(SCHEMA.actor_outputs.actor_instance_id, args.actorInstanceId), GT(SCHEMA.actor_outputs.seq, args.afterSeq));

  return portal.db.query.actor_outputs.findMany({
    where,
    orderBy: [ASC(SCHEMA.actor_outputs.seq), ASC(SCHEMA.actor_outputs.id)],
  }).sync().map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    canvas_id: row.canvas_id,
    actor_instance_id: row.actor_instance_id,
    seq: row.seq,
    output_id: row.output_id,
    message_id: row.message_id,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    output_name: row.output_name,
    payload: row.payload,
    machine_state: row.machine_state,
    created_at: row.created_at,
    workflow_run_id: row.workflow_run_id,
    workflow_step_id: row.workflow_step_id,
    commit_status: row.commit_status,
  }));
}
