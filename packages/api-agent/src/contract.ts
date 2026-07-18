import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import type { TVibecanvasToolIcon } from '@vibecanvas/service-actor/core/tool-icon';
import type { TActorData, TActorState, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZVibecanvasToolIcon } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { TAgentEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { TWidgetDraftSummary, TWidgetPreviewResult, TWidgetPreviewSendResult, TWidgetPublishResult } from '@vibecanvas/service-agent/widget-drafts/types';
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

const ZAgentChatCancel = z.object({
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

const ZAgentChatScope = z.object({ widgetId: z.string(), sessionId: z.string() })
const ZAgentWidgetDraftRef = z.object({ draftId: z.string().min(1).max(120) })
const ZAgentWidgetDraftRevisionRef = ZAgentWidgetDraftRef.extend({ expectedRevision: z.string().min(1).max(256) })
const ZAgentChatStartWidgetEdit = ZAgentChatScope.extend({
  definitionName: z.string().min(1),
})
const AGENT_CHAT_PROMPT_IMAGE_MAX_COUNT = 5;
const AGENT_CHAT_PROMPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const AGENT_CHAT_PROMPT_IMAGE_MAX_BASE64_LENGTH = Math.ceil(AGENT_CHAT_PROMPT_IMAGE_MAX_BYTES / 3) * 4;
const ZAgentChatPromptImage = z.object({
  name: z.string().max(255).optional(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  data: z.string()
    .min(1)
    .max(AGENT_CHAT_PROMPT_IMAGE_MAX_BASE64_LENGTH)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict()

const ZAgentChatPrompt = ZAgentChatScope.extend({
  text: z.string(),
  resourceIds: z.string().min(1).max(128).array().max(16).optional(),
  images: ZAgentChatPromptImage.array().max(AGENT_CHAT_PROMPT_IMAGE_MAX_COUNT).optional(),
  model: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
  }).optional(),
  thinkingLevel: ZThinkingLevel.optional(),
}).refine((input) => input.text.trim().length > 0 || (input.images?.length ?? 0) > 0, {
  message: 'Prompt text or at least one image is required',
  path: ['text'],
})

const ZAgentChatDbChangeProposal = z.object({
  id: z.string(),
  resourceId: z.string(),
  resourceName: z.string(),
  sql: z.string(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  proposedAt: z.string(),
  resolvedAt: z.string().optional(),
  draftId: z.string().optional(),
  applyId: z.string().optional(),
  warnings: z.string().array().optional(),
})

const ZAgentApproval = z.object({
  id: z.string(),
  chatId: z.string(),
  toolCallId: z.string(),
  kind: z.enum(['resource-create', 'resource-update', 'resource-delete', 'resource-data-write']),
  summary: z.string(),
  risk: z.enum(['medium', 'high']),
  warnings: z.string().array(),
  details: z.unknown(),
  createdAt: z.string(),
  expiresAt: z.string(),
})

const ZAgentChatDraftActorSend = ZAgentChatScope.extend({
  name: z.string().min(1),
  payload: z.unknown(),
})

const ZAgentChatDraftManifestPatch = ZAgentChatScope.extend({
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

export type TAgentChatConnect = {
  vcJson: TVibecanvasJson | null;
  messageHistory: unknown[];
  editSession: {
    mode: 'edit-published-widget';
    sourceDefinitionName: string;
    sourceSlug: string;
    sourceName: string;
    sourceManifestPath: string;
    previousVersion?: string;
    nextVersion: string;
    startedAt: string;
  } | null;
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
  | 'resource-binding-invalid'
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
  | { ready: true; source: 'file'; manifest: TVibecanvasJson }
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
  | { ok: true; source: 'file'; manifest: TVibecanvasJson }
  | { ok: false; reason: 'session-missing' | 'manifest-missing' | 'manifest-invalid' | 'edit-invalid'; message: string; issues?: string[] };

export type TAgentChatPublishResult =
  | { published: true; manifest: TVibecanvasJson; destination: string; files: string[] }
  | { published: false; manifest: TVibecanvasJson | null; destination: null; message: string; errors?: string[]; warnings?: string[] };

export type TAgentChatStartWidgetEditResult =
  | { ok: true; vcJson: TVibecanvasJson; editSession: NonNullable<TAgentChatConnect['editSession']>; messageHistory: unknown[] }
  | { ok: false; message: string };

export type TAgentSettings = z.infer<typeof ZAgentSettings>
export type TAgentLoginStatus = z.infer<typeof ZAgentLoginStatus>

export const agentContract = oc.router({
  settings: {
    get: oc
      .output(ZAgentSettings),
  },
  chat: {
    connect: oc.input(ZAgentChatScope).output(orpcType<TAgentChatConnect>()),
    startWidgetEdit: oc.input(ZAgentChatStartWidgetEdit).output(orpcType<TAgentChatStartWidgetEditResult>()),
    prompt: oc.input(ZAgentChatPrompt),
    resourceBindings: {
      clear: oc.input(ZAgentChatScope).output(z.object({ cleared: z.literal(true) })),
    },
    dbChange: {
      approve: oc.input(ZAgentChatScope.extend({
        proposalId: z.string().min(1),
        confirmedRisk: z.literal(true),
      })).output(ZAgentChatDbChangeProposal),
      reject: oc.input(ZAgentChatScope.extend({ proposalId: z.string().min(1) })).output(ZAgentChatDbChangeProposal),
    },
    approval: {
      list: oc.input(ZAgentChatScope).output(ZAgentApproval.array()),
      get: oc.input(ZAgentChatScope.extend({ approvalId: z.string().min(1) })).output(ZAgentApproval.nullable()),
      resolve: oc.input(ZAgentChatScope.extend({
        approvalId: z.string().min(1),
        decision: z.enum(['approve', 'reject']),
      })).output(z.object({ resolved: z.literal(true), decision: z.enum(['approve', 'reject']) })),
    },
    cancel: oc.input(ZAgentChatScope).output(ZAgentChatCancel),
    newSession: oc.input(ZAgentChatScope),
    previewSource: oc.input(ZAgentChatScope).output(orpcType<TAgentPreviewSourceResult>()),
    publish: oc.input(ZAgentChatScope).output(orpcType<TAgentChatPublishResult>()),
    draftManifest: {
      read: oc.input(ZAgentChatScope).output(orpcType<TAgentDraftManifestReadResult>()),
      patch: oc.input(ZAgentChatDraftManifestPatch).output(orpcType<TAgentDraftManifestPatchResult>()),
    },
    draftActor: {
      start: oc.input(ZAgentChatScope).output(orpcType<TAgentDraftActorResult>()),
      reload: oc.input(ZAgentChatScope).output(orpcType<TAgentDraftActorResult>()),
      reset: oc.input(ZAgentChatScope).output(orpcType<TAgentDraftActorResult>()),
      stop: oc.input(ZAgentChatScope).output(orpcType<TAgentDraftActorStopResult>()),
      inspect: oc.input(ZAgentChatScope).output(orpcType<TAgentDraftActorResult>()),
      send: oc.input(ZAgentChatDraftActorSend).output(orpcType<TAgentDraftActorSendResult>()),
    },
  },
  widgetDraft: {
    list: oc.input(z.object({})).output(orpcType<TWidgetDraftSummary[]>()),
    get: oc.input(ZAgentWidgetDraftRef).output(orpcType<TWidgetDraftSummary | null>()),
    validate: oc.input(ZAgentWidgetDraftRevisionRef).output(orpcType<TWidgetDraftSummary | null>()),
  },
  widgetPreview: {
    get: oc.input(ZAgentWidgetDraftRef).output(orpcType<TWidgetPreviewResult>()),
    build: oc.input(ZAgentWidgetDraftRevisionRef).output(orpcType<TWidgetPreviewResult>()),
    refresh: oc.input(ZAgentWidgetDraftRevisionRef).output(orpcType<TWidgetPreviewResult>()),
    reset: oc.input(ZAgentWidgetDraftRevisionRef).output(orpcType<TWidgetPreviewResult>()),
    send: oc.input(ZAgentWidgetDraftRevisionRef.extend({
      name: z.string().min(1).max(120),
      payload: z.unknown(),
    })).output(orpcType<TWidgetPreviewSendResult>()),
  },
  widgetPublish: {
    publish: oc.input(ZAgentWidgetDraftRevisionRef).output(orpcType<TWidgetPublishResult>()),
  },
  approval: {
    list: oc.input(ZAgentChatScope).output(ZAgentApproval.array()),
    get: oc.input(ZAgentChatScope.extend({ approvalId: z.string().min(1) })).output(ZAgentApproval.nullable()),
    resolve: oc.input(ZAgentChatScope.extend({
      approvalId: z.string().min(1),
      decision: z.enum(['approve', 'reject']),
    })).output(z.object({ resolved: z.literal(true), decision: z.enum(['approve', 'reject']) })),
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
