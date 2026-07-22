/**
 * @file Local invocation admission and bounded pull-dispatch orchestration.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { IFunctionControlStore, IScheduler } from '../interface';
import type {
  TFunctionInvocationEnvelope,
  TFunctionInvocationSubject,
  TFunctionMemoryTier,
  TInvocationCreateResult,
  TInvocationIdempotencyScope,
} from '../types';
import { FunctionExecutor, type TFunctionExecutionOutcome } from './FunctionExecutor';
import type { IFunctionSchemaValidator } from './JsonSchemaFunctionValidator';
import { fnCanonicalJson } from './fn.canonical-json';

export type TLocalFunctionInvocationRequest = Readonly<{
  widgetDefinitionId: string;
  widgetRevisionId: string;
  subject: TFunctionInvocationSubject;
  functionName: string;
  input: unknown;
  idempotencyKey: string;
  idempotencyScope?: TInvocationIdempotencyScope;
  idempotencyExpiresAtMs?: number | null;
  priority?: number;
  deadlineAtMs?: number;
}>;

export type TLocalFunctionDispatcherConfig = Readonly<{
  orgId: string;
  cellId: string;
  placementEpoch: number;
  /** Host-derived placement identity used only for controller recovery calls. */
  recoveryTenant: TTenantContext;
  workerId: string;
  schedulingDomain: string;
  memoryTiers: readonly TFunctionMemoryTier[];
  store: IFunctionControlStore;
  scheduler: IScheduler;
  executor: FunctionExecutor;
  schemas: IFunctionSchemaValidator;
  policyVersion?: number;
  maxConcurrent?: number;
  pollMs?: number;
  recoveryIntervalMs?: number;
  recoveryBatchSize?: number;
  nowMs?: () => number;
  createId?: () => string;
}>;

