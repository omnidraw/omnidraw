import type {
  TWidgetDraftSummary,
  TWidgetPreviewOwnerDescriptor,
  TWidgetPreviewResult,
  TWidgetPreviewRuntimeDiagnosticRecord,
  TWidgetPublishResult,
} from '@vibecanvas/service-agent/widget-drafts/types';
import {
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetDiagnostic,
  ZWidgetManifestV3,
  type TWidgetPreviewMountLeaseDescriptor,
} from '@vibecanvas/widget-contract';
import { z } from 'zod';

const WIDGET_ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;
const WIDGET_ARTIFACT_MAX_BASE64_LENGTH = Math.ceil(WIDGET_ARTIFACT_MAX_BYTES / 3) * 4;
const DIAGNOSTIC_MAX_COUNT = 256;
const DIAGNOSTIC_MAX_LENGTH = 4_096;
const OWNER_LIST_MAX_COUNT = 10_000;
const OWNER_IDENTIFIER_MAX_LENGTH = 300;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const REVISION_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const DIAGNOSTIC_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function decodedBase64ByteLength(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const ZAgentOpaqueId = z.string().uuid();
export const ZAgentRevisionDigest = z.string().regex(REVISION_DIGEST_PATTERN);
const ZAgentPreviewOwnerBoundedIdentifier = z.string()
  .min(1)
  .max(OWNER_IDENTIFIER_MAX_LENGTH)
  .refine((value) => value.trim() === value, 'Preview owner identifiers cannot contain outer whitespace.');

export const ZAgentWidgetPreviewOwnerEnsureInput = z.object({
  previewId: ZAgentOpaqueId,
  canvasId: ZAgentPreviewOwnerBoundedIdentifier,
  frameNodeId: ZAgentPreviewOwnerBoundedIdentifier,
  draftId: ZAgentOpaqueId,
  originChatId: ZAgentOpaqueId,
  role: z.enum(['companion', 'placed']),
}).strict();

export const ZAgentWidgetPreviewOwnerRef = z.object({
  previewId: ZAgentOpaqueId,
  canvasId: ZAgentPreviewOwnerBoundedIdentifier,
  frameNodeId: ZAgentPreviewOwnerBoundedIdentifier,
}).strict();

export const ZAgentWidgetPreviewOwnerListInput = z.object({
  canvasId: ZAgentPreviewOwnerBoundedIdentifier,
  draftId: ZAgentOpaqueId.optional(),
  includeClosed: z.boolean().optional(),
}).strict();

export const ZAgentWidgetPreviewOwnerCloseInput = ZAgentWidgetPreviewOwnerRef;

export const ZAgentWidgetPreviewMountLeaseInput =
  ZAgentWidgetPreviewOwnerRef.extend({
    previewRevisionId: ZAgentPreviewOwnerBoundedIdentifier,
    leaseId: ZAgentOpaqueId,
  }).strict();

export const ZAgentWidgetPreviewMountLeaseDescriptor:
  z.ZodType<TWidgetPreviewMountLeaseDescriptor> =
    ZAgentWidgetPreviewMountLeaseInput.extend({
      acquiredAtMs: z.number().int().nonnegative(),
      renewedAtMs: z.number().int().nonnegative(),
      expiresAtMs: z.number().int().positive(),
    }).strict();

export const ZAgentWidgetPreviewDiagnosticReportInput =
  ZAgentWidgetPreviewOwnerRef.extend({
    draftId: ZAgentOpaqueId,
    originChatId: ZAgentOpaqueId,
    diagnostic: ZWidgetDiagnostic,
  }).strict();

export const ZAgentWidgetPreviewDiagnosticReportResult = z.object({
  accepted: z.literal(true),
  deduplicated: z.boolean(),
}).strict();

export const ZAgentWidgetPreviewRuntimeDiagnosticRecord:
  z.ZodType<TWidgetPreviewRuntimeDiagnosticRecord> = z.object({
    diagnostic: ZWidgetDiagnostic,
    status: z.literal('awaiting-retest'),
    reportedAtMs: z.number().int().nonnegative(),
  }).strict();

export const ZAgentWidgetPreviewRuntimeDiagnosticRecords =
  z.array(ZAgentWidgetPreviewRuntimeDiagnosticRecord).max(DIAGNOSTIC_MAX_COUNT);

export const ZAgentWidgetPreviewDiagnosticSelectionInput =
  ZAgentWidgetPreviewOwnerRef.extend({
    previewRevisionId: ZAgentPreviewOwnerBoundedIdentifier,
    fingerprint: z.string().regex(DIAGNOSTIC_FINGERPRINT_PATTERN),
  }).strict();

export const ZAgentWidgetPreviewDiagnosticRetestInput =
  ZAgentWidgetPreviewDiagnosticSelectionInput.extend({
    operation: ZAgentPreviewOwnerBoundedIdentifier,
  }).strict();

export const ZAgentWidgetPreviewBuildInput = z.object({
  draftId: ZAgentOpaqueId,
  previewId: ZAgentOpaqueId.optional(),
  canvasId: ZAgentPreviewOwnerBoundedIdentifier.optional(),
  frameNodeId: ZAgentPreviewOwnerBoundedIdentifier.optional(),
}).strict().superRefine((input, context) => {
  const ownerFieldCount = [
    input.previewId,
    input.canvasId,
    input.frameNodeId,
  ].filter((value) => value !== undefined).length;
  if (ownerFieldCount !== 0 && ownerFieldCount !== 3) {
    context.addIssue({
      code: 'custom',
      message: 'Preview build owner identity must include previewId, canvasId, and frameNodeId.',
    });
  }
});

export const ZAgentWidgetPreviewCancelInput =
  ZAgentWidgetPreviewOwnerRef.extend({
    buildId: ZAgentPreviewOwnerBoundedIdentifier,
    expectedBuildSequence: z.number().int().nonnegative(),
  }).strict();

export const ZAgentWidgetPublishInput = z.object({
  idempotencyKey: z.string().min(1).max(200).regex(/^[A-Za-z0-9._~:+-]+$/),
  draftId: ZAgentOpaqueId,
  expectedRevision: ZAgentRevisionDigest,
  previewId: ZAgentOpaqueId,
  previewRevisionId: ZAgentPreviewOwnerBoundedIdentifier,
  canvasId: ZAgentPreviewOwnerBoundedIdentifier,
  frameNodeId: ZAgentPreviewOwnerBoundedIdentifier,
  expectedBindingRevision: z.number().int().nonnegative(),
  expectedBindingPlanDigestSha256: ZAgentRevisionDigest,
}).strict();

export const ZAgentWidgetPreviewOwnerDescriptor: z.ZodType<TWidgetPreviewOwnerDescriptor> =
  z.object({
    orgId: z.string().min(1).max(OWNER_IDENTIFIER_MAX_LENGTH),
    id: ZAgentOpaqueId,
    accountId: z.string().min(1).max(OWNER_IDENTIFIER_MAX_LENGTH),
    canvasId: ZAgentPreviewOwnerBoundedIdentifier,
    frameNodeId: ZAgentPreviewOwnerBoundedIdentifier,
    draftId: ZAgentOpaqueId,
    originChatId: ZAgentOpaqueId,
    role: z.enum(['companion', 'placed']),
    status: z.enum(['queued', 'building', 'ready', 'failed', 'closed']),
    activeRevisionId: ZAgentPreviewOwnerBoundedIdentifier.nullable(),
    pendingBuildId: ZAgentPreviewOwnerBoundedIdentifier.nullable(),
    buildSequence: z.number().int().nonnegative(),
    bindingRevision: z.number().int().nonnegative(),
    bindingPlanDigestSha256: ZAgentRevisionDigest.nullable(),
    sourceDigestSha256: ZAgentRevisionDigest.nullable(),
    committedMutationId: z.string().min(1).max(1_024).nullable(),
    runtimeDiagnostics: ZAgentWidgetPreviewRuntimeDiagnosticRecords,
    publishedPreviewRevisionId: ZAgentPreviewOwnerBoundedIdentifier.nullable(),
    publishedBindingRevision: z.number().int().nonnegative().nullable(),
    publishedBindingPlanDigestSha256: ZAgentRevisionDigest.nullable(),
    publishedWidgetRevisionId: ZAgentPreviewOwnerBoundedIdentifier.nullable(),
    publishedIdempotencyKey:
      z.string().min(1).max(200).regex(/^[A-Za-z0-9._~:+-]+$/).nullable(),
    lastError: z.record(z.string(), z.unknown()).nullable(),
    createdAtMs: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().nonnegative(),
    closedAtMs: z.number().int().nonnegative().nullable(),
  }).strict().superRefine((owner, context) => {
    if (
      (owner.sourceDigestSha256 === null)
      !== (owner.committedMutationId === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Preview source digest and committed mutation fence must be present together.',
      });
    }
    const publicationMarkerFields = [
      owner.publishedPreviewRevisionId,
      owner.publishedBindingRevision,
      owner.publishedBindingPlanDigestSha256,
      owner.publishedWidgetRevisionId,
      owner.publishedIdempotencyKey,
    ];
    const populatedMarkerFields = publicationMarkerFields
      .filter((value) => value !== null).length;
    if (
      populatedMarkerFields !== 0
      && populatedMarkerFields !== publicationMarkerFields.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Preview publication marker fields must be absent or complete.',
      });
    }
  });

