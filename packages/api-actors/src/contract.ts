import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';

const zJsonRecord = z.record(z.string(), z.unknown());

const zActorDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  current_revision_id: z.string().nullable(),
  created_by_system_id: z.string(),
  created_at: z.date(),
});

const zActorRevision = z.object({
  id: z.string(),
  actor_definition_id: z.string(),
  version: z.string(),
  revision_hash: z.string(),
  parent_revision_id: z.string().nullable(),
  machine_schema: zJsonRecord,
  machine_config: zJsonRecord,
  contract_schema: zJsonRecord,
  output_schema: zJsonRecord,
  server_manifest: zJsonRecord,
  ui_manifest: zJsonRecord,
  server_bundle_file_id: z.string().nullable(),
  ui_bundle_file_id: z.string().nullable(),
  source_archive_file_id: z.string().nullable(),
  created_by_system_id: z.string(),
  created_at: z.date(),
});

const zActorInstance = z.object({
  id: z.string(),
  workspace_id: z.string().nullable(),
  canvas_id: z.string(),
  element_id: z.string(),
  actor_definition_id: z.string(),
  actor_revision_id: z.string(),
  display_name: z.string(),
  status: z.enum(['created', 'starting', 'running', 'paused', 'stopping', 'stopped', 'error', 'blocked']),
  machine_state: z.string(),
  machine_context: zJsonRecord,
  workflow_run_id: z.string().nullable(),
  created_by_system_id: z.string(),
  created_at: z.date(),
});

const zActorOutput = z.object({
  id: z.string(),
  workspace_id: z.string().nullable(),
  canvas_id: z.string(),
  actor_instance_id: z.string(),
  seq: z.number(),
  output_id: z.string(),
  message_id: z.string(),
  correlation_id: z.string(),
  causation_id: z.string().nullable(),
  output_name: z.string(),
  payload: z.unknown(),
  machine_state: z.string(),
  created_at: z.date(),
  workflow_run_id: z.string().nullable(),
  workflow_step_id: z.string().nullable(),
  commit_status: z.enum(['staged', 'committed', 'discarded']),
});

const zActorConnection = z.object({
  id: z.string(),
  canvas_id: z.string(),
  source_element_id: z.string(),
  source_actor_instance_id: z.string(),
  target_element_id: z.string(),
  target_actor_instance_id: z.string(),
  enabled: z.boolean(),
  label: z.string().nullable(),
  event_name_whitelist: z.array(z.string()).nullable(),
  style: zJsonRecord,
  created_by_system_id: z.string(),
  created_at: z.date(),
});

const zRegisterActorRevisionInput = z.object({
  definitionId: z.string().optional(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  version: z.string(),
  revisionHash: z.string().optional(),
  parentRevisionId: z.string().nullable().optional(),
  machineSchema: zJsonRecord.optional(),
  machineConfig: zJsonRecord,
  contractSchema: zJsonRecord.optional(),
  outputSchema: zJsonRecord.optional(),
  serverManifest: zJsonRecord.optional(),
  uiManifest: zJsonRecord.optional(),
  serverBundleFileId: z.string().nullable().optional(),
  uiBundleFileId: z.string().nullable().optional(),
  sourceArchiveFileId: z.string().nullable().optional(),
});

const zCreateActorInstanceInput = z.object({
  canvasId: z.string(),
  elementId: z.string(),
  actorDefinitionId: z.string(),
  actorRevisionId: z.string().optional(),
  displayName: z.string().optional(),
  machineState: z.string().optional(),
  machineContext: zJsonRecord.optional(),
});

const zCreateActorConnectionInput = z.object({
  id: z.string().optional(),
  canvasId: z.string(),
  sourceElementId: z.string(),
  targetElementId: z.string(),
  sourceActorInstanceId: z.string().optional(),
  targetActorInstanceId: z.string().optional(),
  label: z.string().nullable().optional(),
  eventNameWhitelist: z.array(z.string()).nullable().optional(),
  style: zJsonRecord.optional(),
});

const zSendActorMessageInput = z.object({
  actorInstanceId: z.string(),
  eventName: z.string(),
  params: zJsonRecord.optional(),
  correlationId: z.string().optional(),
});

const zUpdateActorConnectionInput = z.object({
  id: z.string(),
  patch: z.object({
    enabled: z.boolean().optional(),
    label: z.string().nullable().optional(),
    eventNameWhitelist: z.array(z.string()).nullable().optional(),
    style: zJsonRecord.optional(),
  }),
});

const zActorEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('actor.snapshot'),
    canvasId: z.string(),
    instances: z.array(zActorInstance),
    connections: z.array(zActorConnection),
  }),
  z.object({
    type: z.literal('actor.instance.created'),
    canvasId: z.string(),
    instance: zActorInstance,
  }),
  z.object({
    type: z.literal('actor.instance.updated'),
    canvasId: z.string(),
    instance: zActorInstance,
  }),
  z.object({
    type: z.literal('actor.instance.deleted'),
    canvasId: z.string(),
    instanceId: z.string(),
  }),
  z.object({
    type: z.literal('actor.revision.registered'),
    definition: zActorDefinition,
    revision: zActorRevision,
  }),
  z.object({
    type: z.literal('actor.connection.created'),
    canvasId: z.string(),
    connection: zActorConnection,
  }),
  z.object({
    type: z.literal('actor.connection.updated'),
    canvasId: z.string(),
    connection: zActorConnection,
  }),
  z.object({
    type: z.literal('actor.connection.deleted'),
    canvasId: z.string(),
    connectionId: z.string(),
  }),
]);

