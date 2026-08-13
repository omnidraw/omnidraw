import type {
  CapsuleCapabilityDescriptor,
  CapsuleCapabilityGrant,
  CapsuleCapabilityRequest,
  CapsuleSchemaReference,
} from '@omnidraw/capsule/protocol';
import type { TWidgetBrowserFunctionDescriptor } from '../../contracts/types';
import {
  OMNIDRAW_CAPSULE_CAPABILITY_VERSION,
  OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
  OMNIDRAW_COLLABORATIVE_STATE_CONTRACT_HASH,
} from './CONSTANTS';
import type { TOmnidrawCapsuleCapabilitySelector } from './types';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function fnOmnidrawServerFunctionCapabilityId(
  descriptorDigestSha256: string,
): string {
  if (!DIGEST_PATTERN.test(descriptorDigestSha256)) {
    throw new TypeError('Server-function descriptor digest must be lowercase SHA-256.');
  }
  return `omnidraw.widget.functions.h${descriptorDigestSha256}`;
}

export function fnOmnidrawServerFunctionCapabilitySelector(
  descriptorDigestSha256: string,
): TOmnidrawCapsuleCapabilitySelector {
  return Object.freeze({
    id: fnOmnidrawServerFunctionCapabilityId(descriptorDigestSha256),
    versionRange: OMNIDRAW_CAPSULE_CAPABILITY_VERSION,
    contractHash: `sha256:${descriptorDigestSha256}`,
  });
}

export function fnOmnidrawCollaborativeStateCapabilitySelector():
TOmnidrawCapsuleCapabilitySelector {
  return Object.freeze({
    id: OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
    versionRange: OMNIDRAW_CAPSULE_CAPABILITY_VERSION,
    contractHash: OMNIDRAW_COLLABORATIVE_STATE_CONTRACT_HASH,
  });
}

export function fnOmnidrawCapabilityRequest(
  selector: TOmnidrawCapsuleCapabilitySelector,
  operations: readonly string[],
): CapsuleCapabilityRequest {
  return Object.freeze({
    ...selector,
    required: true,
    operations: Object.freeze([...operations].sort()),
  });
}

export function fnOmnidrawCapabilityGrant(
  selector: TOmnidrawCapsuleCapabilitySelector,
  operations: readonly string[],
): CapsuleCapabilityGrant {
  return Object.freeze({
    id: selector.id,
    version: OMNIDRAW_CAPSULE_CAPABILITY_VERSION,
    contractHash: selector.contractHash,
    operations: Object.freeze([...operations].sort()),
  });
}

export function fnOmnidrawServerFunctionDescriptor(args: Readonly<{
  descriptorDigestSha256: string;
  functions: readonly Readonly<{
    function: TWidgetBrowserFunctionDescriptor;
    inputSchema: CapsuleSchemaReference;
    outputSchema: CapsuleSchemaReference;
  }>[];
}>): CapsuleCapabilityDescriptor {
  const selector = fnOmnidrawServerFunctionCapabilitySelector(
    args.descriptorDigestSha256,
  );
  return Object.freeze({
    id: selector.id,
    version: OMNIDRAW_CAPSULE_CAPABILITY_VERSION,
    contractHash: selector.contractHash,
    operations: Object.freeze(args.functions.map(({ function: item, inputSchema, outputSchema }) => (
      Object.freeze({
        name: item.exportName,
        kind: 'call' as const,
        inputSchema,
        outputSchema,
        idempotency: item.effect === 'fn'
          ? 'read-only' as const
          : 'non-idempotent' as const,
        limits: Object.freeze({
          maxBytes: Math.min(item.limits.outputByteLimit, 1_048_576),
          maxInFlight: 1,
          maxRatePerSecond: 32,
        }),
        lifecycle: Object.freeze({
          freeze: 'cancel' as const,
          park: 'dispose' as const,
          resume: 'reopen' as const,
          destroy: 'dispose' as const,
        }),
      })
    ))),
    errorCodes: Object.freeze([
      'function_aborted',
      'function_denied',
      'function_failed',
      'function_timeout',
    ]),
  });
}

export function fnOmnidrawCollaborativeStateDescriptor(args: Readonly<{
  nullSchema: CapsuleSchemaReference;
  changeSchema: CapsuleSchemaReference;
  snapshotSchema: CapsuleSchemaReference;
}>): CapsuleCapabilityDescriptor {
  return Object.freeze({
    id: OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
    version: OMNIDRAW_CAPSULE_CAPABILITY_VERSION,
    contractHash: OMNIDRAW_COLLABORATIVE_STATE_CONTRACT_HASH,
    operations: Object.freeze([
      Object.freeze({
        name: 'change',
        kind: 'call' as const,
        inputSchema: args.changeSchema,
        outputSchema: args.snapshotSchema,
        idempotency: 'non-idempotent' as const,
        limits: Object.freeze({ maxBytes: 64 * 1024, maxInFlight: 1, maxRatePerSecond: 16 }),
        lifecycle: Object.freeze({
          freeze: 'cancel' as const,
          park: 'dispose' as const,
          resume: 'reopen' as const,
          destroy: 'dispose' as const,
        }),
      }),
      Object.freeze({
        name: 'get',
        kind: 'call' as const,
        inputSchema: args.nullSchema,
        outputSchema: args.snapshotSchema,
        idempotency: 'read-only' as const,
        limits: Object.freeze({ maxBytes: 64 * 1024, maxInFlight: 1, maxRatePerSecond: 32 }),
        lifecycle: Object.freeze({
          freeze: 'cancel' as const,
          park: 'dispose' as const,
          resume: 'reopen' as const,
          destroy: 'dispose' as const,
        }),
      }),
      Object.freeze({
        name: 'subscribe',
        kind: 'stream' as const,
        inputSchema: args.nullSchema,
        eventSchema: args.snapshotSchema,
        limits: Object.freeze({
          maxBytes: 64 * 1024,
          maxInFlight: 1,
          maxQueueEvents: 1,
          maxQueueBytes: 64 * 1024,
        }),
        overflow: 'coalesce-latest' as const,
        lifecycle: Object.freeze({
          freeze: 'pause' as const,
          park: 'dispose' as const,
          resume: 'reopen' as const,
          destroy: 'dispose' as const,
        }),
      }),
    ]),
    errorCodes: Object.freeze([
      'state_aborted',
      'state_conflict',
      'state_failed',
      'state_unavailable',
    ]),
  });
}

