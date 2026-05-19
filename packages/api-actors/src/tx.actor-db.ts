import { eq as EQ, or as OR } from 'drizzle-orm';
import * as SCHEMA from '@vibecanvas/service-db/schema';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type {
  TCreateActorConnectionInput,
  TCreateActorInstanceInput,
  TUpdateActorConnectionInput,
} from './contract';
import { SYSTEM_ACTOR_PRINCIPAL_ID } from './CONSTANTS';
import { fnGetInitialMachineContext, fnGetInitialMachineState, fnToActorConnection, fnToActorDefinition, fnToActorInstance } from './fn.actor-input';
import { fxGetActorInstanceByElement } from './fx.actor-db';

export type TPortalActorDbWrite = {
  db: TDrizzleDb;
  eventPublisher: IEventPublisherService;
  createId: () => string;
};

export type TArgsCreateActorInstance = {
  input: TCreateActorInstanceInput;
  accountId?: string;
};

export type TArgsCreateActorConnection = {
  input: TCreateActorConnectionInput;
  accountId?: string;
};

export type TArgsUpdateActorConnection = {
  input: TUpdateActorConnectionInput;
};

export type TArgsRemoveActorConnection = {
  id: string;
};

export type TArgsRemoveActorInstance = {
  id: string;
};

export function txCreateActorInstance(portal: TPortalActorDbWrite, args: TArgsCreateActorInstance) {
  const definitionRow = portal.db.query.actor_definitions.findFirst({ where: EQ(SCHEMA.actor_definitions.id, args.input.actorDefinitionId) }).sync();
  if (!definitionRow) return null;
  const definition = fnToActorDefinition(definitionRow);

  const instanceRow = portal.db.insert(SCHEMA.actor_instances).values({
    id: portal.createId(),
    canvas_id: args.input.canvasId,
    element_id: args.input.elementId,
    actor_definition_id: definition.id,
    display_name: args.input.displayName ?? definition.name,
    machine_state: fnGetInitialMachineState({ input: args.input, definition }),
    machine_context: fnGetInitialMachineContext({ input: args.input, definition }),
    created_by_system_id: args.accountId ?? SYSTEM_ACTOR_PRINCIPAL_ID,
  }).returning().all()[0]!;
  const instance = fnToActorInstance(instanceRow);

  portal.eventPublisher.publishActorEvent(instance.canvas_id, {
    type: 'actor.instance.created',
    canvasId: instance.canvas_id,
    instance,
  });
  return instance;
}

export function txCreateActorConnection(portal: TPortalActorDbWrite, args: TArgsCreateActorConnection) {
  const sourceActorInstance = args.input.sourceActorInstanceId
    ? portal.db.query.actor_instances.findFirst({ where: EQ(SCHEMA.actor_instances.id, args.input.sourceActorInstanceId) }).sync() ?? null
    : fxGetActorInstanceByElement({ db: portal.db }, { canvasId: args.input.canvasId, elementId: args.input.sourceElementId });
  const targetActorInstance = args.input.targetActorInstanceId
    ? portal.db.query.actor_instances.findFirst({ where: EQ(SCHEMA.actor_instances.id, args.input.targetActorInstanceId) }).sync() ?? null
    : fxGetActorInstanceByElement({ db: portal.db }, { canvasId: args.input.canvasId, elementId: args.input.targetElementId });

  if (!sourceActorInstance || !targetActorInstance) return null;
  if (sourceActorInstance.canvas_id !== args.input.canvasId || targetActorInstance.canvas_id !== args.input.canvasId) return null;
  if (sourceActorInstance.element_id !== args.input.sourceElementId || targetActorInstance.element_id !== args.input.targetElementId) return null;

  const connectionRow = portal.db.insert(SCHEMA.actor_connections).values({
    id: args.input.id ?? portal.createId(),
    canvas_id: args.input.canvasId,
    source_element_id: args.input.sourceElementId,
    source_actor_instance_id: sourceActorInstance.id,
    target_element_id: args.input.targetElementId,
    target_actor_instance_id: targetActorInstance.id,
    label: args.input.label ?? null,
    event_name_whitelist: args.input.eventNameWhitelist ?? null,
    style: args.input.style ?? {},
    created_by_system_id: args.accountId ?? SYSTEM_ACTOR_PRINCIPAL_ID,
  }).returning().all()[0]!;
  const connection = fnToActorConnection(connectionRow);

  portal.eventPublisher.publishActorEvent(connection.canvas_id, {
    type: 'actor.connection.created',
    canvasId: connection.canvas_id,
    connection,
  });
  return connection;
}

