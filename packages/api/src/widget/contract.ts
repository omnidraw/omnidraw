import { eventIterator, oc, type as orpcType } from '@orpc/contract';
import type {
  TWidgetStateChangeResult,
  TWidgetStateGetResult,
  TWidgetStateJson,
  TWidgetStateSubscriptionEvent,
} from '@vibecanvas/service-widget-state';
import {
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetCapsuleAllowedApis,
  ZWidgetCapsuleBudgetRequest,
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetManifestV3,
} from '@vibecanvas/widget-contract';
import { z } from 'zod';
import type {
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsulePublicSigningKey,
} from './types';

const IDENTIFIER_MAX_LENGTH = 200;
const ARTIFACT_MAX_BYTES = 16 * 1_024 * 1_024;
const ARTIFACT_MAX_BASE64_LENGTH = Math.ceil(ARTIFACT_MAX_BYTES / 3) * 4;
const CAPSULE_SIGNING_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,169}$/;
const RAW_ED25519_PUBLIC_KEY_BASE64_PATTERN =
  /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const ZIdentifier = z.string().min(1).max(IDENTIFIER_MAX_LENGTH);
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

export const ZWidgetRuntimeIdentity = z.object({
  canvasId: ZIdentifier,
  elementId: ZIdentifier,
  widgetInstanceId: ZIdentifier,
  definitionId: ZIdentifier,
  revisionId: ZIdentifier,
}).strict();

export const ZWidgetRuntimeLoadInput = ZWidgetRuntimeIdentity;
export const ZWidgetStateJson = z.custom<TWidgetStateJson>();

export const ZWidgetBrowserManifest = ZWidgetManifestV3.transform((manifest) => {
  const { server: _server, ...browserManifest } = manifest;
  return browserManifest;
});

export const ZWidgetRuntimeLoadOutput = z.object({
  identity: ZWidgetRuntimeIdentity,
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

const widgetContract = oc.router({
  runtime: oc.router({
    config: oc.output(ZWidgetCapsuleHostConfiguration),
    load: oc.input(ZWidgetRuntimeLoadInput).output(ZWidgetRuntimeLoadOutput),
    state: oc.router({
      get: oc
        .input(ZWidgetRuntimeIdentity)
        .output(orpcType<TWidgetStateGetResult>()),
      change: oc
        .input(ZWidgetRuntimeIdentity.extend({
          expectedVersion: z.number().int().positive(),
          state: ZWidgetStateJson,
        }))
        .output(orpcType<TWidgetStateChangeResult>()),
      events: oc
        .input(ZWidgetRuntimeIdentity.extend({
          afterVersion: z.number().int().nonnegative().optional(),
        }))
        .route({ method: 'GET' })
        .output(eventIterator(orpcType<TWidgetStateSubscriptionEvent>())),
    }),
  }),
});

export { widgetContract };
