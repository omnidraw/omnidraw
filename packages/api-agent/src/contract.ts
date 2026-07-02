import { eventIterator, oc } from '@orpc/contract';
import { ZActorStatus, ZJson } from "@vibecanvas/service-db/model";
import { z } from 'zod';
import { ZVibecanvasJson } from "@vibecanvas/service-actor/core/vibecanvasjson.zod"

const ZAgentSettings = z.object({
  defaultModel: z.string().optional(),
  defaultProvider: z.string().optional(),
  defaultThinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  providersWithCredentials: z.string().array(),
  providers: z.string().array(),
  models: z.object({
    id: z.string(),
    input: z.enum(['text', 'image']).array(),
    provider: z.string(),
    name: z.string()
  }).array()
});

const ZAgentLogin = z.object({
  loginId: z.string()
})

const ZAgentApiKeySet = z.object({
  providerId: z.string().min(1),
  key: z.string().min(1),
})

const ZAgentApiKeySetOutput = z.object({
  providerId: z.string(),
})

const ZAgentLoginStatus = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('device-code'),
    userCode: z.string(),
    verificationUri: z.string(),
    intervalSeconds: z.number().optional(),
    expiresInSeconds: z.number().optional(),
    message: z.string().optional(),
  }),
  z.object({ status: z.literal('progress'), message: z.string() }),
  z.object({ status: z.literal('success') }),
  z.object({ status: z.literal('aborted') }),
  z.object({ status: z.literal('error'), message: z.string() }),
])

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
export type TAgentSettings = z.infer<typeof ZAgentSettings>
export type TAgentLoginStatus = z.infer<typeof ZAgentLoginStatus>

export const agentContract = oc.router({
  settings: {
    get: oc
      .output(ZAgentSettings),
  },
  wizzard: {
    connect: oc.input(z.object({widgetId: z.string(), sessionId: z.string()})).output(ZVibecanvasJson.nullable()),
    newSession: oc.input(z.object({widgetId: z.string(), sessionId: z.string()})),
  },
  auth: {
    login: oc
      .input(z.object({ providerId: z.enum(['openai-codex', 'github-copilot']) }))
      .output(ZAgentLogin),
    logout: oc
      .input(z.object({ providerId: z.enum(['openai-codex', 'github-copilot']) }))
      .output(ZAgentApiKeySetOutput),
    status: oc
      .input(z.object({ loginId: z.string() }))
      .output(ZAgentLoginStatus),
    abort: oc.input(z.object({ loginId: z.string() })),
    apiKey: {
      set: oc
        .input(ZAgentApiKeySet)
        .output(ZAgentApiKeySetOutput),
      remove: oc
        .input(z.object({ providerId: z.string().min(1) }))
        .output(ZAgentApiKeySetOutput),
    },
  },
  events: oc
    .input(z.object({}))
    .route({ method: 'GET' })
    .output(eventIterator(ZAgentEvent)),
});