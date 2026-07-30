/** @file Strict browser-safe decoder for trusted Capsule runtime metadata. */

import { z } from 'zod';

import { fnNormalizeWidgetCapsuleRuntimeDescriptor } from './core/fn.capsule';
import {
  ZWidgetCapsuleApis,
  ZWidgetCapsuleBudgetRequest,
  ZWidgetCapsuleBudgets,
  ZWidgetCapsuleCapabilityRequest,
  ZWidgetCapsuleChannelContract,
  ZWidgetCapsuleParkability,
  ZWidgetCapsuleTarget,
} from './manifest-schema';
import type {
  TWidgetCapsuleHash,
  TWidgetCapsuleRuntimeDescriptor,
} from './types';

const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SIGNATURE_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,199}$/;
const ZCapsuleHash = z.string().regex(CAPSULE_HASH_PATTERN)
  .transform((value): TWidgetCapsuleHash => value as TWidgetCapsuleHash);
const ZSignatureKeyIds = z.array(
  z.string().min(1).max(200).regex(SIGNATURE_KEY_ID_PATTERN),
).min(1).max(32).superRefine((keyIds, context) => {
  const seen = new Set<string>();
  keyIds.forEach((keyId, index) => {
    if (seen.has(keyId)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate Capsule signature key ID: ${keyId}`,
        path: [index],
      });
    }
    seen.add(keyId);
  });
});

export const ZWidgetCapsuleRuntimeDescriptor: z.ZodType<TWidgetCapsuleRuntimeDescriptor> =
  z.discriminatedUnion('format', [
    z.object({
      format: z.literal('vibecanvas.capsule-runtime.v2'),
      capsuleArtifactHash: ZCapsuleHash,
      apiContract: z.object({
        format: z.literal('capsule-api-groups-v1'),
        groups: ZWidgetCapsuleApis,
        bundleDigest: ZCapsuleHash,
      }).strict(),
      budgets: ZWidgetCapsuleBudgetRequest,
      capabilityRequests: z.array(ZWidgetCapsuleCapabilityRequest).max(256),
      channels: ZWidgetCapsuleChannelContract.nullable(),
      parkability: ZWidgetCapsuleParkability,
      signatureKeyIds: ZSignatureKeyIds,
    }).strict(),
    z.object({
      format: z.literal('vibecanvas.capsule-runtime.v1'),
      capsuleArtifactHash: ZCapsuleHash,
      target: ZWidgetCapsuleTarget,
      budgets: ZWidgetCapsuleBudgets,
      capabilityRequests: z.array(ZWidgetCapsuleCapabilityRequest).max(256),
      channels: ZWidgetCapsuleChannelContract.nullable(),
      parkability: ZWidgetCapsuleParkability,
      signatureKeyIds: ZSignatureKeyIds,
    }).strict(),
  ]).superRefine((descriptor, context) => {
    const ids = new Set<string>();
    descriptor.capabilityRequests.forEach((request, index) => {
      if (ids.has(request.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Capsule capability request: ${request.id}`,
          path: ['capabilityRequests', index, 'id'],
        });
      }
      ids.add(request.id);
    });
  }).transform((descriptor) => (
    fnNormalizeWidgetCapsuleRuntimeDescriptor(descriptor)
  ));