const actorsContract = oc.router({
  instances: oc.router({
    list: oc.input(z.object({ canvasId: z.string() })).output(z.array(zActorInstance)),
    get: oc.input(z.object({ id: z.string() })).output(zActorInstance.nullable()),
    create: oc.input(zCreateActorInstanceInput).output(zActorInstance),
    remove: oc.input(z.object({ id: z.string() })).output(zActorInstance),
  }),
  revisions: oc.router({
    register: oc.input(zRegisterActorRevisionInput).output(z.object({ definition: zActorDefinition, revision: zActorRevision })),
    list: oc.input(z.object({ definitionId: z.string().optional(), slug: z.string().optional() })).output(z.array(zActorRevision)),
    get: oc.input(z.object({ id: z.string() })).output(zActorRevision.nullable()),
  }),
  connections: oc.router({
    list: oc.input(z.object({ canvasId: z.string() })).output(z.array(zActorConnection)),
    create: oc.input(zCreateActorConnectionInput).output(zActorConnection),
    update: oc.input(zUpdateActorConnectionInput).output(zActorConnection),
    remove: oc.input(z.object({ id: z.string() })).output(zActorConnection),
  }),
  messages: oc.router({
    send: oc.input(zSendActorMessageInput).output(zActorInstance),
  }),
  outputs: oc.router({
    list: oc.input(z.object({ actorInstanceId: z.string(), afterSeq: z.number().optional() })).output(z.array(zActorOutput)),
  }),
  events: oc.input(z.object({ canvasId: z.string() })).route({ method: 'GET' }).output(eventIterator(zActorEvent)),
});

type TActorDefinition = z.infer<typeof zActorDefinition>;
type TActorRevision = z.infer<typeof zActorRevision>;
type TActorInstance = z.infer<typeof zActorInstance>;
type TActorOutput = z.infer<typeof zActorOutput>;
type TActorConnection = z.infer<typeof zActorConnection>;
type TActorEvent = z.infer<typeof zActorEvent>;
type TRegisterActorRevisionInput = z.infer<typeof zRegisterActorRevisionInput>;
type TCreateActorInstanceInput = z.infer<typeof zCreateActorInstanceInput>;
type TCreateActorConnectionInput = z.infer<typeof zCreateActorConnectionInput>;
type TSendActorMessageInput = z.infer<typeof zSendActorMessageInput>;
type TUpdateActorConnectionInput = z.infer<typeof zUpdateActorConnectionInput>;

export {
  actorsContract,
  zActorConnection,
  zActorDefinition,
  zActorEvent,
  zActorInstance,
  zActorOutput,
  zActorRevision,
  zCreateActorConnectionInput,
  zCreateActorInstanceInput,
  zRegisterActorRevisionInput,
  zSendActorMessageInput,
  zUpdateActorConnectionInput,
};
export type {
  TActorConnection,
  TActorDefinition,
  TActorEvent,
  TActorInstance,
  TActorOutput,
  TActorRevision,
  TCreateActorConnectionInput,
  TCreateActorInstanceInput,
  TRegisterActorRevisionInput,
  TSendActorMessageInput,
  TUpdateActorConnectionInput,
};