export type TLocalFunctionDispatcherDiagnostics = Readonly<{
  started: boolean;
  activeExecutionCount: number;
  maxConcurrent: number;
  recoveryInProgress: boolean;
  lastRecoveryFailure: string | null;
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function inputError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export class LocalFunctionDispatcher {
  readonly #config: TLocalFunctionDispatcherConfig;
  readonly #policyVersion: number;
  readonly #maxConcurrent: number;
  readonly #pollMs: number;
  readonly #recoveryIntervalMs: number;
  readonly #recoveryBatchSize: number;
  readonly #nowMs: () => number;
  readonly #createId: () => string;
  readonly #active = new Set<Promise<TFunctionExecutionOutcome>>();
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #recoveryTimer: ReturnType<typeof setInterval> | null = null;
  #recovery: Promise<void> | null = null;
  #lastRecoveryFailure: string | null = null;
  #started = false;
  #pumping = false;
  #pumpCompletion: Promise<void> | null = null;
  #stopping = false;

  constructor(config: TLocalFunctionDispatcherConfig) {
    this.#config = config;
    this.#policyVersion = config.policyVersion ?? 1;
    this.#maxConcurrent = config.maxConcurrent ?? 4;
    this.#pollMs = config.pollMs ?? 100;
    this.#recoveryIntervalMs = config.recoveryIntervalMs ?? 1_000;
    this.#recoveryBatchSize = config.recoveryBatchSize ?? 100;
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#createId = config.createId ?? randomUUID;
    if (!Number.isInteger(this.#maxConcurrent) || this.#maxConcurrent < 1) {
      throw new RangeError('Local function dispatcher concurrency must be positive.');
    }
    if (!Number.isInteger(this.#recoveryIntervalMs) || this.#recoveryIntervalMs < 1) {
      throw new RangeError('Local function recovery interval must be positive.');
    }
    if (
      !Number.isInteger(this.#recoveryBatchSize)
      || this.#recoveryBatchSize < 1
      || this.#recoveryBatchSize > 1_000
    ) {
      throw new RangeError('Local function recovery batch size must be between 1 and 1000.');
    }
    if (
      config.recoveryTenant.orgId !== config.orgId
      || config.recoveryTenant.cellId !== config.cellId
      || config.recoveryTenant.placementEpoch !== config.placementEpoch
    ) {
      throw new Error('Local function recovery identity differs from its scheduling placement.');
    }
  }

  async invoke(
    tenant: TTenantContext,
    request: TLocalFunctionInvocationRequest,
  ): Promise<TInvocationCreateResult> {
    if (
      tenant.orgId !== this.#config.orgId
      || tenant.cellId !== this.#config.cellId
      || tenant.placementEpoch !== this.#config.placementEpoch
    ) {
      throw inputError('FUNCTION_PLACEMENT_STALE', 'Function invocation is routed to the wrong cell.');
    }
    if (
      request.idempotencyKey.trim().length === 0
      || request.idempotencyKey.length > 200
    ) throw inputError('FUNCTION_IDEMPOTENCY_KEY_INVALID', 'Function idempotency key is invalid.');
    const definition = await this.#config.store.resolveFunctionForSubject(tenant, {
      subject: request.subject,
      widgetDefinitionId: request.widgetDefinitionId,
      widgetRevisionId: request.widgetRevisionId,
      functionName: request.functionName,
      purpose: 'admission',
    });
    if (
      !definition
      || definition.widgetDefinitionId !== request.widgetDefinitionId
      || definition.orgId !== tenant.orgId
    ) throw inputError('FUNCTION_NOT_FOUND', 'Published function revision was not found.');

    let canonicalInput: string;
    try {
      canonicalInput = fnCanonicalJson(request.input, {
        maxBytes: 1_048_576,
        maxDepth: 64,
        maxNodes: 10_000,
      });
    } catch {
      throw inputError('FUNCTION_INPUT_NOT_JSON', 'Function input must be bounded JSON.');
    }
    const validation = this.#config.schemas.validate(definition.inputSchema, request.input);
    if (!validation.valid) {
      throw inputError('FUNCTION_INPUT_SCHEMA_INVALID', 'Function input does not match its canonical schema.');
    }
    const nowMs = this.#nowMs();
    const deadlineAtMs = Math.min(
      request.deadlineAtMs ?? nowMs + definition.limits.timeoutMs,
      nowMs + definition.limits.timeoutMs,
    );
    if (!Number.isInteger(deadlineAtMs) || deadlineAtMs <= nowMs) {
      throw inputError('FUNCTION_DEADLINE_INVALID', 'Function deadline must be in the future.');
    }
    const priority = request.priority ?? 0;
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      throw inputError('FUNCTION_PRIORITY_INVALID', 'Function priority is outside the local bound.');
    }
    const invocationId = this.#createId();
    const inputDigestSha256 = sha256(canonicalInput);
    const invocationTenant: TTenantContext = Object.freeze({ ...tenant, invocationId });
    const envelope: TFunctionInvocationEnvelope = Object.freeze({
      id: invocationId,
      tenant: invocationTenant,
      widgetDefinitionId: definition.widgetDefinitionId,
      widgetRevisionId: definition.widgetRevisionId,
      subject: request.subject,
      functionId: definition.id,
      functionName: definition.name,
      definitionRevision: definition.definitionRevision,
      artifactDigestSha256: definition.artifactDigestSha256,
      contractDigestSha256: definition.contractDigestSha256,
      runtimeAbi: definition.runtimeAbi,
      input: request.input,
      inputDigestSha256,
      idempotencyKey: request.idempotencyKey,
      policyVersion: this.#policyVersion,
      priority,
      limits: definition.limits,
      retry: definition.retry,
      createdAtMs: nowMs,
      deadlineAtMs,
    });
    const requestFingerprintSha256 = sha256(fnCanonicalJson({
      orgId: tenant.orgId,
      accountId: tenant.accountId,
      widgetDefinitionId: definition.widgetDefinitionId,
      widgetRevisionId: definition.widgetRevisionId,
      subject: request.subject,
      functionId: definition.id,
      definitionRevision: definition.definitionRevision,
      artifactDigestSha256: definition.artifactDigestSha256,
      contractDigestSha256: definition.contractDigestSha256,
      inputDigestSha256,
      policyVersion: this.#policyVersion,
      priority,
      requestedDeadlineAtMs: request.deadlineAtMs ?? null,
    }));
    const result = await this.#config.store.createOrReplayInvocation(tenant, {
      envelope,
      idempotencyRecordId: this.#createId(),
      idempotencyScope: request.idempotencyScope ?? request.subject,
      requestFingerprintSha256,
      idempotencyExpiresAtMs: request.idempotencyExpiresAtMs ?? null,
    });
    if (result.status === 'created') {
      await this.#config.scheduler.notifyQueued(result.invocation.envelope).catch(() => undefined);
      void this.dispatchAvailable();
    }
    return result;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#stopping = false;
    try {
      // Recovery runs before polling so a restarted placement discovers stale
      // leased work without waiting for a fresh invocation request.
      await this.#recoverExpiredLeases();
      if (this.#stopping) return;
      this.#pollTimer = setInterval(() => { void this.dispatchAvailable(); }, this.#pollMs);
      (this.#pollTimer as unknown as { unref?: () => void }).unref?.();
      this.#recoveryTimer = setInterval(() => {
        void this.#recoverExpiredLeases().catch(() => undefined);
      }, this.#recoveryIntervalMs);
      (this.#recoveryTimer as unknown as { unref?: () => void }).unref?.();
      void this.dispatchAvailable();
    } catch (error) {
      this.#started = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#started = false;
    if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
    if (this.#recoveryTimer !== null) clearInterval(this.#recoveryTimer);
    this.#pollTimer = null;
    this.#recoveryTimer = null;
    await this.#recovery?.catch(() => undefined);
    await this.#pumpCompletion;
    await Promise.allSettled([...this.#active]);
  }

  async #recoverExpiredLeases(): Promise<void> {
    if (this.#recovery !== null) return this.#recovery;
    const recovery = (async () => {
      try {
        const result = await this.#config.store.recoverExpiredLeases(
          this.#config.recoveryTenant,
          { nowMs: this.#nowMs(), limit: this.#recoveryBatchSize },
        );
        this.#lastRecoveryFailure = null;
        if (result.recoveredInvocationIds.length > 0 && !this.#stopping) {
          void this.dispatchAvailable();
        }
      } catch (error) {
        this.#lastRecoveryFailure = error instanceof Error
          ? error.message
          : 'Function lease recovery failed.';
        throw error;
      }
    })();
    this.#recovery = recovery;
    try {
      await recovery;
    } finally {
      if (this.#recovery === recovery) this.#recovery = null;
    }
  }

  async dispatchAvailable(): Promise<void> {
    if (this.#pumping || this.#stopping) return;
    this.#pumping = true;
    let completePump!: () => void;
    const pumpCompletion = new Promise<void>((resolve) => { completePump = resolve; });
    this.#pumpCompletion = pumpCompletion;
    try {
      while (this.#active.size < this.#maxConcurrent && !this.#stopping) {
        const envelope = await this.#config.scheduler.takeNext({
          orgId: this.#config.orgId,
          cellId: this.#config.cellId,
          placementEpoch: this.#config.placementEpoch,
          workerId: this.#config.workerId,
          memoryTiers: this.#config.memoryTiers,
        });
        if (this.#stopping) break;
        if (envelope === null) break;
        const execution = this.#config.executor.execute(envelope);
        this.#active.add(execution);
        void execution.finally(() => {
          this.#active.delete(execution);
          if (!this.#stopping) void this.dispatchAvailable();
        }).catch(() => undefined);
      }
    } finally {
      this.#pumping = false;
      if (this.#pumpCompletion === pumpCompletion) this.#pumpCompletion = null;
      completePump();
    }
  }

  diagnostics(): TLocalFunctionDispatcherDiagnostics {
    return Object.freeze({
      started: this.#started,
      activeExecutionCount: this.#active.size,
      maxConcurrent: this.#maxConcurrent,
      recoveryInProgress: this.#recovery !== null,
      lastRecoveryFailure: this.#lastRecoveryFailure,
    });
  }
}
