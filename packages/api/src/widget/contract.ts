import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import { ZDirectFunctionResult } from '../function/contract';
import type {
  TWidgetStateChangeResult,
  TWidgetStateGetResult,
  TWidgetStateJson,
  TWidgetStateSubscriptionEvent,
} from '@omnidraw/service-widget-state';
import {
  WIDGET_FRAME_MAX_HEIGHT,
  WIDGET_FRAME_MAX_WIDTH,
  WIDGET_FRAME_MIN_HEIGHT,
  WIDGET_FRAME_MIN_WIDTH,
  ZOmnidrawToolIcon,
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetCapsuleAllowedApis,
  ZWidgetCapsuleBudgetRequest,
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetManifestV4,
  ZWidgetResourceRequirement,
} from '@omnidraw/widget-contract';
import {
  WIDGET_DESCRIPTION_MAX_CHARACTERS,
  WIDGET_NAME_MAX_CHARACTERS,
  WIDGET_TOOL_GROUP_MAX_BYTES,
  WIDGET_TOOL_LABEL_MAX_CHARACTERS,
} from '@omnidraw/widget-contract/CONSTANTS';
import { z } from 'zod';
import type {
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsulePublicSigningKey,
} from './types';
import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogEntry,
  TWidgetPublicCatalogForm,
  TWidgetPublicFileList,
  TWidgetPublicFilePreview,
  TWidgetPublicIssue,
  TWidgetPublicMutationResult,
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
const ZWidgetResourceBinding = z.object({
  resourceId: ZIdentifier,
  allowRead: z.boolean(),
  allowWrite: z.boolean(),
}).strict().refine(
  (binding) => binding.allowRead || binding.allowWrite,
  'A widget resource binding must grant read or write access.',
);
const ZWidgetResourceBindings = z.record(
  z.string().min(1).max(200).regex(/^[A-Za-z][A-Za-z0-9._-]{0,199}$/),
  ZWidgetResourceBinding,
).refine((bindings) => Object.keys(bindings).length <= 128, {
  message: 'A widget may bind at most 128 resource slots.',
});
const ZSignedWidgetCapsuleRuntimeDescriptor = ZWidgetCapsuleRuntimeDescriptor.refine(
  (descriptor) => descriptor.signatureKeyIds.length > 0,
  'Runtime artifact must contain at least one trusted Capsule signature.',
);
export const ZWidgetCapsulePublicSigningKey: z.ZodType<
  TWidgetCapsulePublicSigningKey
> = z.object({
  keyId: z.string().regex(CAPSULE_SIGNING_KEY_ID_PATTERN),
  algorithm: z.literal('Ed25519'),
  format: z.literal('raw'),
  publicKeyBase64: z.string().regex(RAW_ED25519_PUBLIC_KEY_BASE64_PATTERN),
}).strict();

export const ZWidgetCapsuleHostConfiguration: z.ZodType<
  TWidgetCapsuleHostConfiguration
