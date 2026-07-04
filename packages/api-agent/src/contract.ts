import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TActorCandidateRecord } from '@vibecanvas/service-agent';
import type { TAgentEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { z } from 'zod';

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

const ZAgentWizzardCancel = z.object({
  canceled: z.boolean(),
  running: z.boolean(),
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

export type { TAgentEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export type TAgentWizzardConnect = {
  vcJson: TVibecanvasJson | null;
  actorCandidate: TActorCandidateRecord | null;
  messageHistory: unknown[];
}

export type TAgentSettings = z.infer<typeof ZAgentSettings>
export type TAgentLoginStatus = z.infer<typeof ZAgentLoginStatus>

export const agentContract = oc.router({
  settings: {
    get: oc
      .output(ZAgentSettings),
  },
  wizzard: {
    connect: oc.input(z.object({widgetId: z.string(), sessionId: z.string()})).output(orpcType<TAgentWizzardConnect>()),
    prompt: oc.input(z.object({
      widgetId: z.string(),
      sessionId: z.string(),
      text: z.string().min(1),
      model: z.object({
        provider: z.string().min(1),
        modelId: z.string().min(1),
      }).optional(),
    })),
    cancel: oc.input(z.object({widgetId: z.string(), sessionId: z.string()})).output(ZAgentWizzardCancel),
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
    .output(eventIterator(orpcType<TAgentEvent>())), 
});
