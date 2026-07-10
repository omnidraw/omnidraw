import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { ZVibecanvasJson } from "@vibecanvas/service-actor/core/vibecanvasjson.zod"
import { ZActorDefinition, ZActorStatus, ZJson, ZWidgetError } from "@vibecanvas/service-db/model"

const ZActorDefListItem = ZVibecanvasJson.extend(ZActorDefinition.shape)
const ZActorDefinitionListItem = ZActorDefinition.extend({
  version: z.string().optional(),
  health: z.enum(['ready', 'error']),
  error: ZWidgetError.nullable(),
})
const ZActorDefResponse = z.object({
  def: ZActorDefListItem,
  widgetCode: z.object({
    content: z.string(),
    path: z.string()
  }).array()
});

const ZActorSnapshot = z.object({
  status: ZActorStatus,
  state: z.string(),
  context: ZJson,
  error: ZWidgetError.nullable(),
})

const ZActorSendMessageResult = z.object({
  messageId: z.string(),
})

export const ZActorSystemEvent = z.discriminatedUnion('type', [
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('ack'),
    messageId: z.string(),
    inputName: z.string(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('state.changed'),
    from: z.string(),
    to: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('status.changed'),
    from: ZActorStatus.nullable(),
    to: ZActorStatus,
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('data.changed'),
    data: ZJson,
    messageId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('snapshot'),
    revision: z.number().int().positive(),
    state: z.string(),
    data: ZJson,
    cause: z.enum(['startup', 'input', 'activity', 'error']),
    jobId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('system'),
    actorId: z.string(),
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    details: ZJson.optional(),
    messageId: z.string().optional(),
  }),
]);

export const ZActorMessageEvent = z.object({
  kind: z.literal('actor'),
  actorId: z.string(),
  name: z.string(),
  payload: ZJson,
  messageId: z.string().optional(),
});

export const ZActorEvent = z.union([
  ZActorSystemEvent,
  ZActorMessageEvent,
]);

export type TActorEvent = z.infer<typeof ZActorEvent>

export const actorsContract = oc.router({
  definitions: {
    list: oc.output(ZActorDefinitionListItem.array()),
    get: oc.input(z.object({ name: z.string() }))
      .output(ZActorDefResponse),
    delete: oc
      .input(z.object({ name: z.string() }))
      .route({ method: 'DELETE' })
      .output(z.object({ deleted: z.boolean() })),
  },
  events: oc
    .input(z.object({}))
    .route({ method: 'GET' })
    .output(eventIterator(ZActorEvent)),
  instances: {
    snapshot: oc
      .input(z.union([
        z.object({ instanceId: z.string() }),
        z.object({ elementId: z.string() }),
      ]))
      .output(ZActorSnapshot),
    sendMessage: oc
      .input(z.object({ name: z.string(), payload: z.unknown(), instanceId: z.string() }))
      .output(ZActorSendMessageResult)
  }
});
