import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';

const zJsonRecord = z.record(z.string(), z.unknown());
const zJsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(zJsonValue),
  z.record(z.string(), zJsonValue),
]));

const zActorDefinitionTransition = z.object({
  target: z.string(),
  guard: z.string().optional(),
  actions: z.array(z.string()).optional(),
});

const zActorDefinitionState = z.object({
  entry: z.array(z.string()).optional(),
  exit: z.array(z.string()).optional(),
  on: z.record(z.string(), zActorDefinitionTransition).optional(),
});

const zActorDefinitionActorInfo = z.object({
  functionsPath: z.string(),
  initialState: z.string(),
  initialContext: zJsonValue.optional(),
  states: z.record(z.string(), zActorDefinitionState),
  inputSchema: z.record(z.string(), zJsonRecord),
  outputSchema: z.record(z.string(), zJsonRecord),
});

const zActorDefinitionToolBehavior = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mode'), mode: z.enum(['draw-create', 'click-create', 'select', 'hand']) }),
  z.object({ type: z.literal('action') }),
  z.object({ type: z.literal('modal') }),
]);

const zActorDefinitionTool = z.object({
  label: z.string(),
  icon: z.string().optional(),
  shortcuts: z.array(z.string()).optional(),
  group: z.string().optional(),
  priority: z.number().optional(),
  behavior: zActorDefinitionToolBehavior,
});

const zActorListItem = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  version: z.number().int().nonnegative(),
  description: z.string().nullable(),
  tool: zActorDefinitionTool,
});

const zActorDefinition = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  version: z.number().int().nonnegative(),
  description: z.string().nullable(),
  actor: zActorDefinitionActorInfo,
  widget: z.object({
    tool: zActorDefinitionTool,
    sourceFiles: z.record(z.string(), z.string()),
  }),
  created_at: z.date(),
  updated_at: z.date(),
});

const zActorInstance = z.object({
  id: z.string(),
  workspace_id: z.string().nullable(),
  canvas_id: z.string(),
  element_id: z.string(),
  actor_definition_id: z.string(),
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

const zCreateActorInstanceInput = z.object({
  canvasId: z.string(),
  elementId: z.string(),
  actorDefinitionId: z.string(),
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

const zActorMessageSendResult = z.object({
  accepted: z.literal(true),
  inboxId: z.string(),
  messageId: z.string(),
  correlationId: z.string(),
  actorInstanceId: z.string(),
  canvasId: z.string(),
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
    type: z.literal('actor.output.committed'),
    canvasId: z.string(),
    output: zActorOutput,
  }),
  z.object({
    type: z.literal('actor.definition.updated'),
    definition: zActorDefinition,
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
  definitions: oc.router({
    list: oc.input(z.object({ slug: z.string().optional() }).optional()).output(z.array(zActorListItem)),
    get: oc.input(z.object({ id: z.string() })).output(zActorDefinition.nullable()),
  }),
  instances: oc.router({
    list: oc.input(z.object({ canvasId: z.string() })).output(z.array(zActorInstance)),
    get: oc.input(z.object({ id: z.string() })).output(zActorInstance.nullable()),
    create: oc.input(zCreateActorInstanceInput).output(zActorInstance),
    remove: oc.input(z.object({ id: z.string() })).output(zActorInstance),
  }),
  connections: oc.router({
    list: oc.input(z.object({ canvasId: z.string() })).output(z.array(zActorConnection)),
    create: oc.input(zCreateActorConnectionInput).output(zActorConnection),
    update: oc.input(zUpdateActorConnectionInput).output(zActorConnection),
    remove: oc.input(z.object({ id: z.string() })).output(zActorConnection),
  }),
  messages: oc.router({
    send: oc.input(zSendActorMessageInput).output(zActorMessageSendResult),
  }),
  outputs: oc.router({
    list: oc.input(z.object({ actorInstanceId: z.string(), afterSeq: z.number().optional() })).output(z.array(zActorOutput)),
  }),
  events: oc.input(z.object({ canvasId: z.string() })).route({ method: 'GET' }).output(eventIterator(zActorEvent)),
});

type TActorDefinition = z.infer<typeof zActorDefinition>;
type TActorInstance = z.infer<typeof zActorInstance>;
type TActorOutput = z.infer<typeof zActorOutput>;
type TActorConnection = z.infer<typeof zActorConnection>;
type TActorMessageSendResult = z.infer<typeof zActorMessageSendResult>;
type TActorEvent = z.infer<typeof zActorEvent>;
type TCreateActorInstanceInput = z.infer<typeof zCreateActorInstanceInput>;
type TCreateActorConnectionInput = z.infer<typeof zCreateActorConnectionInput>;
type TSendActorMessageInput = z.infer<typeof zSendActorMessageInput>;
type TUpdateActorConnectionInput = z.infer<typeof zUpdateActorConnectionInput>;
type TActorListItem = z.infer<typeof zActorListItem>;

export {
  actorsContract,
  zActorConnection,
  zActorDefinition,
  zActorEvent,
  zActorInstance,
  zActorMessageSendResult,
  zActorOutput,
  zCreateActorConnectionInput,
  zCreateActorInstanceInput,
  zSendActorMessageInput,
  zUpdateActorConnectionInput,
  zActorListItem,
};
export type {
  TActorConnection,
  TActorDefinition,
  TActorEvent,
  TActorInstance,
  TActorMessageSendResult,
  TActorOutput,
  TCreateActorConnectionInput,
  TCreateActorInstanceInput,
  TSendActorMessageInput,
  TUpdateActorConnectionInput,
  TActorListItem,
};
