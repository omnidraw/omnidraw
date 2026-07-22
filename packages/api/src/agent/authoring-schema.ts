import type {
  TWidgetDraftSummary,
  TWidgetPreviewResult,
  TWidgetPublishResult,
} from '@vibecanvas/service-agent/widget-drafts/types';
import {
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetManifestV2,
} from '@vibecanvas/widget-contract';
import { z } from 'zod';

const WIDGET_ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;
const WIDGET_ARTIFACT_MAX_BASE64_LENGTH = Math.ceil(WIDGET_ARTIFACT_MAX_BYTES / 3) * 4;
const DIAGNOSTIC_MAX_COUNT = 256;
const DIAGNOSTIC_MAX_LENGTH = 4_096;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const REVISION_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function decodedBase64ByteLength(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const ZAgentOpaqueId = z.string().uuid();
export const ZAgentRevisionDigest = z.string().regex(REVISION_DIGEST_PATTERN);

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
  revision: ZAgentRevisionDigest,
  manifest: ZWidgetManifestV2,
  uiArtifact: ZWidgetPreviewUiArtifact,
  contract: z.object({
    digestSha256: ZAgentRevisionDigest,
    functions: ZWidgetBrowserFunctionDescriptors,
  }).strict(),
  diagnostics: ZDiagnostics,
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
