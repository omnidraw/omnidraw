/** @file Function-effect and canvas-binding intersection for one live call. */

import { createHash } from 'node:crypto';
import type {
  IResourceBindingResolver,
  IResourceGateway,
  TResourceCall,
  TResourceCallResult,
} from '#backend/shell/resources';
import { ResourceError } from '#backend/shell/resources';
import {
  PORTABLE_RESOURCE_DB_EXECUTE_FORMAT,
  PORTABLE_RESOURCE_DB_ROWS_FORMAT,
  PortableResourceOperationError,
  PortableResourceWireError,
  fnCanonicalizePortableResourceWireValue,
  fnDecodePortableResourceRequest,
  fnEncodePortableResourceFailure,
  fnEncodePortableResourceResult,
  fnEncodePortableResourceValue,
  fnValidatePortableResourceOperationInput,
  fnValidatePortableResourceOperationResult,
  type TPortableResourceFailureCode,
  type TPortableResourceResponseWire,
} from '@omnidraw/sdk/contract';
import type { TDirectFunctionCall } from '../types';
import type { EphemeralResourceWritePermitAuthority } from './EphemeralResourceWritePermitAuthority';
import { fnCanonicalJson } from './fn.canonical-json';
import { fnFunctionResourceCallDecision } from './fn.resource-call-policy';

export type TDirectInvocationResourceGatewayConfig = Readonly<{
  call: TDirectFunctionCall;
  gateway: IResourceGateway;
  bindings: IResourceBindingResolver;
  writePermits: EphemeralResourceWritePermitAuthority;
  nowMs: () => number;
}>;

const POLICY_FAILURE_CODES = new WeakMap<object, TPortableResourceFailureCode>();

function policyError(reason: string): ResourceError {
  if (reason === 'slot_not_declared') {
    return new ResourceError('RESOURCE_SLOT_UNKNOWN', 'Function resource slot is not declared.');
  }
  const error = new ResourceError(
    'RESOURCE_SCOPE_INVALID',
    `Function resource call denied: ${reason}.`,
  );
  if (reason === 'deadline_expired') POLICY_FAILURE_CODES.set(error, 'RESOURCE_TIMEOUT');
  return error;
}

const PORTABLE_FAILURE_MESSAGES = Object.freeze({
  RESOURCE_MALFORMED_INPUT: 'Resource request is malformed.',
  RESOURCE_SLOT_UNDECLARED: 'Resource slot is not declared.',
  RESOURCE_OPERATION_UNKNOWN: 'Resource operation is not available.',
  RESOURCE_EFFECT_DENIED: 'Resource operation effect is not allowed.',
  RESOURCE_CONFLICT: 'Resource operation conflicted.',
  RESOURCE_UNAVAILABLE: 'Resource is unavailable.',
  RESOURCE_QUERY_FAILED: 'Resource query failed.',
  RESOURCE_LIMIT_EXCEEDED: 'Resource operation exceeded a limit.',
  RESOURCE_CANCELLED: 'Resource operation was cancelled.',
  RESOURCE_TIMEOUT: 'Resource operation timed out.',
  RESOURCE_WRITE_OUTCOME_AMBIGUOUS: 'Resource write outcome is unknown; the operation was not retried.',
} satisfies Readonly<Record<TPortableResourceFailureCode, string>>);

const MALFORMED_CODES = new Set([
  'RESOURCE_CALL_INVALID',
  'RESOURCE_NAME_INVALID',
  'KV_KEY_INVALID',
  'KV_VALUE_INVALID',
  'SECRET_NAME_INVALID',
  'SECRET_VALUE_INVALID',
  'DB_OPERATION_PARAMETERS_INVALID',
  'DB_ARBITRARY_SQL_NOT_ALLOWED',
]);

const EFFECT_DENIED_CODES = new Set([
  'RESOURCE_KIND_MISMATCH',
  'RESOURCE_SCOPE_INVALID',
  'RESOURCE_READ_NOT_ALLOWED',
  'RESOURCE_WRITE_NOT_ALLOWED',
  'RESOURCE_WRITE_CAPABILITY_INVALID',
  'RESOURCE_WRITE_CAPABILITY_EXPIRED',
  'RESOURCE_WRITE_CAPABILITY_STALE',
  'KV_WRITE_NOT_ALLOWED',
  'SECRET_WRITE_NOT_ALLOWED',
  'DB_READ_NOT_ALLOWED',
  'DB_WRITE_NOT_ALLOWED',
]);

const CONFLICT_CODES = new Set([
  'RESOURCE_NAME_CONFLICT',
  'RESOURCE_LIFECYCLE_CONFLICT',
  'KV_ENTRY_CONFLICT',
  'SECRET_CONFLICT',
  'DB_RESOURCE_ROW_CONFLICT',
]);

