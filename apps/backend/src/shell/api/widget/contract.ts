import { eventIterator, pc } from '../procedure';
import { ZDirectFunctionResult } from '../function/contract';
import type {
  TWidgetStateChangeResult,
  TWidgetStateGetResult,
  TWidgetStateJson,
  TWidgetStateSubscriptionEvent,
} from '#backend/shell/widget-state';
import { fnAssertWidgetStateJson } from '#backend/core/widget-state';
import {
  WIDGET_FRAME_MAX_HEIGHT,
  WIDGET_FRAME_MAX_WIDTH,
  WIDGET_FRAME_MIN_HEIGHT,
  WIDGET_FRAME_MIN_WIDTH,
  ZOmnidrawToolIcon as OmnidrawToolIconValidator,
  ZWidgetServerFunctionDescriptors as WidgetServerFunctionDescriptorsValidator,
  ZWidgetRuntimeAllowedApis as WidgetRuntimeAllowedApisValidator,
  ZWidgetRuntimeBudgetRequest as WidgetRuntimeBudgetRequestValidator,
  ZWidgetRuntimeDescriptor as WidgetRuntimeDescriptorValidator,
  ZWidgetManifestV1 as WidgetManifestV1Validator,
  ZWidgetResourceRequirement as WidgetResourceRequirementValidator,
} from '@omnidraw/sdk/contract';
import {
  WIDGET_DESCRIPTION_MAX_CHARACTERS,
  WIDGET_NAME_MAX_CHARACTERS,
  WIDGET_TOOL_GROUP_MAX_BYTES,
  WIDGET_TOOL_LABEL_MAX_CHARACTERS,
} from '@omnidraw/sdk/contract';
import { z } from 'zod';
import { sdkSchema } from '../sdk-schema';
import type {
  TWidgetHostConfiguration,
  TWidgetPublicSigningKey,
} from './types';
import type { TWidgetPreviewInspectResult } from '#backend/shell/agent';
import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogEntry,
  TWidgetPublicCatalogForm,
  TWidgetPublicFileList,
  TWidgetPublicFilePreview,
  TWidgetPublicIssue,
  TWidgetPublicMutationResult,
  TWidgetPublicDeletionPlan,
  TWidgetPublicDeletionResult,
} from './public-types';

const IDENTIFIER_MAX_LENGTH = 200;
const ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;
const ARTIFACT_MAX_BASE64_LENGTH = Math.ceil(ARTIFACT_MAX_BYTES / 3) * 4;
const CAPSULE_SIGNING_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,169}$/;
const RAW_ED25519_PUBLIC_KEY_BASE64_PATTERN =
  /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const ZIdentifier = z.string().min(1).max(IDENTIFIER_MAX_LENGTH);
const ZWidgetKey = z.string().min(1).max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ZSha256 = z.string().regex(/^[0-9a-f]{64}$/);
const ZWidgetSource = z.enum(['draft', 'published']);
const ZWidgetOperationToken = z.string().min(1).max(96).regex(/^[A-Za-z0-9_-]+$/);
const ZOmnidrawToolIcon = sdkSchema(OmnidrawToolIconValidator);
const ZWidgetServerFunctionDescriptors = sdkSchema(WidgetServerFunctionDescriptorsValidator);
const ZWidgetRuntimeAllowedApis = sdkSchema(WidgetRuntimeAllowedApisValidator);
const ZWidgetRuntimeBudgetRequest = sdkSchema(WidgetRuntimeBudgetRequestValidator);
const ZWidgetRuntimeDescriptor = sdkSchema(WidgetRuntimeDescriptorValidator);
const ZWidgetManifestV1 = sdkSchema(WidgetManifestV1Validator);
const ZWidgetResourceRequirement = sdkSchema(WidgetResourceRequirementValidator);
const ZWidgetFilePath = z.string().min(1).max(512).refine((value) => (
  !value.startsWith('/')
  && !value.includes('\\')
  && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
), 'Expected a safe relative widget file path');
const ZWidgetDraftConfig = z.object({
  name: z.string().trim().min(1).max(WIDGET_NAME_MAX_CHARACTERS),
  description: z.string().trim().min(1).max(WIDGET_DESCRIPTION_MAX_CHARACTERS),
  tool: z.object({
    label: z.string().trim().min(1).max(WIDGET_TOOL_LABEL_MAX_CHARACTERS),
    icon: ZOmnidrawToolIcon.nullable(),
    group: z.union([
      z.string().min(1).max(WIDGET_TOOL_GROUP_MAX_BYTES)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      z.null(),
    ]),
    priority: z.number().int().min(-1_000).max(1_000),
  }).strict(),
}).strict();
const ZWidgetPublishedPlacementReference = z.object({
  source: z.literal('published'),
  widgetKey: ZWidgetKey,
  catalogGeneration: z.number().int().positive(),
}).strict();
const ZSignedWidgetCapsuleRuntimeDescriptor = ZWidgetRuntimeDescriptor.refine(
  (descriptor) => descriptor.signatureKeyIds.length > 0,
  'Runtime artifact must contain at least one trusted Capsule signature.',
);
export const ZWidgetCapsulePublicSigningKey: z.ZodType<
  TWidgetPublicSigningKey
