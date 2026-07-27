/**
 * @file Invocation-scoped logical Resource Gateway facade.
 */

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type {
  IResourceBindingResolver,
  IResourceGateway,
  TResourceCall,
  TResourceCallResult,
} from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { IResourceWritePermitAuthority } from '../interface';
import type {
  TFunctionAttempt,
  TFunctionDefinition,
  TFunctionInvocationEnvelope,
  TInvocationLease,
} from '../types';
import type { IResourceWriteCapabilityIssuer } from './ResourceWriteCapabilityAuthority';
import { fnCanonicalJson } from './fn.canonical-json';
import { fnFunctionResourceCallDecision } from './fn.resource-call-policy';

export type TInvocationResourceGatewayConfig = Readonly<{
  tenant: TTenantContext;
  definition: TFunctionDefinition;
  envelope: TFunctionInvocationEnvelope;
  attempt: TFunctionAttempt;
  getLease: () => TInvocationLease;
  gateway: IResourceGateway;
  bindings: IResourceBindingResolver;
  permits: IResourceWritePermitAuthority;
  writeCapabilities: IResourceWriteCapabilityIssuer;
  writePermitTtlMs?: number;
  nowMs?: () => number;
  createPermitId?: () => string;
}>;

function tenantMatches(expected: TTenantContext, actual: TTenantContext): boolean {
  return expected.orgId === actual.orgId
    && expected.accountId === actual.accountId
    && expected.cellId === actual.cellId
    && expected.placementEpoch === actual.placementEpoch
    && expected.invocationId === actual.invocationId;
}

function policyError(reason: string): Error {
  return Object.assign(new Error('Function resource call exceeds its canonical descriptor ceiling.'), {
    code: 'FUNCTION_RESOURCE_CALL_DENIED',
    reason,
  });
}

function fingerprintValue(
  value: unknown,
  active: Set<object> = new Set(),
  depth = 0,
): unknown {
  if (depth > 64) throw new TypeError('Resource operation input exceeds its depth limit.');
  if (value === null) return ['null'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Resource operation input contains a non-finite number.');
    }
    return ['number', Object.is(value, -0) ? 0 : value];
  }
  if (typeof value === 'bigint') {
    return ['bigint', value.toString(10)];
  }
  if (value instanceof Uint8Array) {
    return ['bytes', Buffer.from(value).toString('base64url')];
  }
  if (typeof value !== 'object') {
    throw new TypeError('Resource operation input is not fingerprintable.');
  }
  if (active.has(value)) throw new TypeError('Resource operation input contains a cycle.');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('Resource operation input cannot contain sparse arrays.');
        }
      }
      return ['array', value.map((entry) => fingerprintValue(entry, active, depth + 1))];
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Resource operation input must use plain records.');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Resource operation input cannot contain symbol keys.');
    }
    const result: Array<readonly [string, unknown]> = [];
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        throw new TypeError('Resource operation input cannot contain accessors.');
      }
      result.push([key, fingerprintValue(descriptor.value, active, depth + 1)]);
    }
    return ['object', result];
  } finally {
    active.delete(value);
  }
}

