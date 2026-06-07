import type { ActorDb } from '@vibecanvas/service-db/ActorDb';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { TCreateActorConnectionInput, TCreateActorInstanceInput, TUpdateActorConnectionInput } from './contract';
import { fnGetInitialMachineContext, fnGetInitialMachineState, fnToActorConnection, fnToActorDefinition, fnToActorInstance } from './fn.actor-input';

export type TPortalActorDbWrite = {
  db: ActorDb;
  eventPublisher: IEventPublisherService;
  createId: () => string;
};

export type TArgsCreateActorInstance = { input: TCreateActorInstanceInput; accountId?: string };
export type TArgsCreateActorConnection = { input: TCreateActorConnectionInput; accountId?: string };
export type TArgsUpdateActorConnection = { input: TUpdateActorConnectionInput };
export type TArgsRemoveActorConnection = { id: string };
export type TArgsRemoveActorInstance = { id: string };

export async function txCreateActorInstance(portal: TPortalActorDbWrite, args: TArgsCreateActorInstance) {
  const definitionRow = await portal.db.getActorDefinition(args.input.actorDefinitionId);
  if (!definitionRow) return null;
  const definition = fnToActorDefinition(definitionRow);
  const instanceRow = await portal.db.createActorInstance({
    input: args.input,
    accountId: args.accountId,
    machineState: fnGetInitialMachineState({ input: args.input, definition }),
    machineContext: fnGetInitialMachineContext({ input: args.input, definition }),
  });
  if (!instanceRow) return null;
  const instance = fnToActorInstance(instanceRow);
  portal.eventPublisher.publishActorEvent(instance.canvas_id, { type: 'actor.instance.created', canvasId: instance.canvas_id, instance });
  return instance;
}

export async function txCreateActorConnection(portal: TPortalActorDbWrite, args: TArgsCreateActorConnection) {
  const connectionRow = await portal.db.createActorConnection({ input: args.input, accountId: args.accountId });
  if (!connectionRow) return null;
  const connection = fnToActorConnection(connectionRow);
  portal.eventPublisher.publishActorEvent(connection.canvas_id, { type: 'actor.connection.created', canvasId: connection.canvas_id, connection });
  return connection;
}

export async function txUpdateActorConnection(portal: TPortalActorDbWrite, args: TArgsUpdateActorConnection) {
  const connectionRow = await portal.db.updateActorConnection({ id: args.input.id, patch: args.input.patch });
  if (!connectionRow) return null;
  const connection = fnToActorConnection(connectionRow);
  portal.eventPublisher.publishActorEvent(connection.canvas_id, { type: 'actor.connection.updated', canvasId: connection.canvas_id, connection });
  return connection;
}

export async function txRemoveActorConnection(portal: TPortalActorDbWrite, args: TArgsRemoveActorConnection) {
  const connectionRow = await portal.db.removeActorConnection(args.id);
  if (!connectionRow) return null;
  const connection = fnToActorConnection(connectionRow);
  portal.eventPublisher.publishActorEvent(connection.canvas_id, { type: 'actor.connection.deleted', canvasId: connection.canvas_id, connectionId: connection.id });
  return connection;
}

export async function txRemoveActorInstance(portal: TPortalActorDbWrite, args: TArgsRemoveActorInstance) {
  const existing = await portal.db.getActorInstance(args.id);
  if (!existing) return null;
  const connections = (await portal.db.deleteActorConnectionsForInstance(existing.id)).map(fnToActorConnection);
  const instanceRow = await portal.db.deleteActorInstance(args.id);
  if (!instanceRow) return null;
  const instance = fnToActorInstance(instanceRow);
  connections.forEach((connection) => {
    portal.eventPublisher.publishActorEvent(connection.canvas_id, { type: 'actor.connection.deleted', canvasId: connection.canvas_id, connectionId: connection.id });
  });
  portal.eventPublisher.publishActorEvent(instance.canvas_id, { type: 'actor.instance.deleted', canvasId: instance.canvas_id, instanceId: instance.id });
  return instance;
}