> = z.object({
  generation: z.string().regex(/^[0-9a-f]{64}$/),
  allowedApis: ZWidgetCapsuleAllowedApis,
  limits: ZWidgetCapsuleBudgetRequest,
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
export const ZWidgetStateJson = z.custom<TWidgetStateJson>();

export const ZWidgetBrowserManifest = ZWidgetManifestV4.transform((manifest) => {
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
  functionDescriptors: ZWidgetBrowserFunctionDescriptors,
  browserFunctionDescriptorsDigestSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const ZWidgetPreviewSessionIdentity = z.object({
  canvasId: ZIdentifier,
  elementId: ZIdentifier,
  widgetKey: ZWidgetKey,
}).strict();

export const ZWidgetPreviewSelectedResource = z.object({
  slot: z.string().min(1).max(128),
  resourceId: ZIdentifier,
  effect: z.enum(['read', 'read_write']),
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
  functionDescriptors: ZWidgetBrowserFunctionDescriptors,
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
  $schema: z.literal('https://omnidraw.dev/schemas/widget/v4.json'),
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
  functions: ZWidgetBrowserFunctionDescriptors,
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

const widgetContract = oc.router({
  catalog: oc.router({
    get: oc.output(ZWidgetPublicCatalog),
    refresh: oc.input(z.object({}).strict()).output(ZWidgetPublicCatalog),
    files: oc.router({
      list: oc.input(z.object({
        widgetKey: ZWidgetKey,
        source: ZWidgetSource,
      }).strict()).output(ZWidgetPublicFileList),
      read: oc.input(z.object({
        widgetKey: ZWidgetKey,
        source: ZWidgetSource,
        path: ZWidgetFilePath,
      }).strict()).output(ZWidgetPublicFilePreview),
    }),
    events: oc.input(z.object({
      afterGeneration: z.number().int().nonnegative().optional(),
    }).strict())
      .route({ method: 'GET' })
      .output(eventIterator(z.object({
        previousGeneration: z.number().int().positive().nullable(),
        generation: z.number().int().positive(),
        fullResync: z.boolean(),
        changedWidgetKeys: z.array(ZWidgetKey).max(4_096),
      }).strict())),
  }),
  config: oc.router({
    saveDraft: oc.input(z.object({
      widgetKey: ZWidgetKey,
      expectedManifestDigestSha256: ZSha256,
      config: ZWidgetDraftConfig,
    }).strict()).output(ZWidgetPublicMutationResult),
  }),
  publication: oc.router({
    publishMetadata: oc.input(z.object({
      widgetKey: ZWidgetKey,
      expectedManifestDigestSha256: ZSha256,
      expectedCatalogDigestSha256: ZSha256,
    }).strict()).output(ZWidgetPublicMutationResult),
    buildAndPublish: oc.input(z.object({
      widgetKey: ZWidgetKey,
      expectedManifestDigestSha256: ZSha256,
      expectedCatalogDigestSha256: ZSha256,
    }).strict()).output(ZWidgetPublicMutationResult),
  }),
  placement: oc.router({
    resolve: oc.input(z.object({
      reference: ZWidgetPublishedPlacementReference,
      resourceBindings: ZWidgetResourceBindings.optional(),
    }).strict()).output(z.object({
      kind: z.literal('published'),
      reference: ZWidgetPublishedPlacementReference,
      widgetKey: ZWidgetKey,
      catalogGeneration: z.number().int().positive(),
      bounds: z.object({
        width: z.number().int().min(WIDGET_FRAME_MIN_WIDTH).max(WIDGET_FRAME_MAX_WIDTH),
        height: z.number().int().min(WIDGET_FRAME_MIN_HEIGHT).max(WIDGET_FRAME_MAX_HEIGHT),
      }).strict(),
      resourceBindings: ZWidgetResourceBindings,
    }).strict()),
  }),
  preview: oc.router({
    open: oc.input(ZWidgetPreviewSessionIdentity.extend({
      selectedResources: z.array(ZWidgetPreviewSelectedResource).max(64).optional(),
    }).strict()).output(ZWidgetPreviewMount),
    load: oc.input(ZWidgetPreviewSessionIdentity).output(ZWidgetPreviewMount),
    close: oc.input(z.object({
      canvasId: ZIdentifier,
      elementId: ZIdentifier,
    }).strict()).output(z.object({ closed: z.boolean() }).strict()),
    invoke: oc.input(ZWidgetPreviewInvokeInput).output(ZDirectFunctionResult),
  }),
  runtime: oc.router({
    config: oc.output(ZWidgetCapsuleHostConfiguration),
    load: oc.input(ZWidgetRuntimeLoadInput).output(ZWidgetRuntimeLoadOutput),
    state: oc.router({
      get: oc
        .input(ZWidgetStateIdentity)
        .output(orpcType<TWidgetStateGetResult>()),
      change: oc
        .input(ZWidgetStateIdentity.extend({
          expectedVersion: z.number().int().positive(),
          state: ZWidgetStateJson,
        }))
        .output(orpcType<TWidgetStateChangeResult>()),
      events: oc
        .input(ZWidgetStateIdentity.extend({
          afterVersion: z.number().int().nonnegative().optional(),
        }))
        .route({ method: 'GET' })
        .output(eventIterator(orpcType<TWidgetStateSubscriptionEvent>())),
    }),
  }),
});

export { widgetContract };
