import type {
  TWidgetDraftSummary,
  TWidgetPreviewCloseResult,
  TWidgetPreviewFunctionInvocationView,
  TWidgetPreviewResult,
  TWidgetPublishResult,
} from '@vibecanvas/service-agent/widget-drafts/types';
import {
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetManifestV2,
} from '@vibecanvas/widget-contract';
import { z } from 'zod';
import { ZFunctionJson } from '../function/contract';

const WIDGET_ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;
const WIDGET_ARTIFACT_MAX_BASE64_LENGTH = Math.ceil(WIDGET_ARTIFACT_MAX_BYTES / 3) * 4;
const DIAGNOSTIC_MAX_COUNT = 256;
const DIAGNOSTIC_MAX_LENGTH = 4_096;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const FUNCTION_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REVISION_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function decodedBase64ByteLength(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const ZAgentOpaqueId = z.string().uuid();
export const ZAgentRevisionDigest = z.string().regex(REVISION_DIGEST_PATTERN);
export const ZAgentPreviewOwnerId = z.string().uuid().regex(LOWERCASE_UUID_PATTERN);
export const ZAgentFunctionName = z.string().regex(FUNCTION_NAME_PATTERN);
export const ZAgentIdempotencyKey = z.string().min(1).max(200);

const ZDiagnostic = z.string().max(DIAGNOSTIC_MAX_LENGTH);
const ZDiagnostics = z.array(ZDiagnostic).max(DIAGNOSTIC_MAX_COUNT);

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
  name: z.string().min(1).max(200),
  previewId: ZAgentPreviewOwnerId,
  previewRevisionId: ZAgentOpaqueId,
  revision: ZAgentRevisionDigest,
  currentRevision: ZAgentRevisionDigest,
  stale: z.boolean(),
  manifest: ZWidgetManifestV2,
  uiArtifact: ZWidgetPreviewUiArtifact,
  contract: z.object({
    digestSha256: ZAgentRevisionDigest,
    functions: ZWidgetBrowserFunctionDescriptors,
  }).strict(),
  diagnostics: ZDiagnostics,
  expiresAtMs: z.number().int().nonnegative(),
}).strict();

const ZWidgetPreviewFailure = z.object({
  ready: z.literal(false),
  draftId: ZAgentOpaqueId,
  revision: ZAgentRevisionDigest.optional(),
  currentRevision: ZAgentRevisionDigest.optional(),
  previewId: ZAgentPreviewOwnerId.optional(),
  previewRevisionId: ZAgentOpaqueId.optional(),
  reason: z.enum([
    'not-found',
    'not-built',
    'stale-revision',
    'validation-failed',
    'manifest-invalid',
    'resource-binding-invalid',
    'preview-conflict',
    'artifact-unavailable',
    'build-failed',
  ]),
  message: z.string().min(1).max(DIAGNOSTIC_MAX_LENGTH),
  diagnostics: ZDiagnostics,
}).strict();

export const ZAgentWidgetPreviewResult: z.ZodType<TWidgetPreviewResult> =
  z.discriminatedUnion('ready', [ZWidgetPreviewReady, ZWidgetPreviewFailure]);

export const ZAgentWidgetPreviewCloseResult: z.ZodType<TWidgetPreviewCloseResult> =
  z.object({
    closed: z.boolean(),
    draftId: ZAgentOpaqueId,
    previewId: ZAgentPreviewOwnerId,
    previewRevisionId: ZAgentOpaqueId,
  }).strict();

const ZWidgetPreviewFunctionFailure = z.object({
  owner: z.enum(['user', 'platform', 'cancelled']),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(DIAGNOSTIC_MAX_LENGTH),
  retryable: z.boolean(),
}).strict();

export const ZAgentWidgetPreviewFunctionInvocationView:
z.ZodType<TWidgetPreviewFunctionInvocationView> = z.object({
  id: ZAgentOpaqueId,
  functionName: ZAgentFunctionName,
  previewId: ZAgentPreviewOwnerId,
  previewRevisionId: ZAgentOpaqueId,
  status: z.enum([
    'queued',
    'claimed',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'timed_out',
  ]),
  output: ZFunctionJson.nullable(),
  failure: ZWidgetPreviewFunctionFailure.nullable(),
  createdAtMs: z.number().int().nonnegative(),
  startedAtMs: z.number().int().nonnegative().nullable(),
  finishedAtMs: z.number().int().nonnegative().nullable(),
}).strict();

const ZWidgetPublishSuccess = z.object({
  published: z.literal(true),
  draftId: ZAgentOpaqueId,
  definitionId: ZAgentOpaqueId,
  revision: ZAgentRevisionDigest,
  publishedRevisionId: ZAgentOpaqueId,
  manifest: ZWidgetManifestV2,
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
