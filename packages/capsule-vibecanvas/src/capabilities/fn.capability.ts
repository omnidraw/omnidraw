import type {
  CapsuleCapabilityDescriptor,
  CapsuleCapabilityGrant,
  CapsuleCapabilityRequest,
  CapsuleSchemaReference,
} from '@omnidraw/capsule/protocol';
import type { TWidgetBrowserFunctionDescriptor } from '@vibecanvas/widget-contract';
import {
  VIBECANVAS_CAPSULE_CAPABILITY_VERSION,
  VIBECANVAS_COLLABORATIVE_STATE_CAPABILITY_ID,
  VIBECANVAS_COLLABORATIVE_STATE_CONTRACT_HASH,
} from './CONSTANTS';
import type { TVibecanvasCapsuleCapabilitySelector } from './types';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function fnVibecanvasServerFunctionCapabilityId(
  descriptorDigestSha256: string,
): string {
  if (!DIGEST_PATTERN.test(descriptorDigestSha256)) {
    throw new TypeError('Server-function descriptor digest must be lowercase SHA-256.');
  }
  return `vibecanvas.widget.functions.h${descriptorDigestSha256}`;
}

export function fnVibecanvasServerFunctionCapabilitySelector(
  descriptorDigestSha256: string,
): TVibecanvasCapsuleCapabilitySelector {
  return Object.freeze({
    id: fnVibecanvasServerFunctionCapabilityId(descriptorDigestSha256),
    versionRange: VIBECANVAS_CAPSULE_CAPABILITY_VERSION,
    contractHash: `sha256:${descriptorDigestSha256}`,
  });
}

export function fnVibecanvasCollaborativeStateCapabilitySelector():
TVibecanvasCapsuleCapabilitySelector {
  return Object.freeze({
    id: VIBECANVAS_COLLABORATIVE_STATE_CAPABILITY_ID,
    versionRange: VIBECANVAS_CAPSULE_CAPABILITY_VERSION,
    contractHash: VIBECANVAS_COLLABORATIVE_STATE_CONTRACT_HASH,
  });
}

export function fnVibecanvasCapabilityRequest(
  selector: TVibecanvasCapsuleCapabilitySelector,
  operations: readonly string[],
): CapsuleCapabilityRequest {
  return Object.freeze({
    ...selector,
    required: true,
    operations: Object.freeze([...operations].sort()),
  });
}

export function fnVibecanvasCapabilityGrant(
  selector: TVibecanvasCapsuleCapabilitySelector,
  operations: readonly string[],
): CapsuleCapabilityGrant {
  return Object.freeze({
    id: selector.id,
    version: VIBECANVAS_CAPSULE_CAPABILITY_VERSION,
    contractHash: selector.contractHash,
    operations: Object.freeze([...operations].sort()),
  });
}

export function fnVibecanvasServerFunctionDescriptor(args: Readonly<{
  descriptorDigestSha256: string;
  functions: readonly Readonly<{
    function: TWidgetBrowserFunctionDescriptor;
    inputSchema: CapsuleSchemaReference;
    outputSchema: CapsuleSchemaReference;
  }>[];
}>): CapsuleCapabilityDescriptor {
  const selector = fnVibecanvasServerFunctionCapabilitySelector(
    args.descriptorDigestSha256,
  );
  return Object.freeze({
    id: selector.id,
    version: VIBECANVAS_CAPSULE_CAPABILITY_VERSION,
    contractHash: selector.contractHash,
    operations: Object.freeze(args.functions.map(({ function: item, inputSchema, outputSchema }) => (
      Object.freeze({
        name: item.exportName,
        kind: 'call' as const,
        inputSchema,
        outputSchema,
        idempotency: item.effect === 'fn'
          ? 'read-only' as const
          : item.retry.mode === 'idempotent'
            ? 'idempotent' as const
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

export function fnVibecanvasCollaborativeStateDescriptor(args: Readonly<{
  nullSchema: CapsuleSchemaReference;
  changeSchema: CapsuleSchemaReference;
  snapshotSchema: CapsuleSchemaReference;
}>): CapsuleCapabilityDescriptor {
  return Object.freeze({
    id: VIBECANVAS_COLLABORATIVE_STATE_CAPABILITY_ID,
    version: VIBECANVAS_CAPSULE_CAPABILITY_VERSION,
    contractHash: VIBECANVAS_COLLABORATIVE_STATE_CONTRACT_HASH,
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