export const ZAgentWidgetPreviewOwnerDescriptors:
  z.ZodType<readonly TWidgetPreviewOwnerDescriptor[]> =
    z.array(ZAgentWidgetPreviewOwnerDescriptor).max(OWNER_LIST_MAX_COUNT);

const ZDiagnostic = z.string().max(DIAGNOSTIC_MAX_LENGTH);
const ZDiagnostics = z.array(ZDiagnostic).max(DIAGNOSTIC_MAX_COUNT);
const ZSignedWidgetCapsuleRuntimeDescriptor = ZWidgetCapsuleRuntimeDescriptor.refine(
  (descriptor) => descriptor.signatureKeyIds.length > 0,
  'Widget UI artifact must contain at least one trusted Capsule signature.',
);

const ZWidgetDraftValidation = z.object({
  status: z.enum(['unknown', 'valid', 'invalid']),
  errors: ZDiagnostics,
  warnings: ZDiagnostics,
  validatedRevision: ZAgentRevisionDigest.optional(),
}).strict();

const ZWidgetDraftSummaryShape = z.object({
  draftId: ZAgentOpaqueId,
  definitionId: ZAgentOpaqueId,
  chatId: ZAgentOpaqueId,
  name: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  state: z.enum(['new', 'modified', 'published']),
  revision: ZAgentRevisionDigest,
  committedMutationId: z.string().min(1).max(1_024).nullable(),
  buildSequence: z.number().int().nonnegative(),
  publishedRevisionId: ZAgentOpaqueId.nullable(),
  updatedAt: z.string().min(1).max(100),
  validation: ZWidgetDraftValidation,
  previewAvailable: z.boolean(),
  publishReady: z.boolean(),
}).strict();

