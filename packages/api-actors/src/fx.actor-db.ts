import type { ActorDb } from '@vibecanvas/service-db/ActorDb';
import type { TCanvasMemberRole } from '@vibecanvas/service-db/model';
import { fnToActorConnection, fnToActorDefinition, fnToActorInstance, fnToActorListItem } from './fn.actor-input';
import type { TActorOutput } from './contract';

export type TPortalActorDb = {
  db: ActorDb;
};

export type TArgsAccount = {
  accountId?: string;
};

export type TArgsCanvasAccess = TArgsAccount & {
  canvasId: string;
};

export type TArgsActorInstanceById = { id: string };
export type TArgsActorInstanceByElement = { canvasId: string; elementId: string };
export type TArgsActorDefinitionById = { id: string };
export type TArgsActorDefinitionBySlug = { slug: string };
export type TArgsActorDefinitionList = { slug?: string };
export type TArgsActorOutputList = { actorInstanceId: string; afterSeq?: number };
export type TArgsActorConnectionById = { id: string };

export async function fxHasCanvasRole(portal: TPortalActorDb, args: TArgsCanvasAccess & { roles: TCanvasMemberRole[] }): Promise<boolean> {
  return await portal.db.hasCanvasRole(args);
}

export async function fxCanViewCanvas(portal: TPortalActorDb, args: TArgsCanvasAccess): Promise<boolean> {
  return await portal.db.canViewCanvas(args);
}

export async function fxCanEditCanvas(portal: TPortalActorDb, args: TArgsCanvasAccess): Promise<boolean> {
  return await portal.db.canEditCanvas(args);
}

export async function fxCanListActorDefinitions(portal: TPortalActorDb, args: TArgsAccount): Promise<boolean> {
  return await portal.db.canListActorDefinitions(args);
}

export async function fxListActorDefinitions(portal: TPortalActorDb, args: TArgsActorDefinitionList = {}) {
  return (await portal.db.listActorDefinitions(args)).map(fnToActorListItem);
}

export async function fxGetActorDefinition(portal: TPortalActorDb, args: TArgsActorDefinitionById) {
  const row = await portal.db.getActorDefinition(args.id);
  return row ? fnToActorDefinition(row) : null;
}

export async function fxGetActorDefinitionBySlug(portal: TPortalActorDb, args: TArgsActorDefinitionBySlug) {
  const row = await portal.db.getActorDefinitionBySlug(args.slug);
  return row ? fnToActorDefinition(row) : null;
}

export async function fxListActorInstances(portal: TPortalActorDb, args: TArgsCanvasAccess) {
  return (await portal.db.listActorInstances({ canvasId: args.canvasId })).map(fnToActorInstance);
}

export async function fxGetActorInstance(portal: TPortalActorDb, args: TArgsActorInstanceById) {
  const row = await portal.db.getActorInstance(args.id);
  return row ? fnToActorInstance(row) : null;
}

export async function fxGetActorInstanceByElement(portal: TPortalActorDb, args: TArgsActorInstanceByElement) {
  const row = await portal.db.getActorInstanceByElement(args);
  return row ? fnToActorInstance(row) : null;
}

export async function fxListActorConnections(portal: TPortalActorDb, args: TArgsCanvasAccess) {
  return (await portal.db.listActorConnections({ canvasId: args.canvasId })).map(fnToActorConnection);
}

export async function fxGetActorConnection(portal: TPortalActorDb, args: TArgsActorConnectionById) {
  const row = await portal.db.getActorConnection(args.id);
  return row ? fnToActorConnection(row) : null;
}

export async function fxListActorOutputs(portal: TPortalActorDb, args: TArgsActorOutputList): Promise<TActorOutput[]> {
  return (await portal.db.listActorOutputs(args)).map((row) => ({
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