const LIMIT_CODES = new Set([
  'RESOURCE_EXHAUSTED',
  'KV_LIST_LIMIT_EXCEEDED',
  'DB_RESOURCE_ROW_TOO_LARGE',
  'DB_RESULT_LIMIT_EXCEEDED',
  'LIMIT_EXCEEDED',
]);

const QUERY_FAILURE_CODES = new Set([
  'DB_QUERY_FAILED',
  'DB_EXECUTE_FAILED',
  'DB_RESOURCE_SCHEMA_OPERATION_INVALID',
]);

const UNAVAILABLE_CODES = new Set([
  'RESOURCE_NOT_BOUND',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_NOT_READY',
  'RESOURCE_UNAVAILABLE',
  'RESOURCE_MIGRATING',
  'RESOURCE_PLACEMENT_NOT_FOUND',
  'RESOURCE_PLACEMENT_STALE',
]);

function codedError(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor?.get === undefined && typeof descriptor?.value === 'string'
    ? descriptor.value
    : null;
}

function portableFailureCode(
  error: unknown,
  effect: 'read' | 'write',
): TPortableResourceFailureCode {
  if (error !== null && typeof error === 'object') {
    const policyCode = POLICY_FAILURE_CODES.get(error);
    if (policyCode !== undefined) return policyCode;
  }
  if (error instanceof PortableResourceOperationError) {
    if (error.code === 'UNKNOWN_OPERATION') return 'RESOURCE_OPERATION_UNKNOWN';
    if (error.code === 'EFFECT_DENIED') return 'RESOURCE_EFFECT_DENIED';
    if (error.code === 'INVALID_INPUT') return 'RESOURCE_MALFORMED_INPUT';
    return effect === 'write'
      ? 'RESOURCE_WRITE_OUTCOME_AMBIGUOUS'
      : 'RESOURCE_QUERY_FAILED';
  }
  const code = codedError(error);
  if (code === 'RESOURCE_SLOT_UNKNOWN') return 'RESOURCE_SLOT_UNDECLARED';
  if (code === 'DB_NAMED_OPERATION_UNKNOWN') return 'RESOURCE_OPERATION_UNKNOWN';
  if (code !== null && MALFORMED_CODES.has(code)) return 'RESOURCE_MALFORMED_INPUT';
  if (code !== null && EFFECT_DENIED_CODES.has(code)) return 'RESOURCE_EFFECT_DENIED';
  if (code !== null && CONFLICT_CODES.has(code)) return 'RESOURCE_CONFLICT';
  if (code !== null && LIMIT_CODES.has(code)) return 'RESOURCE_LIMIT_EXCEEDED';
  if (code !== null && QUERY_FAILURE_CODES.has(code)) return 'RESOURCE_QUERY_FAILED';
  if (code !== null && UNAVAILABLE_CODES.has(code)) return 'RESOURCE_UNAVAILABLE';
  if (code === 'RESOURCE_CALL_CANCELLED') return 'RESOURCE_CANCELLED';
  if (code === 'RESOURCE_DRAIN_TIMEOUT' || code === 'FUNCTION_TIMED_OUT') {
    return 'RESOURCE_TIMEOUT';
  }
  return effect === 'write'
    ? 'RESOURCE_WRITE_OUTCOME_AMBIGUOUS'
    : 'RESOURCE_UNAVAILABLE';
}

function failureResponse(
  correlationId: string,
  code: TPortableResourceFailureCode,
): TPortableResourceResponseWire {
  return fnEncodePortableResourceFailure({
    correlationId,
    failure: { code, message: PORTABLE_FAILURE_MESSAGES[code] },
  });
}

function recoverCorrelationId(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'correlationId');
  if (descriptor?.get !== undefined || typeof descriptor?.value !== 'string') return null;
  try {
    return failureResponse(descriptor.value, 'RESOURCE_MALFORMED_INPUT').correlationId;
  } catch {
    return null;
  }
}

/** Decode exactly once, call the host gateway once, and return one safe wire response. */
export async function fnRoutePortableResourceCall(
  gateway: IResourceGateway,
  requestWire: unknown,
): Promise<TPortableResourceResponseWire> {
  let request: ReturnType<typeof fnDecodePortableResourceRequest>;
  try {
    request = fnDecodePortableResourceRequest(requestWire);
  } catch (error) {
    const correlationId = recoverCorrelationId(requestWire);
    if (correlationId === null) throw error;
    return failureResponse(
      correlationId,
      error instanceof PortableResourceWireError && error.code === 'LIMIT_EXCEEDED'
        ? 'RESOURCE_LIMIT_EXCEEDED'
        : 'RESOURCE_MALFORMED_INPUT',
    );
  }

  let result: TResourceCallResult;
  try {
    result = await gateway.call({
      slot: request.slot,
      operation: request.operation,
      effect: request.effect,
      input: request.input,
    });
  } catch (error) {
    const code = portableFailureCode(error, request.effect);
    return failureResponse(request.correlationId, code);
  }

  try {
    return fnEncodePortableResourceResult({
      correlationId: request.correlationId,
      output: result.output,
    });
  } catch (error) {
    const outputFailure = error instanceof PortableResourceWireError
      && error.code === 'LIMIT_EXCEEDED'
      ? 'RESOURCE_LIMIT_EXCEEDED'
      : 'RESOURCE_QUERY_FAILED';
    return failureResponse(
      request.correlationId,
      request.effect === 'write'
        ? 'RESOURCE_WRITE_OUTCOME_AMBIGUOUS'
        : outputFailure,
    );
  }
}