export const ZAgentWidgetDraftSummary: z.ZodType<TWidgetDraftSummary> =
  ZWidgetDraftSummaryShape;
export const ZAgentWidgetDraftSummaries: z.ZodType<TWidgetDraftSummary[]> =
  z.array(ZAgentWidgetDraftSummary).max(10_000);

const ZWidgetPreviewUiArtifact = z.object({
  digestSha256: ZAgentRevisionDigest,
  byteSize: z.number().int().min(1).max(WIDGET_ARTIFACT_MAX_BYTES),
  bytesBase64: z.string()
    .max(WIDGET_ARTIFACT_MAX_BASE64_LENGTH)
    .regex(BASE64_PATTERN),
  runtimeDescriptor: ZSignedWidgetCapsuleRuntimeDescriptor,
}).strict().superRefine((artifact, context) => {
  const decodedBytes = decodedBase64ByteLength(artifact.bytesBase64);
  if (decodedBytes > WIDGET_ARTIFACT_MAX_BYTES) {
    context.addIssue({
      code: 'custom',
      message: 'Preview UI artifact exceeds the decoded byte limit.',
      path: ['bytesBase64'],
    });
  }
  if (decodedBytes !== artifact.byteSize) {
    context.addIssue({
      code: 'custom',
      message: 'Preview UI artifact byte size does not match its encoded bytes.',
      path: ['byteSize'],
    });
  }
});

