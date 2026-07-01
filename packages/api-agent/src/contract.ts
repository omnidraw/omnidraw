import { eventIterator, oc } from '@orpc/contract';
import { ZActorStatus, ZJson } from "@vibecanvas/service-db/model";
import { z } from 'zod';

const ZAgentAuth = z.object({
});

export const ZAgentEventOne = z.discriminatedUnion('type', [
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
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    details: ZJson.optional(),
    messageId: z.string().optional(),
  }),
]);

export const ZAgentEventTwo = z.object({
  kind: z.literal('actor'),
  actorId: z.string(),
  name: z.string(),
  payload: ZJson,
  messageId: z.string().optional(),
});

export const ZAgentEvent = z.union([
  ZAgentEventOne,
  ZAgentEventTwo,
]);

export type TAgentEvent = z.infer<typeof ZAgentEvent>

export const agentContract = oc.router({
  auth: {
    get: oc
      .output(ZAgentAuth),
  },
  events: oc
    .input(z.object({}))
    .route({ method: 'GET' })
    .output(eventIterator(ZAgentEvent)),
});