export function txUpdateActorConnection(portal: TPortalActorDbWrite, args: TArgsUpdateActorConnection) {
  const existing = portal.db.query.actor_connections.findFirst({ where: EQ(SCHEMA.actor_connections.id, args.input.id) }).sync();
  if (!existing) return null;

  const set = {
    ...(args.input.patch.enabled !== undefined ? { enabled: args.input.patch.enabled } : {}),
    ...(args.input.patch.label !== undefined ? { label: args.input.patch.label } : {}),
    ...(args.input.patch.eventNameWhitelist !== undefined ? { event_name_whitelist: args.input.patch.eventNameWhitelist } : {}),
    ...(args.input.patch.style !== undefined ? { style: args.input.patch.style } : {}),
  };

  const connection = Object.keys(set).length === 0
    ? fnToActorConnection(existing)
    : fnToActorConnection(portal.db.update(SCHEMA.actor_connections)
      .set(set)
      .where(EQ(SCHEMA.actor_connections.id, args.input.id))
      .returning()
      .all()[0]!);

  portal.eventPublisher.publishActorEvent(connection.canvas_id, {
    type: 'actor.connection.updated',
    canvasId: connection.canvas_id,
    connection,
  });
  return connection;
}

export function txRemoveActorConnection(portal: TPortalActorDbWrite, args: TArgsRemoveActorConnection) {
  const connectionRow = portal.db.delete(SCHEMA.actor_connections)
    .where(EQ(SCHEMA.actor_connections.id, args.id))
    .returning()
    .all()[0] ?? null;

  if (!connectionRow) return null;
  const connection = fnToActorConnection(connectionRow);

  portal.eventPublisher.publishActorEvent(connection.canvas_id, {
    type: 'actor.connection.deleted',
    canvasId: connection.canvas_id,
    connectionId: connection.id,
  });
  return connection;
}

export function txRemoveActorInstance(portal: TPortalActorDbWrite, args: TArgsRemoveActorInstance) {
  const existing = portal.db.query.actor_instances.findFirst({ where: EQ(SCHEMA.actor_instances.id, args.id) }).sync();
  if (!existing) return null;

  const connectionRows = portal.db.delete(SCHEMA.actor_connections)
    .where(OR(
      EQ(SCHEMA.actor_connections.source_actor_instance_id, existing.id),
      EQ(SCHEMA.actor_connections.target_actor_instance_id, existing.id),
    ))
    .returning()
    .all();
  const connections = connectionRows.map(fnToActorConnection);

  const instanceRow = portal.db.delete(SCHEMA.actor_instances)
    .where(EQ(SCHEMA.actor_instances.id, args.id))
    .returning()
    .all()[0] ?? null;

  if (!instanceRow) return null;
  const instance = fnToActorInstance(instanceRow);

  connections.forEach((connection) => {
    portal.eventPublisher.publishActorEvent(connection.canvas_id, {
      type: 'actor.connection.deleted',
      canvasId: connection.canvas_id,
      connectionId: connection.id,
    });
  });
  portal.eventPublisher.publishActorEvent(instance.canvas_id, {
    type: 'actor.instance.deleted',
    canvasId: instance.canvas_id,
    instanceId: instance.id,
  });
  return instance;
}