const ZWidgetPreviewReady = z.object({
  ready: z.literal(true),
  draftId: ZAgentOpaqueId,
  definitionId: ZAgentOpaqueId,
  previewId: ZAgentOpaqueId.nullable(),
  previewRevisionId: ZAgentPreviewOwnerBoundedIdentifier.nullable(),
  buildSequence: z.number().int().nonnegative().nullable(),
  bindingRevision: z.number().int().nonnegative().nullable(),
  bindingPlanDigestSha256: ZAgentRevisionDigest.nullable(),
  name: z.string().min(1).max(200),
  revision: ZAgentRevisionDigest,
  committedMutationId: z.string().min(1).max(1_024),
  manifest: ZWidgetManifestV3,
  uiArtifact: ZWidgetPreviewUiArtifact,
  contract: z.object({
    digestSha256: ZAgentRevisionDigest,
    functions: ZWidgetBrowserFunctionDescriptors,
    browserFunctionDescriptorsDigestSha256: ZAgentRevisionDigest,
  }).strict(),
  diagnostics: z.array(ZWidgetDiagnostic).max(DIAGNOSTIC_MAX_COUNT),
}).strict();

const ZWidgetPreviewFailure = z.object({
  ready: z.literal(false),
  draftId: ZAgentOpaqueId,
  revision: ZAgentRevisionDigest.optional(),
  reason: z.enum([
    'not-found',
    'validation-failed',
    'manifest-invalid',
    'artifact-unavailable',
    'build-failed',
  ]),
  message: z.string().min(1).max(DIAGNOSTIC_MAX_LENGTH),
  diagnostics: ZDiagnostics,
}).strict();

export const ZAgentWidgetPreviewResult: z.ZodType<TWidgetPreviewResult> =
  z.discriminatedUnion('ready', [ZWidgetPreviewReady, ZWidgetPreviewFailure]);

const ZWidgetPublishSuccess = z.object({
  published: z.literal(true),
  draftId: ZAgentOpaqueId,
  definitionId: ZAgentOpaqueId,
  revision: ZAgentRevisionDigest,
  publishedRevisionId: ZAgentOpaqueId,
  manifest: ZWidgetManifestV3,
  uiRuntime: ZSignedWidgetCapsuleRuntimeDescriptor,
}).strict();

const ZWidgetPublishFailure = z.object({
  published: z.literal(false),
  draftId: ZAgentOpaqueId,
  reason: z.enum([
    'not-found',
    'stale-revision',
    'validation-failed',
    'resource-binding-invalid',
    'publication-conflict',
    'publication-failed',
  ]),
  message: z.string().min(1).max(DIAGNOSTIC_MAX_LENGTH),
  currentRevision: ZAgentRevisionDigest.optional(),
  errors: ZDiagnostics,
  warnings: ZDiagnostics,
}).strict();

export const ZAgentWidgetPublishResult: z.ZodType<TWidgetPublishResult> =
  z.discriminatedUnion('published', [ZWidgetPublishSuccess, ZWidgetPublishFailure]);
