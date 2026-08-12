import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import type { TWidgetManifestV1 } from '@omnidraw/widget-contract';
import type { TAgentEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
import { z } from 'zod';

const ZThinkingLevel = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

const ZApprovalPolicy = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('always-approve') }).strict(),
  z.object({ mode: z.literal('manual') }).strict(),
  z.object({
    mode: z.literal('ai-review'),
    reviewerModel: z.object({
      provider: z.string().min(1).max(200),
      modelId: z.string().min(1).max(300),
    }).strict(),
  }).strict(),
]);

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
  }).array(),
  approvalPolicy: ZApprovalPolicy,
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
const ZCanvasId = z.string().min(1).max(200)
const ZAgentChatConnectInput = ZAgentChatScope.extend({
  canvasId: ZCanvasId,
  mode: z.enum(['reuse', 'replace']).optional(),
})
const ZWidgetKey = z.string().min(1).max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const ZWidgetSource = z.enum(['published', 'draft'])
const ZWidgetVariantRef = z.object({ name: ZWidgetKey, source: ZWidgetSource }).strict()
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
  canvasId: ZCanvasId,
  text: z.string(),
  widgetRefs: ZWidgetVariantRef.array().max(16).optional(),
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

const ZAgentChatEdit = ZAgentChatScope.extend({
  canvasId: ZCanvasId,
  entryId: z.string().min(1).max(200),
  text: z.string(),
  model: z.object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
  }).optional(),
  thinkingLevel: ZThinkingLevel.optional(),
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
  createdAtSec: z.string(),
  policyMode: z.enum(['always-approve', 'ai-review', 'manual']),
  decisionSource: z.enum(['policy', 'reviewer', 'user']).optional(),
  reviewerReason: z.string().max(500).optional(),
})

export type { TAgentEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';

export type TAgentChatHistoryItem = {
  entryId: string;
  message: unknown;
}

export type TAgentChatConnect = {
  vcJson: TWidgetManifestV1 | null;
  messageHistory: TAgentChatHistoryItem[];
}

export type TAgentSettings = z.infer<typeof ZAgentSettings>
export type TAgentLoginStatus = z.infer<typeof ZAgentLoginStatus>

export const agentContract = oc.router({
  settings: {
    get: oc
      .output(ZAgentSettings),
    approvalPolicy: {
      update: oc.input(ZApprovalPolicy).output(ZApprovalPolicy),
    },
  },
  chat: {
    connect: oc.input(ZAgentChatConnectInput).output(orpcType<TAgentChatConnect>()),
    history: oc.input(ZAgentChatScope).output(orpcType<TAgentChatHistoryItem[]>()),
    prompt: oc.input(ZAgentChatPrompt),
    edit: oc.input(ZAgentChatEdit).output(orpcType<TAgentChatHistoryItem[]>()),
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
      })).output(z.object({
        resolved: z.literal(true),
        decision: z.enum(['approve', 'reject']),
        decisionSource: z.literal('user'),
      })),
    },
    cancel: oc.input(ZAgentChatScope).output(ZAgentChatCancel),
    newSession: oc.input(ZAgentChatScope),
  },
  approval: {
    list: oc.input(ZAgentChatScope).output(ZAgentApproval.array()),
    get: oc.input(ZAgentChatScope.extend({ approvalId: z.string().min(1) })).output(ZAgentApproval.nullable()),
    resolve: oc.input(ZAgentChatScope.extend({
      approvalId: z.string().min(1),
      decision: z.enum(['approve', 'reject']),
    })).output(z.object({
      resolved: z.literal(true),
      decision: z.enum(['approve', 'reject']),
      decisionSource: z.literal('user'),
    })),
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
