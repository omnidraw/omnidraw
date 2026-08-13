/** @file Function-effect and canvas-binding intersection for one live call. */

import { createHash } from 'node:crypto';
import type {
  IResourceBindingResolver,
  IResourceGateway,
  TResourceCall,
  TResourceCallResult,
} from '#backend/shell/resources';
import { ResourceError } from '#backend/shell/resources';
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

function policyError(reason: string): ResourceError {
  return new ResourceError('RESOURCE_SCOPE_INVALID', `Function resource call denied: ${reason}.`);
}

function operationFingerprint(
  config: TDirectInvocationResourceGatewayConfig,
  resourceId: string,
  call: Extract<TResourceCall, { effect: 'write' }>,
): string {
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
    input: call.input,
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
    if (call.effect === 'read') {
      return this.#config.gateway.call(call) as Promise<TResourceCallResult<TOutput>>;
    }

    const binding = await this.#config.bindings.resolveBinding(call.slot);
    if (binding === null || !binding.allowWrite) throw policyError('slot_not_writable');
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
      return await this.#config.gateway.call({
        ...call,
        operationId,
        writeCapability: issued.capability,
      }) as TResourceCallResult<TOutput>;
    } finally {
      this.#config.writePermits.revokeWritePermit(issued.permit.id);
    }
  }
}
