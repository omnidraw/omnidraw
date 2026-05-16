import { eq as EQ } from 'drizzle-orm';
import * as SCHEMA from '@vibecanvas/service-db/schema';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type {
  TCreateActorConnectionInput,
  TCreateActorInstanceInput,
  TRegisterActorRevisionInput,
  TSendActorMessageInput,
  TUpdateActorConnectionInput,
} from './contract';
import { fnGetInitialMachineContext, fnGetInitialMachineState, fnNormalizeRegisterActorRevisionInput, fnToActorConnection, fnToActorInstance, fnToActorRevision } from './fn.actor-input';
import { fxGetActorInstanceByElement, fxGetActorRevision } from './fx.actor-db';

export type TPortalActorDbWrite = {
  db: TDrizzleDb;
  eventPublisher: IEventPublisherService;
  createId: () => string;
};

export type TArgsRegisterActorRevision = {
  input: TRegisterActorRevisionInput;
  accountId?: string;
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

export type TArgsSendActorMessage = {
  input: TSendActorMessageInput;
};

export function txRegisterActorRevision(portal: TPortalActorDbWrite, args: TArgsRegisterActorRevision) {
  const input = fnNormalizeRegisterActorRevisionInput(args.input);
  const actorId = args.accountId ?? 'system';
  const revisionId = portal.createId();
  const definition = portal.db.transaction((tx) => {
    const existingDefinition = input.definitionId
      ? tx.query.actor_definitions.findFirst({ where: EQ(SCHEMA.actor_definitions.id, input.definitionId) }).sync()
      : tx.query.actor_definitions.findFirst({ where: EQ(SCHEMA.actor_definitions.slug, input.slug) }).sync();
    const nextDefinition = existingDefinition ?? tx.insert(SCHEMA.actor_definitions).values({
      id: input.definitionId ?? portal.createId(),
      name: input.name,
      slug: input.slug,
      description: input.description,
      created_by_system_id: actorId,
    }).returning().all()[0]!;

    const revisionRow = tx.insert(SCHEMA.actor_revisions).values({
      id: revisionId,
      actor_definition_id: nextDefinition.id,
      version: input.version,
      revision_hash: input.revisionHash ?? revisionId,
      parent_revision_id: input.parentRevisionId,
      machine_schema: input.machineSchema,
      machine_config: input.machineConfig,
      contract_schema: input.contractSchema,
      output_schema: input.outputSchema,
      server_manifest: input.serverManifest,
      ui_manifest: input.uiManifest,
      server_bundle_file_id: input.serverBundleFileId,
      ui_bundle_file_id: input.uiBundleFileId,
      source_archive_file_id: input.sourceArchiveFileId,
      created_by_system_id: actorId,
    }).returning().all()[0]!;
    const revision = fnToActorRevision(revisionRow);

    const updatedDefinition = tx.update(SCHEMA.actor_definitions)
      .set({
        name: input.name,
        description: input.description,
        current_revision_id: revision.id,
      })
      .where(EQ(SCHEMA.actor_definitions.id, nextDefinition.id))
      .returning()
      .all()[0]!;

    return { definition: updatedDefinition, revision };
  });

  portal.eventPublisher.publishActorEvent('global', {
    type: 'actor.revision.registered',
    definition: definition.definition,
    revision: definition.revision,
  });
  return definition;
}

export function txCreateActorInstance(portal: TPortalActorDbWrite, args: TArgsCreateActorInstance) {
  const definition = portal.db.query.actor_definitions.findFirst({ where: EQ(SCHEMA.actor_definitions.id, args.input.actorDefinitionId) }).sync();
  if (!definition) return null;

  const actorRevisionId = args.input.actorRevisionId ?? definition.current_revision_id;
  if (!actorRevisionId) return null;

  const revision = fxGetActorRevision({ db: portal.db }, { id: actorRevisionId });
  if (!revision || revision.actor_definition_id !== definition.id) return null;

  const instanceRow = portal.db.insert(SCHEMA.actor_instances).values({
    id: portal.createId(),
    canvas_id: args.input.canvasId,
    element_id: args.input.elementId,
    actor_definition_id: definition.id,
    actor_revision_id: revision.id,
    display_name: args.input.displayName ?? definition.name,
    machine_state: fnGetInitialMachineState({ input: args.input, revision }),
    machine_context: fnGetInitialMachineContext({ input: args.input, revision }),
    created_by_system_id: args.accountId ?? 'system',
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
    created_by_system_id: args.accountId ?? 'system',
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

function createTodoContext(portal: TPortalActorDbWrite, args: { context: Record<string, unknown>; eventName: string; params: Record<string, unknown> }) {
  const items = Array.isArray(args.context.items) ? args.context.items : [];
  if (args.eventName === 'todo.add') {
    const title = typeof args.params.title === 'string' ? args.params.title.trim() : '';
    if (!title) return args.context;
    return {
      ...args.context,
      items: [...items, { id: portal.createId(), title, completed: false }],
    };
  }

  if (args.eventName === 'todo.toggle') {
    const id = typeof args.params.id === 'string' ? args.params.id : '';
    return {
      ...args.context,
      items: items.map((item) => {
        if (typeof item !== 'object' || item === null || (item as { id?: unknown }).id !== id) return item;
        return { ...item, completed: !(item as { completed?: unknown }).completed };
      }),
    };
  }

  if (args.eventName === 'todo.remove') {
    const id = typeof args.params.id === 'string' ? args.params.id : '';
    return {
      ...args.context,
      items: items.filter((item) => typeof item !== 'object' || item === null || (item as { id?: unknown }).id !== id),
    };
  }

  if (args.eventName === 'todo.clearCompleted') {
    return {
      ...args.context,
      items: items.filter((item) => typeof item !== 'object' || item === null || (item as { completed?: unknown }).completed !== true),
    };
  }

  return args.context;
}

export function txSendActorMessage(portal: TPortalActorDbWrite, args: TArgsSendActorMessage) {
  const instanceRow = portal.db.query.actor_instances.findFirst({ where: EQ(SCHEMA.actor_instances.id, args.input.actorInstanceId) }).sync();
  if (!instanceRow) return null;

  const definitionRow = portal.db.query.actor_definitions.findFirst({ where: EQ(SCHEMA.actor_definitions.id, instanceRow.actor_definition_id) }).sync();
  const currentContext = instanceRow.machine_context as Record<string, unknown>;
  const nextContext = definitionRow?.slug === 'todo'
    ? createTodoContext(portal, { context: currentContext, eventName: args.input.eventName, params: args.input.params ?? {} })
    : currentContext;

  const updatedRow = portal.db.update(SCHEMA.actor_instances)
    .set({
      status: 'running',
      machine_state: 'ready',
      machine_context: nextContext,
    })
    .where(EQ(SCHEMA.actor_instances.id, args.input.actorInstanceId))
    .returning()
    .all()[0]!;
  const instance = fnToActorInstance(updatedRow);

  portal.eventPublisher.publishActorEvent(instance.canvas_id, {
    type: 'actor.instance.updated',
    canvasId: instance.canvas_id,
    instance,
  });

  return instance;
}
