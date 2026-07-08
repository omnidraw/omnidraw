import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import type { TVibecanvasToolIcon } from '@vibecanvas/service-actor/core/tool-icon';
import type { TActorData, TActorState, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZVibecanvasToolIcon } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { TActorCandidateRecord } from '@vibecanvas/service-agent';
import type { TAgentEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { z } from 'zod';

const ZThinkingLevel = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

const ZAgentSettings = z.object({
  defaultModel: z.string().optional(),
  defaultProvider: z.string().optional(),
  defaultThinkingLevel: ZThinkingLevel.optional(),
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

const ZAgentWizzardScope = z.object({ widgetId: z.string(), sessionId: z.string() })
const AGENT_WIZZARD_PROMPT_IMAGE_MAX_COUNT = 5;
const AGENT_WIZZARD_PROMPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const AGENT_WIZZARD_PROMPT_IMAGE_MAX_BASE64_LENGTH = Math.ceil(AGENT_WIZZARD_PROMPT_IMAGE_MAX_BYTES / 3) * 4;
const ZAgentWizzardPromptImage = z.object({
  name: z.string().max(255).optional(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  data: z.string()
    .min(1)
    .max(AGENT_WIZZARD_PROMPT_IMAGE_MAX_BASE64_LENGTH)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict()

const ZAgentWizzardPrompt = ZAgentWizzardScope.extend({
  text: z.string(),
  images: ZAgentWizzardPromptImage.array().max(AGENT_WIZZARD_PROMPT_IMAGE_MAX_COUNT).optional(),
  model: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
  }).optional(),
  thinkingLevel: ZThinkingLevel.optional(),
}).refine((input) => input.text.trim().length > 0 || (input.images?.length ?? 0) > 0, {
  message: 'Prompt text or at least one image is required',
  path: ['text'],
})

const ZAgentWizzardDraftActorSend = ZAgentWizzardScope.extend({
  name: z.string().min(1),
  payload: z.unknown(),
})

const ZAgentWizzardDraftManifestPatch = ZAgentWizzardScope.extend({
  patch: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    initialData: z.unknown().optional(),
    dataSchema: z.unknown().optional(),
    tool: z.object({
      label: z.string().optional(),
      icon: ZVibecanvasToolIcon.nullable().optional(),
      group: z.string().nullable().optional(),
      priority: z.number().nullable().optional(),
    }).strict().optional(),
  }).strict(),
})

export type { TAgentEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';

export type TAgentWizzardConnect = {
  vcJson: TVibecanvasJson | null;
  actorCandidate: TActorCandidateRecord | null;
  messageHistory: unknown[];
}

export type TAgentDraftActorSnapshot = {
  state: TActorState;
  context: TActorData;
};

export type TAgentDraftActorNotReadyReason =
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'actor-functions-missing'
  | 'session-missing'
  | 'actor-not-running';

export type TAgentDraftActorResult =
  | { ready: true; actorId: string; snapshot: TAgentDraftActorSnapshot }
  | { ready: false; reason: TAgentDraftActorNotReadyReason; message: string };

export type TAgentDraftActorSendResult =
  | { ready: true; messageId: string; snapshot: TAgentDraftActorSnapshot }
  | { ready: false; reason: TAgentDraftActorNotReadyReason; message: string };

export type TAgentDraftActorStopResult = {
  stopped: boolean;
};

export type TAgentPreviewSourceResult =
  | { ready: true; manifest: TVibecanvasJson; sources: Record<string, string> }
  | { ready: false; reason: TAgentDraftActorNotReadyReason; message: string };

export type TAgentDraftManifestReadResult =
  | { ready: true; source: 'file' | 'actor-candidate'; manifest: TVibecanvasJson }
  | { ready: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid'; message: string };

export type TAgentDraftManifestPatch = {
  name?: string;
  description?: string;
  initialData?: unknown;
  dataSchema?: unknown;
  tool?: {
    label?: string;
    icon?: TVibecanvasToolIcon | null;
    group?: string | null;
    priority?: number | null;
  };
};

export type TAgentDraftManifestPatchResult =
  | { ok: true; manifest: TVibecanvasJson }
  | { ok: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid' | 'edit-invalid'; message: string; issues?: string[] };

export type TAgentWizzardPublishResult =
  | { published: true; manifest: TVibecanvasJson; destination: string; files: string[] }
  | { published: false; manifest: TVibecanvasJson | null; destination: null; message: string; errors?: string[]; warnings?: string[] };

export type TAgentSettings = z.infer<typeof ZAgentSettings>
export type TAgentLoginStatus = z.infer<typeof ZAgentLoginStatus>

export const agentContract = oc.router({
  settings: {
    get: oc
      .output(ZAgentSettings),
  },
  wizzard: {
    connect: oc.input(ZAgentWizzardScope).output(orpcType<TAgentWizzardConnect>()),
    prompt: oc.input(ZAgentWizzardPrompt),
    cancel: oc.input(ZAgentWizzardScope).output(ZAgentWizzardCancel),
    newSession: oc.input(ZAgentWizzardScope),
    previewSource: oc.input(ZAgentWizzardScope).output(orpcType<TAgentPreviewSourceResult>()),
    publish: oc.input(ZAgentWizzardScope).output(orpcType<TAgentWizzardPublishResult>()),
    draftManifest: {
      read: oc.input(ZAgentWizzardScope).output(orpcType<TAgentDraftManifestReadResult>()),
      patch: oc.input(ZAgentWizzardDraftManifestPatch).output(orpcType<TAgentDraftManifestPatchResult>()),
    },
    draftActor: {
      start: oc.input(ZAgentWizzardScope).output(orpcType<TAgentDraftActorResult>()),
      reload: oc.input(ZAgentWizzardScope).output(orpcType<TAgentDraftActorResult>()),
      reset: oc.input(ZAgentWizzardScope).output(orpcType<TAgentDraftActorResult>()),
      stop: oc.input(ZAgentWizzardScope).output(orpcType<TAgentDraftActorStopResult>()),
      inspect: oc.input(ZAgentWizzardScope).output(orpcType<TAgentDraftActorResult>()),
      send: oc.input(ZAgentWizzardDraftActorSend).output(orpcType<TAgentDraftActorSendResult>()),
    },
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