function operationFingerprintSha256(
  config: TInvocationResourceGatewayConfig,
  binding: NonNullable<Awaited<ReturnType<IResourceBindingResolver['resolveBinding']>>>,
  call: Extract<TResourceCall, { effect: 'write' }>,
): string {
  const canonical = fnCanonicalJson({
    orgId: config.tenant.orgId,
    widgetDefinitionId: config.definition.widgetDefinitionId,
    widgetRevisionId: config.definition.widgetRevisionId,
    functionId: config.definition.id,
    definitionRevision: config.definition.definitionRevision,
    slot: call.slot,
    resourceId: binding.resourceId,
    resourceKind: binding.kind,
    bindingDefinitionId: binding.definitionId ?? null,
    bindingRevisionId: binding.revisionId ?? null,
    operation: call.operation,
    input: fingerprintValue(call.input),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Guest-selected permit IDs, operation IDs, capabilities, resource IDs, and
 * tenant identity are never accepted. The underlying gateway independently
 * intersects the published manifest requirement and immutable binding.
 */
export class InvocationResourceGateway implements IResourceGateway {
  readonly #config: TInvocationResourceGatewayConfig;
  readonly #nowMs: () => number;
  readonly #createPermitId: () => string;
  readonly #writePermitTtlMs: number;
  #writeSequence = 0;

  constructor(config: TInvocationResourceGatewayConfig) {
    const writePermitTtlMs = config.writePermitTtlMs ?? 5_000;
    if (!Number.isInteger(writePermitTtlMs) || writePermitTtlMs < 1 || writePermitTtlMs > 30_000) {
      throw new RangeError('Function resource write-permit TTL must be between 1 and 30000ms.');
    }
    const lease = config.getLease();
    if (
      config.definition.id !== config.envelope.functionId
      || config.definition.widgetRevisionId !== config.envelope.widgetRevisionId
      || config.definition.definitionRevision !== config.envelope.definitionRevision
      || config.attempt.invocationId !== config.envelope.id
      || lease.invocationId !== config.envelope.id
      || lease.attemptId !== config.attempt.id
      || lease.leaseEpoch !== config.attempt.leaseEpoch
    ) {
      throw new Error('Function resource gateway identity is not revision/attempt fenced.');
    }
    this.#config = config;
    this.#writePermitTtlMs = writePermitTtlMs;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#createPermitId = config.createPermitId ?? randomUUID;
  }

  async call<TOutput = unknown>(
    tenant: TTenantContext,
    call: TResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    if (!tenantMatches(this.#config.tenant, tenant)) throw policyError('tenant_mismatch');
    const decision = fnFunctionResourceCallDecision({
      functionEffect: this.#config.definition.effect,
      resources: this.#config.definition.resources,
      call,
    });
    if (!decision.allowed) throw policyError(decision.reason);
    if (call.effect === 'read') {
      return this.#config.gateway.call(tenant, {
        slot: call.slot,
        ...(call.kind === undefined ? {} : { kind: call.kind }),
        operation: call.operation,
        effect: 'read',
        input: call.input,
      }) as Promise<TResourceCallResult<TOutput>>;
    }

    const nowMs = this.#nowMs();
    const lease = this.#config.getLease();
    if (
      lease.invocationId !== this.#config.envelope.id
      || lease.attemptId !== this.#config.attempt.id
      || lease.leaseEpoch !== this.#config.attempt.leaseEpoch
    ) throw policyError('lease_fence_mismatch');
    const expiresAtMs = Math.min(
      nowMs + this.#writePermitTtlMs,
      lease.expiresAtMs,
      this.#config.envelope.deadlineAtMs,
    );
    if (expiresAtMs <= nowMs) throw policyError('lease_or_deadline_expired');
    const binding = await this.#config.bindings.resolveBinding(tenant, call.slot);
    if (binding === null) throw policyError('slot_not_bound');
    const operationId = `${this.#config.envelope.id}:${this.#writeSequence++}`;
    const operationFingerprint = operationFingerprintSha256(this.#config, binding, call);
    const acquired = await this.#config.permits.acquireWritePermit(tenant, {
      id: this.#createPermitId(),
      resourceId: binding.resourceId,
      invocationId: this.#config.envelope.id,
      attemptId: this.#config.attempt.id,
      leaseEpoch: lease.leaseEpoch,
      operationName: call.operation,
      operationId,
      operationFingerprintSha256: operationFingerprint,
      nowMs,
      ttlMs: expiresAtMs - nowMs,
    });
    if (acquired.status === 'stale' || acquired.status === 'conflict') {
      throw policyError(`write_permit_${acquired.status}`);
    }
    if (acquired.status === 'replayed' && acquired.permit.status === 'consumed') {
      return {
        output: acquired.permit.result as TOutput,
        receipt: {
          operationId,
          resourceId: binding.resourceId,
          effect: 'write',
          committed: true,
          replayed: true,
        },
      };
    }
    const writeCapability = await this.#config.writeCapabilities.issueWriteCapability(
      tenant,
      acquired.permit,
    );
    return this.#config.gateway.call(tenant, {
      slot: call.slot,
      ...(call.kind === undefined ? {} : { kind: call.kind }),
      operation: call.operation,
      operationId,
      effect: 'write',
      input: call.input,
      writeCapability,
    }) as Promise<TResourceCallResult<TOutput>>;
  }
}
