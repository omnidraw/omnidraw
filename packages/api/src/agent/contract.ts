import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import { ZOmnidrawToolIcon, type TWidgetManifestV3 } from '@omnidraw/widget-contract';
import type { TAgentEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
import type {
  TWidgetDraftSummary,
  TWidgetPreviewResult,
} from '@omnidraw/service-agent/widget-drafts/types';
import type { TWidgetCatalog, TWidgetCatalogGroup, TWidgetDeleteResult, TWidgetDetail, TWidgetDraftMetadataPatchResult, TWidgetFileEntry, TWidgetFilePreview, TWidgetPlacementResolveResult, TWidgetVariantSummary } from '@omnidraw/service-agent/widget-management/types';
import { z } from 'zod';
import {
  ZAgentOpaqueId,
  ZAgentRevisionDigest,
  ZAgentWidgetDraftSummaries,
  ZAgentWidgetDraftSummary,
  ZAgentWidgetPreviewOwnerCloseInput,
  ZAgentWidgetPreviewOwnerDescriptor,
  ZAgentWidgetPreviewOwnerDescriptors,
  ZAgentWidgetPreviewBuildInput,
  ZAgentWidgetPreviewCancelInput,
  ZAgentWidgetPreviewDiagnosticReportInput,
  ZAgentWidgetPreviewDiagnosticReportResult,
  ZAgentWidgetPreviewDiagnosticRetestInput,
  ZAgentWidgetPreviewDiagnosticSelectionInput,
  ZAgentWidgetPreviewRuntimeDiagnosticRecords,
  ZAgentWidgetPreviewTestReportInput,
  ZAgentWidgetPreviewTestReportResult,
  ZAgentWidgetPreviewMountLeaseDescriptor,
  ZAgentWidgetPreviewMountLeaseInput,
  ZAgentWidgetPreviewOwnerEnsureInput,
  ZAgentWidgetPreviewOwnerListInput,
  ZAgentWidgetPreviewOwnerRef,
  ZAgentWidgetPreviewResult,
  ZAgentWidgetPublishInput,
  ZAgentWidgetPublishResult,
} from './authoring-schema';

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
const ZAgentChatConnectInput = ZAgentChatScope.extend({ mode: z.enum(['reuse', 'replace']).optional() })
const ZWidgetName = z.string().min(1).max(120).refine((value) => value.trim() === value && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0'), 'Unsafe widget name')
const ZAgentWidgetDraftRef = z.object({ draftId: ZAgentOpaqueId }).strict()
const ZAgentWidgetDraftRevisionRef = ZAgentWidgetDraftRef.extend({
  expectedRevision: ZAgentRevisionDigest,
})
const ZWidgetSource = z.enum(['published', 'draft'])
const ZWidgetVariantRef = z.object({ name: ZWidgetName, source: ZWidgetSource })
const ZWidgetPlacementRef = z.object({
  source: z.enum(['published', 'draft']),
  name: ZWidgetName,
  revision: z.string().min(1).max(256),
})
const ZWidgetGroup = z.object({ name: z.string().trim().min(1).max(120), icon: ZOmnidrawToolIcon.nullable() })
const ZWidgetDraftToolPatch = z.object({
  icon: ZOmnidrawToolIcon.nullable().optional(),
  group: z.string().trim().min(1).max(120).nullable().optional(),
}).strict().refine((patch) => Object.prototype.hasOwnProperty.call(patch, 'icon') || Object.prototype.hasOwnProperty.call(patch, 'group'), 'At least one tool field is required')
const ZWidgetDraftMetadataPatch = z.object({
  name: ZWidgetName.optional(),
  description: z.string().max(4_000).optional(),
  tool: z.object({
    label: z.string().min(1).max(120).optional(),
    icon: ZOmnidrawToolIcon.nullable().optional(),
    group: z.string().trim().min(1).max(120).nullable().optional(),
    priority: z.number().finite().nullable().optional(),
  }).strict().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'At least one metadata field is required')
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
  policyMode: z.enum(['always-approve', 'ai-review', 'manual']),
  decisionSource: z.enum(['policy', 'reviewer', 'user']).optional(),
  reviewerReason: z.string().max(500).optional(),
})

export type { TAgentEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
export type {
  TWidgetDraftSummary,
  TWidgetPreviewResult,
} from '@omnidraw/service-agent/widget-drafts/types';
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
} from '@omnidraw/service-agent/widget-management/types';
export type { TWidgetFrameBounds, TWidgetPlacementRef } from '@omnidraw/widget-contract';

export type TAgentChatConnect = {
  vcJson: TWidgetManifestV3 | null;
  messageHistory: unknown[];
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
      })).output(z.object({
        resolved: z.literal(true),
        decision: z.enum(['approve', 'reject']),
        decisionSource: z.literal('user'),
      })),
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
        build: oc.input(ZAgentWidgetPreviewBuildInput).output(ZAgentWidgetPreviewResult),
        cancel: oc.input(ZAgentWidgetPreviewCancelInput).output(z.boolean()),
        mount: {
          acquire: oc
            .input(ZAgentWidgetPreviewMountLeaseInput)
            .output(ZAgentWidgetPreviewMountLeaseDescriptor.nullable()),
          renew: oc
            .input(ZAgentWidgetPreviewMountLeaseInput)
            .output(ZAgentWidgetPreviewMountLeaseDescriptor.nullable()),
          release: oc
            .input(ZAgentWidgetPreviewMountLeaseInput)
            .output(z.boolean()),
        },
        diagnostics: {
          report: oc
            .input(ZAgentWidgetPreviewDiagnosticReportInput)
            .output(ZAgentWidgetPreviewDiagnosticReportResult),
          get: oc
            .input(ZAgentWidgetPreviewOwnerRef)
            .output(ZAgentWidgetPreviewRuntimeDiagnosticRecords),
          retest: oc
            .input(ZAgentWidgetPreviewDiagnosticRetestInput)
            .output(ZAgentWidgetPreviewOwnerDescriptor),
          resolve: oc
            .input(ZAgentWidgetPreviewDiagnosticSelectionInput)
            .output(ZAgentWidgetPreviewOwnerDescriptor),
        },
        test: {
          report: oc
            .input(ZAgentWidgetPreviewTestReportInput)
            .output(ZAgentWidgetPreviewTestReportResult),
        },
    owner: {
      ensure: oc
        .input(ZAgentWidgetPreviewOwnerEnsureInput)
        .output(ZAgentWidgetPreviewOwnerDescriptor),
      get: oc
        .input(ZAgentWidgetPreviewOwnerRef)
        .output(ZAgentWidgetPreviewOwnerDescriptor.nullable()),
      list: oc
        .input(ZAgentWidgetPreviewOwnerListInput)
        .output(ZAgentWidgetPreviewOwnerDescriptors),
      close: oc
        .input(ZAgentWidgetPreviewOwnerCloseInput)
        .output(z.boolean()),
    },
  },
  widgetPublish: {
    publish: oc.input(ZAgentWidgetPublishInput).output(ZAgentWidgetPublishResult),
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
      expectedDraftId: ZAgentOpaqueId.optional(),
    }).superRefine((input, context) => {
      if (input.reference.source !== 'published' && input.expectedDraftId === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['expectedDraftId'],
          message: 'Draft placement requires an exact durable draft owner.',
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