function declaredDbResult(value: unknown): 'rows' | 'execute' | undefined {
  if (Array.isArray(value)) return 'execute';
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'format');
  if (descriptor?.get !== undefined) return undefined;
  if (descriptor?.value === PORTABLE_RESOURCE_DB_ROWS_FORMAT) return 'rows';
  if (descriptor?.value === PORTABLE_RESOURCE_DB_EXECUTE_FORMAT) return 'execute';
  return undefined;
}

function operationFingerprint(
  config: TDirectInvocationResourceGatewayConfig,
  resourceId: string,
  call: Extract<TResourceCall, { effect: 'write' }>,
): string {
  const inputWireDigestSha256 = createHash('sha256').update(
    fnCanonicalizePortableResourceWireValue(
      fnEncodePortableResourceValue(call.input),
    ),
  ).digest('hex');
  const value = fnCanonicalJson({
    widgetKey: config.call.definition.widgetKey,
    catalogGeneration: config.call.definition.catalogGeneration,
    canvasId: config.call.subject.canvasId,
    elementId: config.call.subject.elementId,
    widgetInstanceId: config.call.subject.widgetInstanceId,
    invocationId: config.call.id,
    functionName: config.call.definition.descriptor.exportName,
    slot: call.slot,
    resourceId,
    operation: call.operation,
    inputWireDigestSha256,
  });
  return createHash('sha256').update(value).digest('hex');
}

export class DirectInvocationResourceGateway implements IResourceGateway {
  readonly #config: TDirectInvocationResourceGatewayConfig;
  readonly #nowMs: () => number;
  #writeSequence = 0;

  constructor(config: TDirectInvocationResourceGatewayConfig) {
    this.#config = config;
    this.#nowMs = config.nowMs;
  }

  async call<TOutput = unknown>(
    call: TResourceCall,
  ): Promise<TResourceCallResult<TOutput>> {
    const descriptor = this.#config.call.definition.descriptor;
    const decision = fnFunctionResourceCallDecision({
      functionEffect: descriptor.effect,
      resources: descriptor.resources,
      call,
    });
    if (!decision.allowed) throw policyError(decision.reason);
    const binding = await this.#config.bindings.resolveBinding(call.slot);
    if (binding === null) throw new ResourceError('RESOURCE_NOT_BOUND', 'Resource slot is not bound.');
    if (call.effect === 'read' && !binding.allowRead) throw policyError('slot_not_readable');
    fnValidatePortableResourceOperationInput({
      kind: binding.kind,
      operation: call.operation,
      effect: call.effect,
      input: call.input,
      ...(binding.kind === 'db' && call.operation === 'invoke'
        ? { declaredEffect: call.effect }
        : {}),
    });

    if (call.effect === 'read') {
      const result = await this.#config.gateway.call({ ...call, kind: binding.kind });
      fnValidatePortableResourceOperationResult({
        kind: binding.kind,
        operation: call.operation,
        result: result.output,
        ...(binding.kind === 'db' && call.operation === 'invoke'
          ? { declaredResult: declaredDbResult(result.output) }
          : {}),
      });
      return result as TResourceCallResult<TOutput>;
    }

    if (!binding.allowWrite) throw policyError('slot_not_writable');
    const nowMs = this.#nowMs();
    if (this.#config.call.deadlineAtMs <= nowMs) throw policyError('deadline_expired');
    const operationId = `${this.#config.call.id}:${this.#writeSequence++}`;
    const fingerprint = operationFingerprint(this.#config, binding.resourceId, call);
    const issued = this.#config.writePermits.issueWriteCapability({
      resourceId: binding.resourceId,
      invocationId: this.#config.call.id,
      operation: call.operation,
      operationId,
      operationFingerprintSha256: fingerprint,
      expiresAtMs: this.#config.call.deadlineAtMs,
    });
    try {
      const result = await this.#config.gateway.call({
        ...call,
        kind: binding.kind,
        operationId,
        writeCapability: issued.capability,
      });
      fnValidatePortableResourceOperationResult({
        kind: binding.kind,
        operation: call.operation,
        result: result.output,
        ...(binding.kind === 'db' && call.operation === 'invoke'
          ? { declaredResult: declaredDbResult(result.output) }
          : {}),
      });
      return result as TResourceCallResult<TOutput>;
    } finally {
      this.#config.writePermits.revokeWritePermit(issued.permit.id);
    }
  }
}
