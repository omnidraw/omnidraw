import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { ZVibecanvasToolIcon } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { TAgentEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type {
  TWidgetDraftSummary,
  TWidgetPreviewCloseResult,
  TWidgetPreviewFunctionInvocationView,
  TWidgetPreviewResult,
} from '@vibecanvas/service-agent/widget-drafts/types';
import type { TWidgetCatalog, TWidgetCatalogGroup, TWidgetDeleteResult, TWidgetDetail, TWidgetDraftMetadataPatchResult, TWidgetFileEntry, TWidgetFilePreview, TWidgetPlacementResolveResult, TWidgetVariantSummary } from '@vibecanvas/service-agent/widget-management/types';
import { z } from 'zod';
import { ZFunctionJson } from '../function/contract';
import {
  ZAgentFunctionName,
  ZAgentIdempotencyKey,
  ZAgentOpaqueId,
  ZAgentPreviewOwnerId,
  ZAgentRevisionDigest,
  ZAgentWidgetDraftSummaries,
  ZAgentWidgetDraftSummary,
  ZAgentWidgetPreviewCloseResult,
  ZAgentWidgetPreviewFunctionInvocationView,
  ZAgentWidgetPreviewResult,
  ZAgentWidgetPublishResult,
} from './authoring-schema';

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
const ZAgentChatConnectInput = ZAgentChatScope.extend({ mode: z.enum(['reuse', 'replace']).optional() })
const ZWidgetName = z.string().min(1).max(120).refine((value) => value.trim() === value && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0'), 'Unsafe widget name')
const ZAgentWidgetDraftRef = z.object({ draftId: ZAgentOpaqueId }).strict()
const ZAgentWidgetDraftRevisionRef = ZAgentWidgetDraftRef.extend({
  expectedRevision: ZAgentRevisionDigest,
})
const ZAgentWidgetPreviewRef = ZAgentWidgetDraftRef.extend({ previewId: ZAgentPreviewOwnerId })
const ZAgentWidgetPreviewBuild = ZAgentWidgetPreviewRef.extend({
  expectedDraftRevision: ZAgentRevisionDigest,
  expectedActivePreviewRevisionId: ZAgentOpaqueId.nullable(),
})
const ZAgentWidgetPreviewRevisionRef = ZAgentWidgetPreviewRef.extend({
  previewRevisionId: ZAgentOpaqueId,
})
const ZAgentWidgetPreviewInvocationRef = ZAgentWidgetPreviewRevisionRef.extend({
  invocationId: ZAgentOpaqueId,
})
const ZWidgetSource = z.enum(['published', 'draft'])
const ZWidgetVariantRef = z.object({ name: ZWidgetName, source: ZWidgetSource })
const ZWidgetPlacementRef = z.object({
  source: z.enum(['published', 'draft', 'preview']),
  name: ZWidgetName,
  revision: z.string().min(1).max(256),
})
const ZWidgetGroup = z.object({ name: z.string().trim().min(1).max(120), icon: ZVibecanvasToolIcon.nullable() })
const ZWidgetDraftToolPatch = z.object({
  icon: ZVibecanvasToolIcon.nullable().optional(),
  group: z.string().trim().min(1).max(120).nullable().optional(),
}).strict().refine((patch) => Object.prototype.hasOwnProperty.call(patch, 'icon') || Object.prototype.hasOwnProperty.call(patch, 'group'), 'At least one tool field is required')
const ZWidgetDraftMetadataPatch = z.object({
  name: ZWidgetName.optional(),
  description: z.string().max(4_000).optional(),
  tool: z.object({
    label: z.string().min(1).max(120).optional(),
    icon: ZVibecanvasToolIcon.nullable().optional(),
    group: z.string().trim().min(1).max(120).nullable().optional(),
    priority: z.number().finite().nullable().optional(),
  }).strict().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'At least one metadata field is required')
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

export type { TAgentEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
export type {
  TWidgetDraftSummary,
  TWidgetPreviewCloseResult,
  TWidgetPreviewFunctionInvocationView,
  TWidgetPreviewResult,
} from '@vibecanvas/service-agent/widget-drafts/types';
export type {
  TWidgetCatalog,
  TWidgetCatalogEntry,
  TWidgetCatalogGroup,
  TWidgetCatalogProblem,
  TWidgetDeleteResult,
  TWidgetDetail,
  TWidgetDraftMetadataPatch,
  TWidgetDraftMetadataPatchResult,
  TWidgetDraftToolPatch,
  TWidgetFileEntry,
  TWidgetFilePreview,
  TWidgetRelation,
  TWidgetSource,
  TWidgetVariantSummary,
  TWidgetPlacementResolveResult,
  TWidgetPlacementSummary,
  TWidgetCatalogPreviewSummary,
} from '@vibecanvas/service-agent/widget-management/types';
export type { TWidgetFrameBounds, TWidgetPlacementRef } from '@vibecanvas/service-actor/core/fn.widget-frame';

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
    connect: oc.input(ZAgentChatConnectInput).output(orpcType<TAgentChatConnect>()),
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
  },
  widgetDraft: {
    list: oc.input(z.object({}).strict()).output(ZAgentWidgetDraftSummaries),
    get: oc.input(ZAgentWidgetDraftRef).output(ZAgentWidgetDraftSummary.nullable()),
    validate: oc.input(ZAgentWidgetDraftRevisionRef).output(ZAgentWidgetDraftSummary.nullable()),
  },
  widgetPreview: {
    get: oc.input(ZAgentWidgetPreviewRef).output(ZAgentWidgetPreviewResult),
    build: oc.input(ZAgentWidgetPreviewBuild).output(ZAgentWidgetPreviewResult),
    close: oc.input(ZAgentWidgetPreviewRef.extend({
      expectedPreviewRevisionId: ZAgentOpaqueId,
    })).output(ZAgentWidgetPreviewCloseResult),
    invoke: oc.input(ZAgentWidgetPreviewRevisionRef.extend({
      functionName: ZAgentFunctionName,
      input: ZFunctionJson,
      idempotencyKey: ZAgentIdempotencyKey,
    })).output(ZAgentWidgetPreviewFunctionInvocationView),
    invocation: {
      get: oc.input(ZAgentWidgetPreviewInvocationRef)
        .output(ZAgentWidgetPreviewFunctionInvocationView.nullable()),
      cancel: oc.input(ZAgentWidgetPreviewInvocationRef)
        .output(ZAgentWidgetPreviewFunctionInvocationView.nullable()),
    },
  },
  widgetPublish: {
    publish: oc.input(ZAgentWidgetDraftRevisionRef).output(ZAgentWidgetPublishResult),
  },
  widgets: {
    catalog: oc.input(z.object({})).output(orpcType<TWidgetCatalog>()),
    detail: oc.input(ZWidgetVariantRef).output(orpcType<TWidgetDetail | null>()),
    files: oc.input(ZWidgetVariantRef).output(orpcType<TWidgetFileEntry[] | null>()),
    file: oc.input(ZWidgetVariantRef.extend({ path: z.string().min(1).max(1_000) })).output(orpcType<TWidgetFilePreview | null>()),
    ensureDraft: oc.input(z.object({
      name: ZWidgetName,
      expectedPublishedFingerprint: z.string().length(64).optional(),
    })).output(orpcType<TWidgetVariantSummary>()),
    patchDraftTool: oc.input(z.object({
      name: ZWidgetName,
      expectedRevision: z.string().min(1).max(256),
      patch: ZWidgetDraftToolPatch,
    })).output(orpcType<TWidgetVariantSummary>()),
    patchDraftMetadata: oc.input(z.object({
      name: ZWidgetName,
      expectedRevision: z.string().min(1).max(256),
      patch: ZWidgetDraftMetadataPatch,
    })).output(orpcType<TWidgetDraftMetadataPatchResult>()),
    delete: oc.input(ZWidgetVariantRef).output(orpcType<TWidgetDeleteResult>()),
    resolvePlacement: oc.input(z.object({
      reference: ZWidgetPlacementRef,
      previewId: z.string().min(1).max(256).optional(),
      expectedDraftId: ZAgentOpaqueId.optional(),
    }).superRefine((input, context) => {
      if (input.reference.source !== 'published' && input.expectedDraftId === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['expectedDraftId'],
          message: 'Draft and Preview placement require an exact durable draft owner.',
        });
      }
    })).output(orpcType<TWidgetPlacementResolveResult>()),
    groups: {
      create: oc.input(ZWidgetGroup).output(orpcType<TWidgetCatalogGroup>()),
      update: oc.input(z.object({ currentName: z.string().trim().min(1).max(120), group: ZWidgetGroup })).output(orpcType<TWidgetCatalogGroup>()),
      remove: oc.input(z.object({ name: z.string().trim().min(1).max(120) })).output(orpcType<TWidgetCatalogGroup>()),
    },
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