> = z.object({
  keyId: z.string().regex(CAPSULE_SIGNING_KEY_ID_PATTERN),
  algorithm: z.literal('Ed25519'),
  format: z.literal('raw'),
  publicKeyBase64: z.string().regex(RAW_ED25519_PUBLIC_KEY_BASE64_PATTERN),
}).strict();

export const ZWidgetCapsuleHostConfiguration: z.ZodType<
  TWidgetHostConfiguration
> = z.object({
  generation: z.string().regex(/^[0-9a-f]{64}$/),
  allowedApis: ZWidgetRuntimeAllowedApis,
  limits: ZWidgetRuntimeBudgetRequest,
  previewSigningKeyId: z.string().regex(CAPSULE_SIGNING_KEY_ID_PATTERN),
  releaseSigningKeyId: z.string().regex(CAPSULE_SIGNING_KEY_ID_PATTERN),
  signingKeys: z.array(ZWidgetCapsulePublicSigningKey).min(2).max(32),
}).strict().superRefine((configuration, context) => {
  const keyIds = new Set<string>();
  const publicKeys = new Set<string>();
  configuration.signingKeys.forEach((key, index) => {
    if (keyIds.has(key.keyId)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate Capsule signing key ID: ${key.keyId}`,
        path: ['signingKeys', index, 'keyId'],
      });
    }
    if (publicKeys.has(key.publicKeyBase64)) {
      context.addIssue({
        code: 'custom',
        message: 'Capsule signing public keys must be unique.',
        path: ['signingKeys', index, 'publicKeyBase64'],
      });
    }
    keyIds.add(key.keyId);
    publicKeys.add(key.publicKeyBase64);
  });

  if (configuration.previewSigningKeyId === configuration.releaseSigningKeyId) {
    context.addIssue({
      code: 'custom',
      message: 'Preview and release Capsule signing key IDs must be distinct.',
      path: ['releaseSigningKeyId'],
    });
  }
  for (const field of [
    'previewSigningKeyId',
    'releaseSigningKeyId',
  ] as const) {
    if (!keyIds.has(configuration[field])) {
      context.addIssue({
        code: 'custom',
        message: `Required Capsule signing key is missing: ${configuration[field]}`,
        path: [field],
      });
    }
  }

});

function decodedBase64ByteLength(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const ZWidgetStateIdentity = z.object({
  canvasId: ZIdentifier,
  elementId: ZIdentifier,
  widgetInstanceId: ZIdentifier,
}).strict();

export const ZWidgetRuntimeIdentity = ZWidgetStateIdentity.extend({
  widgetKey: ZWidgetKey,
}).strict();

export const ZWidgetRuntimeLoadInput = ZWidgetRuntimeIdentity;
export const ZWidgetStateJson = z.custom<TWidgetStateJson>((value) => {
  try {
    fnAssertWidgetStateJson(value);
    return true;
  } catch {
    return false;
  }
}, 'Expected bounded widget-state JSON.');

const ZWidgetStateSnapshot = z.object({
  identity: ZWidgetStateIdentity,
  version: z.number().int().positive(),
  state: ZWidgetStateJson,
}).strict();

const ZWidgetStateGetResult: z.ZodType<TWidgetStateGetResult> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('found'), snapshot: ZWidgetStateSnapshot }).strict(),
  z.object({ status: z.literal('unavailable') }).strict(),
]);

const ZWidgetStateChangeResult: z.ZodType<TWidgetStateChangeResult> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('changed'), snapshot: ZWidgetStateSnapshot }).strict(),
  z.object({ status: z.literal('conflict'), snapshot: ZWidgetStateSnapshot }).strict(),
  z.object({
    status: z.literal('rate-limited'),
    retryAfterMs: z.number().int().nonnegative(),
  }).strict(),
  z.object({ status: z.literal('unavailable') }).strict(),
]);

const ZWidgetStateSubscriptionEvent: z.ZodType<TWidgetStateSubscriptionEvent> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('changed'), snapshot: ZWidgetStateSnapshot }).strict(),
  z.object({
    type: z.literal('snapshot'),
    reason: z.enum(['initial', 'resync']),
    snapshot: ZWidgetStateSnapshot,
  }).strict(),
]);

export const ZWidgetBrowserManifest = ZWidgetManifestV1.transform((manifest) => {
  const { server: _server, ...browserManifest } = manifest;
  return browserManifest;
});

export const ZWidgetRuntimeLoadOutput = z.object({
  identity: ZWidgetRuntimeIdentity.extend({
    catalogGeneration: z.number().int().positive(),
  }).strict(),
  manifest: ZWidgetBrowserManifest,
  artifact: z.object({
    digestSha256: z.string().regex(/^[0-9a-f]{64}$/),
    byteSize: z.number().int().min(1).max(ARTIFACT_MAX_BYTES),
    bytesBase64: z.string().max(ARTIFACT_MAX_BASE64_LENGTH).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).strict().superRefine((artifact, context) => {
    if (decodedBase64ByteLength(artifact.bytesBase64) !== artifact.byteSize) {
      context.addIssue({
        code: 'custom',
        message: 'Widget UI artifact byte size does not match its exact encoded bytes.',
        path: ['byteSize'],
      });
    }
  }),
  runtimeDescriptor: ZSignedWidgetCapsuleRuntimeDescriptor,
  functionDescriptors: ZWidgetServerFunctionDescriptors,
  browserFunctionDescriptorsDigestSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const ZWidgetPreviewSessionIdentity = z.object({
  canvasId: ZIdentifier,
  elementId: ZIdentifier,
  widgetKey: ZWidgetKey,
}).strict();

export const ZWidgetPreviewDiagnostic = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1).max(4_096),
  code: z.string().min(1).max(100).nullable(),
  path: z.string().min(1).max(512).nullable(),
}).strict();

export const ZWidgetPreviewMount = z.object({
  canvasId: ZIdentifier,
  elementId: ZIdentifier,
  widgetKey: ZWidgetKey,
  manifest: ZWidgetBrowserManifest,
  artifact: ZWidgetRuntimeLoadOutput.shape.artifact,
  runtimeDescriptor: ZSignedWidgetCapsuleRuntimeDescriptor,
  functionDescriptors: ZWidgetServerFunctionDescriptors,
  browserFunctionDescriptorsDigestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  constructionReused: z.boolean(),
  diagnostics: z.array(ZWidgetPreviewDiagnostic).max(1_024),
}).strict();

export const ZWidgetPreviewInvokeInput = z.object({
  canvasId: ZIdentifier,
  elementId: ZIdentifier,
  functionName: z.string().min(1).max(129).regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  input: z.unknown().refine((value) => {
    try {
      return (JSON.stringify(value)?.length ?? 0) <= 1_048_576;
    } catch {
      return false;
    }
  }, 'Function input must be JSON-compatible and no larger than 1 MiB.'),
}).strict();

const ZWidgetPublicIssue: z.ZodType<TWidgetPublicIssue> = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
}).strict();
const ZWidgetPublicConfig = z.object({
  $schema: z.literal('https://omnidraw.dev/schemas/widget/v1.json'),
  name: z.string().trim().min(1).max(WIDGET_NAME_MAX_CHARACTERS),
  description: z.string().trim().min(1).max(WIDGET_DESCRIPTION_MAX_CHARACTERS),
  tool: z.object({
    label: z.string().trim().min(1).max(WIDGET_TOOL_LABEL_MAX_CHARACTERS),
    icon: ZOmnidrawToolIcon.nullable(),
    group: z.union([
      z.string().min(1).max(WIDGET_TOOL_GROUP_MAX_BYTES)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      z.null(),
    ]),
    priority: z.number().int().min(-1_000).max(1_000),
  }).strict(),
}).strict();
const ZWidgetPublicCatalogForm: z.ZodType<TWidgetPublicCatalogForm> = z.object({
  source: ZWidgetSource,
  health: z.enum(['healthy', 'unhealthy']),
  manifestDigestSha256: ZSha256.nullable(),
  config: ZWidgetPublicConfig.nullable(),
  resources: z.array(ZWidgetResourceRequirement).max(64),
  functions: ZWidgetServerFunctionDescriptors,
  fileCount: z.number().int().min(0).max(20_000),
  issues: z.array(ZWidgetPublicIssue).max(256),
}).strict();
const ZWidgetPublicDifferences = z.object({
  availability: z.enum(['draft-only', 'published-only', 'draft-and-published']),
  manifest: z.enum(['same', 'different', 'unavailable']),
  presentation: z.enum(['same', 'different', 'unavailable']),
  executableManifest: z.enum(['same', 'different', 'unavailable']),
  status: z.enum([
    'draft-only',
    'published-only',
    'matched',
    'presentation-changed',
    'executable-changed',
    'unavailable',
  ]),
}).strict();
const ZWidgetPublicPlacement = z.object({
  reference: ZWidgetPublishedPlacementReference,
  bounds: z.object({
    width: z.number().int().min(WIDGET_FRAME_MIN_WIDTH).max(WIDGET_FRAME_MAX_WIDTH),
    height: z.number().int().min(WIDGET_FRAME_MIN_HEIGHT).max(WIDGET_FRAME_MAX_HEIGHT),
  }).strict(),
}).strict();
const ZWidgetPublicCatalogEntry: z.ZodType<TWidgetPublicCatalogEntry> = z.object({
  widgetKey: ZWidgetKey,
  health: z.enum(['healthy', 'degraded', 'unhealthy']),
  placeable: z.boolean(),
  differences: ZWidgetPublicDifferences,
  draft: ZWidgetPublicCatalogForm.nullable(),
  published: ZWidgetPublicCatalogForm.nullable(),
  placement: ZWidgetPublicPlacement.nullable(),
}).strict();
export const ZWidgetPublicCatalog: z.ZodType<TWidgetPublicCatalog> = z.object({
  format: z.literal('omnidraw.widget-catalog.public.v1'),
  generation: z.number().int().positive(),
  catalogDigestSha256: ZSha256,
  healthy: z.boolean(),
  groups: z.array(z.string().min(1).max(WIDGET_TOOL_GROUP_MAX_BYTES)).max(2_048),
  entries: z.array(ZWidgetPublicCatalogEntry).max(2_048),
  issues: z.array(ZWidgetPublicIssue).max(2_048),
}).strict();
const ZWidgetPublicMutationResult: z.ZodType<TWidgetPublicMutationResult> = z.object({
  widgetKey: ZWidgetKey,
  generation: z.number().int().positive(),
  catalogDigestSha256: ZSha256,
}).strict();
const ZWidgetPublicDeletionPlan: z.ZodType<TWidgetPublicDeletionPlan> = z.object({
  planToken: ZWidgetOperationToken,
  widgetKey: ZWidgetKey,
  source: ZWidgetSource,
  catalogDigestSha256: ZSha256,
  pairedDraftPresent: z.boolean(),
  placementCount: z.number().int().nonnegative().max(20_000),
  previewPlacementCount: z.number().int().nonnegative().max(20_000),
  publishedPlacementCount: z.number().int().nonnegative().max(20_000),
  chatMountCount: z.number().int().nonnegative().max(20_000),
  resourcesPreserved: z.literal(true),
}).strict();
const ZWidgetPublicDeletionResult: z.ZodType<TWidgetPublicDeletionResult> = z.object({
  status: z.literal('committed'),
  operationId: ZWidgetOperationToken,
  widgetKey: ZWidgetKey,
  source: ZWidgetSource,
  generation: z.number().int().positive(),
  catalogDigestSha256: ZSha256,
  removedPlacementCount: z.number().int().nonnegative().max(20_000),
  removedChatMountCount: z.number().int().nonnegative().max(20_000),
  resourcesPreserved: z.literal(true),
}).strict();
const ZWidgetPublicFileEntry = z.object({
  path: ZWidgetFilePath,
  kind: z.enum(['file', 'directory']),
  byteSize: z.number().int().min(0).max(256 * 1_024 * 1_024),
}).strict();
const ZWidgetPublicFileList: z.ZodType<TWidgetPublicFileList> = z.object({
  entries: z.array(ZWidgetPublicFileEntry).max(12_000),
  truncated: z.boolean(),
}).strict();
const ZWidgetPublicFilePreview: z.ZodType<TWidgetPublicFilePreview> = z.object({
  path: ZWidgetFilePath,
  byteSize: z.number().int().min(0).max(256 * 1_024 * 1_024),
  binary: z.boolean(),
  truncated: z.boolean(),
  text: z.string().max(256 * 1_024).nullable(),
}).strict();

const ZWidgetAuthoringDiagnostic = z.object({
  code: z.string().min(1).max(128).regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().max(2_000),
  path: z.string().max(512).nullable(),
}).strict();
const ZWidgetAuthoringResolvedDraft = z.object({
  catalogGeneration: z.number().int().positive(),
  catalogDigestSha256: ZSha256,
  widgetKey: ZWidgetKey,
  displayName: z.string().min(1).max(WIDGET_NAME_MAX_CHARACTERS),
  health: z.literal('healthy'),
  draftDigestSha256: ZSha256,
  draftPath: z.string().min(1).max(4_096),
}).strict();
const ZWidgetAuthoringValidation = z.object({
  ok: z.boolean(),
  widgetKey: ZWidgetKey,
  displayName: z.string().min(1).max(WIDGET_NAME_MAX_CHARACTERS),
  selectedCatalogGeneration: z.number().int().positive(),
  selectedCatalogDigestSha256: ZSha256,
  capturedDraftDigestSha256: ZSha256,
  executableInputDigestSha256: ZSha256.nullable(),
  acceptedGeneration: z.number().int().positive().nullable(),
  buildIdentity: ZSha256.nullable(),
  sourceValidation: z.object({
    status: z.enum(['passed', 'failed']),
    diagnostics: z.array(ZWidgetAuthoringDiagnostic).max(40),
    files: z.array(ZWidgetFilePath).max(100),
    filesTruncated: z.boolean(),
  }).strict(),
  acceptedArtifactBuild: z.object({
    status: z.enum(['passed', 'failed', 'not_run']),
    diagnostics: z.array(ZWidgetAuthoringDiagnostic).max(40),
  }).strict(),
  livePreviewRuntime: z.literal('not_exercised'),
  resources: z.literal('not_exercised'),
}).strict();
const ZWidgetInspectTarget = z.discriminatedUnion('by', [
  z.object({ by: z.literal('css'), selector: z.string().min(1).max(512) }).strict(),
  z.object({
    by: z.literal('role'),
    role: z.enum([
      'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'option',
      'radio', 'slider', 'spinbutton', 'switch', 'tab', 'textbox',
    ]),
    name: z.string().max(256).optional(),
    exact: z.boolean().optional(),
  }).strict(),
  z.object({
    by: z.literal('label'),
    text: z.string().min(1).max(256),
    exact: z.boolean().optional(),
  }).strict(),
]);
const ZWidgetInspectAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), target: ZWidgetInspectTarget }).strict(),
  z.object({
    type: z.literal('input'),
    target: ZWidgetInspectTarget,
    value: z.string().max(4_096),
    commit: z.enum(['none', 'blur', 'enter']).optional(),
  }).strict(),
  z.object({
    type: z.literal('waitFrames'),
    count: z.number().int().min(1).max(120),
  }).strict(),
  z.object({
    type: z.literal('assertText'),
    target: ZWidgetInspectTarget,
    text: z.string().min(1).max(512),
    exact: z.boolean().optional(),
  }).strict(),
]);
const ZWidgetAuthoringInspectInput = z.object({
  widgetKey: ZWidgetKey,
  expectedDraftDigestSha256: ZSha256,
  expectedAcceptedGeneration: z.number().int().positive(),
  expectedBuildIdentity: ZSha256,
  mode: z.enum(['artifact', 'preview']),
  canvasId: ZIdentifier.optional(),
  viewport: z.object({
    width: z.number().int().min(160).max(1_280).optional(),
    height: z.number().int().min(120).max(1_024).optional(),
    deviceScaleFactor: z.union([z.literal(1), z.literal(2)]).optional(),
  }).strict().optional(),
  settle: z.object({
    frames: z.number().int().min(1).max(8).optional(),
    timeoutMs: z.number().int().min(100).max(10_000).optional(),
  }).strict().optional(),
  actions: z.array(ZWidgetInspectAction).max(16).optional(),
  continueOnActionError: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(180_000).optional(),
  includeScreenshot: z.boolean(),
  operationId: ZWidgetOperationToken,
}).strict().superRefine((value, context) => {
  if (value.mode === 'artifact' && value.canvasId !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Canvas correlation is available only in preview mode.',
      path: ['canvasId'],
    });
  }
});
const ZBoundedWidgetInspectResult = z.custom<TWidgetPreviewInspectResult>((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('status' in value) || ![
    'completed',
    'completed_with_errors',
    'failed',
    'timed_out',
    'cancelled',
  ].includes(String(value.status))) {
    return false;
  }
  try {
    return (JSON.stringify(value)?.length ?? Number.POSITIVE_INFINITY) <= 2 * 1_024 * 1_024;
  } catch {
    return false;
  }
}, 'Expected one bounded, protocol-validated inspection result.');
const ZWidgetInspectionToolError = z.object({
  code: z.string().min(1).max(128).regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().max(2_000),
  retryable: z.boolean(),
  observedDraftDigestSha256: ZSha256.optional(),
  previewState: z.enum([
    'not_applicable', 'absent', 'mounting', 'ready', 'retired', 'ambiguous',
    'generation_mismatch', 'failed',
  ]).optional(),
  nextAction: z.enum([
    'none', 'repair_visible_preview', 'retry_after_settle', 'reopen_preview',
    'remove_duplicate_previews', 'retry_current_generation',
    'use_preview_mode_for_resources',
  ]).optional(),
  diagnostics: z.array(z.unknown()).max(20).optional(),
}).strict();
const ZWidgetAuthoringInspection = z.object({
  ok: z.boolean(),
  widgetKey: ZWidgetKey,
  draftDigestSha256: ZSha256,
  acceptedGeneration: z.number().int().positive(),
  buildIdentity: ZSha256,
  canvasCorrelation: z.object({
    canvas: z.enum(['not_selected', 'selected']),
    visibleFrame: z.literal('not_claimed'),
    durableInstanceState: z.enum(['not_selected', 'selected_not_exercised']),
  }).strict(),
  result: ZBoundedWidgetInspectResult.optional(),
  error: ZWidgetInspectionToolError.optional(),
  screenshotLease: z.object({
    url: z.string().url().max(512).refine((value) => {
      const url = new URL(value);
      return url.protocol === 'http:' && url.hostname === '127.0.0.1';
    }),
    expiresAtMs: z.number().int().positive(),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if ((value.result === undefined) === (value.error === undefined)) {
    context.addIssue({ code: 'custom', message: 'Inspection returns exactly one result or error.' });
  }
  if (value.screenshotLease !== undefined && value.result?.screenshot === undefined) {
    context.addIssue({ code: 'custom', message: 'Screenshot lease requires screenshot metadata.' });
  }
});

const widgetContract = pc.router({
  authoring: pc.router({
    resolve: pc.input(z.union([
      z.object({ widgetKey: ZWidgetKey }).strict(),
      z.object({ name: z.string().min(1).max(WIDGET_NAME_MAX_CHARACTERS) }).strict(),
    ])).output(ZWidgetAuthoringResolvedDraft),
    validate: pc.input(z.object({
      widgetKey: ZWidgetKey,
      expectedDraftDigestSha256: ZSha256.optional(),
    }).strict()).output(ZWidgetAuthoringValidation),
    inspect: pc.input(ZWidgetAuthoringInspectInput).output(ZWidgetAuthoringInspection),
  }),
  catalog: pc.router({
    get: pc.output(ZWidgetPublicCatalog),
    refresh: pc.input(z.object({}).strict()).output(ZWidgetPublicCatalog),
    files: pc.router({
      list: pc.input(z.object({
        widgetKey: ZWidgetKey,
        source: ZWidgetSource,
      }).strict()).output(ZWidgetPublicFileList),
      read: pc.input(z.object({
        widgetKey: ZWidgetKey,
        source: ZWidgetSource,
        path: ZWidgetFilePath,
      }).strict()).output(ZWidgetPublicFilePreview),
    }),
    events: pc.input(z.object({
      afterGeneration: z.number().int().nonnegative().optional(),
    }).strict())
      .route({ method: 'GET' })
      .output(eventIterator(z.object({
        previousGeneration: z.number().int().positive().nullable(),
        generation: z.number().int().positive(),
        fullResync: z.boolean(),
        changedWidgetKeys: z.array(ZWidgetKey).max(4_096),
        previewWidgetKeys: z.array(ZWidgetKey).max(4_096),
      }).strict())),
  }),
  config: pc.router({
    saveDraft: pc.input(z.object({
      widgetKey: ZWidgetKey,
      expectedManifestDigestSha256: ZSha256,
      config: ZWidgetDraftConfig,
    }).strict()).output(ZWidgetPublicMutationResult),
  }),
  deletion: pc.router({
    plan: pc.input(z.object({
      widgetKey: ZWidgetKey,
      source: ZWidgetSource,
    }).strict()).output(ZWidgetPublicDeletionPlan),
    commit: pc.input(z.object({
      planToken: ZWidgetOperationToken,
      operationId: ZWidgetOperationToken,
    }).strict()).output(ZWidgetPublicDeletionResult),
  }),
  publication: pc.router({
    publishMetadata: pc.input(z.object({
      widgetKey: ZWidgetKey,
      expectedManifestDigestSha256: ZSha256,
      expectedCatalogDigestSha256: ZSha256,
    }).strict()).output(ZWidgetPublicMutationResult),
    buildAndPublish: pc.input(z.object({
      widgetKey: ZWidgetKey,
      expectedManifestDigestSha256: ZSha256,
      expectedCatalogDigestSha256: ZSha256,
    }).strict()).output(ZWidgetPublicMutationResult),
  }),
  placement: pc.router({
    resolve: pc.input(z.object({
      reference: ZWidgetPublishedPlacementReference,
    }).strict()).output(z.object({
      kind: z.literal('published'),
      reference: ZWidgetPublishedPlacementReference,
      widgetKey: ZWidgetKey,
      catalogGeneration: z.number().int().positive(),
      bounds: z.object({
        width: z.number().int().min(WIDGET_FRAME_MIN_WIDTH).max(WIDGET_FRAME_MAX_WIDTH),
        height: z.number().int().min(WIDGET_FRAME_MIN_HEIGHT).max(WIDGET_FRAME_MAX_HEIGHT),
      }).strict(),
    }).strict()),
  }),
  preview: pc.router({
    open: pc.input(ZWidgetPreviewSessionIdentity).output(ZWidgetPreviewMount),
    rebuild: pc.input(ZWidgetPreviewSessionIdentity).output(ZWidgetPreviewMount),
    rebuildDraft: pc.input(z.object({
      widgetKey: ZWidgetKey,
    }).strict()).output(z.object({
      widgetKey: ZWidgetKey,
      acceptedGeneration: z.number().int().positive(),
      buildIdentity: ZSha256,
    }).strict()),
    load: pc.input(ZWidgetPreviewSessionIdentity).output(ZWidgetPreviewMount),
    close: pc.input(z.object({
      canvasId: ZIdentifier,
      elementId: ZIdentifier,
    }).strict()).output(z.object({ closed: z.boolean() }).strict()),
    invoke: pc.input(ZWidgetPreviewInvokeInput).output(ZDirectFunctionResult),
  }),
  runtime: pc.router({
    config: pc.output(ZWidgetCapsuleHostConfiguration),
    load: pc.input(ZWidgetRuntimeLoadInput).output(ZWidgetRuntimeLoadOutput),
    state: pc.router({
      get: pc
        .input(ZWidgetStateIdentity)
        .output(ZWidgetStateGetResult),
      change: pc
        .input(ZWidgetStateIdentity.extend({
          expectedVersion: z.number().int().positive(),
          state: ZWidgetStateJson,
        }))
        .output(ZWidgetStateChangeResult),
      events: pc
        .input(ZWidgetStateIdentity.extend({
          afterVersion: z.number().int().nonnegative().optional(),
        }))
        .route({ method: 'GET' })
        .output(eventIterator(ZWidgetStateSubscriptionEvent)),
    }),
  }),
});

export { widgetContract };
