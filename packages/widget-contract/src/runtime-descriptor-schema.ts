/** @file Strict browser-safe decoder for trusted Capsule runtime metadata. */

import { z } from 'zod';

import { fnNormalizeWidgetCapsuleRuntimeDescriptor } from './core/fn.capsule';
import {
  ZWidgetCapsuleBudgets,
  ZWidgetCapsuleCapabilityRequest,
  ZWidgetCapsuleChannelContract,
  ZWidgetCapsuleParkability,
  ZWidgetCapsuleTarget,
} from './manifest-schema';
import type { TWidgetCapsuleRuntimeDescriptor } from './types';
import type { TWidgetCapsuleHash } from './types';

const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SIGNATURE_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,199}$/;

export const ZWidgetCapsuleRuntimeDescriptor: z.ZodType<TWidgetCapsuleRuntimeDescriptor> =
  z.object({
    format: z.literal('vibecanvas.capsule-runtime.v1'),
    capsuleArtifactHash: z.string().regex(CAPSULE_HASH_PATTERN)
      .transform((value): TWidgetCapsuleHash => value as TWidgetCapsuleHash),
    target: ZWidgetCapsuleTarget,
    budgets: ZWidgetCapsuleBudgets,
    capabilityRequests: z.array(ZWidgetCapsuleCapabilityRequest).max(256)
      .superRefine((requests, context) => {
        const ids = new Set<string>();
        requests.forEach((request, index) => {
          if (ids.has(request.id)) {
            context.addIssue({
              code: 'custom',
              message: `Duplicate Capsule capability request: ${request.id}`,
              path: [index, 'id'],
            });
          }
          ids.add(request.id);
        });
      }),
    channels: ZWidgetCapsuleChannelContract.nullable(),
    parkability: ZWidgetCapsuleParkability,
    signatureKeyIds: z.array(
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
    }),
  }).strict().transform((descriptor) => (
    fnNormalizeWidgetCapsuleRuntimeDescriptor(descriptor)
  ));
