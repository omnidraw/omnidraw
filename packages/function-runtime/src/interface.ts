/**
 * @file Public registry, persistence, scheduling, sandbox, and usage SPIs.
 */

import type { IResourceGateway } from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TExecutorCapacityLease,
  TExecutorCapacityRequest,
  TFunctionAttempt,
  TFunctionAttemptId,
  TFunctionDefinition,
  TFunctionInvocationEnvelope,
  TFunctionInvocationId,
  TFunctionMemoryTier,
  TFunctionName,
  TFunctionRevisionRegistration,
  TInvocationLease,
  TInvocationLeaseMutationResult,
  TInvocationRecord,
  TInvocationAttemptCompletionRequest,
  TInvocationAttemptCompletionResult,
  TInvocationCancellationResult,
  TInvocationClaimRequest,
  TInvocationClaimResult,
  TInvocationCreateRequest,
  TInvocationCreateResult,
  TInvocationHeartbeatRequest,
  TInvocationRecoveryRequest,
  TInvocationRecoveryResult,
  TResourceWritePermit,
  TResourceWritePermitAcquireRequest,
  TResourceWritePermitAcquireResult,
  TResourceWritePermitConsumeRequest,
  TResourceWritePermitConsumeResult,
  TSandboxExecutionResult,
  TSandboxHandle,
  TSandboxStartRequest,
  TTerminalHistoryCompactionRequest,
  TTerminalHistoryCompactionResult,
  TUsageMetrics,
  TUsageOutboxRecord,
  TUsageOutboxState,
} from './types';

export interface IFunctionRegistry {
  registerFunctionsForRevision(
    tenant: TTenantContext,
    registration: TFunctionRevisionRegistration,
  ): Promise<readonly TFunctionDefinition[]>;
  resolveFunction(
    tenant: TTenantContext,
    request: Readonly<{ widgetRevisionId: string; functionName: TFunctionName }>,
  ): Promise<TFunctionDefinition | null>;
}

export interface IInvocationStore {
  createOrReplayInvocation(
    tenant: TTenantContext,
    request: TInvocationCreateRequest,
  ): Promise<TInvocationCreateResult>;
  getInvocation(
    tenant: TTenantContext,
    invocationId: TFunctionInvocationId,
  ): Promise<TInvocationRecord | null>;
  listAttempts(
    tenant: TTenantContext,
    invocationId: TFunctionInvocationId,
  ): Promise<readonly TFunctionAttempt[]>;
  requestCancellation(
    tenant: TTenantContext,
    request: Readonly<{ invocationId: TFunctionInvocationId; nowMs: number }>,
  ): Promise<TInvocationCancellationResult>;
  completeAttempt(
    tenant: TTenantContext,
    request: TInvocationAttemptCompletionRequest,
  ): Promise<TInvocationAttemptCompletionResult>;
  recoverExpiredLeases(
    tenant: TTenantContext,
    request: TInvocationRecoveryRequest,
  ): Promise<TInvocationRecoveryResult>;
  compactTerminalHistory(
    tenant: TTenantContext,
    request: TTerminalHistoryCompactionRequest,
  ): Promise<TTerminalHistoryCompactionResult>;
}

export interface IInvocationLeaseAuthority {
  claim(
    tenant: TTenantContext,
    request: TInvocationClaimRequest,
  ): Promise<TInvocationClaimResult>;
  startAttempt(
    tenant: TTenantContext,
    request: Readonly<{ lease: TInvocationLease; nowMs: number }>,
  ): Promise<TInvocationLeaseMutationResult>;
  enterGuestCode(
    tenant: TTenantContext,
    request: Readonly<{ lease: TInvocationLease; nowMs: number }>,
  ): Promise<TInvocationLeaseMutationResult>;
  heartbeat(
    tenant: TTenantContext,
    request: TInvocationHeartbeatRequest,
  ): Promise<TInvocationLeaseMutationResult>;
}

export interface IResourceWritePermitAuthority {
  acquireWritePermit(
    tenant: TTenantContext,
    request: TResourceWritePermitAcquireRequest,
  ): Promise<TResourceWritePermitAcquireResult>;
  getWritePermit(
    tenant: TTenantContext,
    permitId: string,
  ): Promise<TResourceWritePermit | null>;
  consumeWritePermit(
    tenant: TTenantContext,
    request: TResourceWritePermitConsumeRequest,
  ): Promise<TResourceWritePermitConsumeResult>;
  expireWritePermits(
    tenant: TTenantContext,
    request: Readonly<{ nowMs: number; limit: number }>,
  ): Promise<number>;
}

export interface IScheduler {
  notifyQueued(envelope: TFunctionInvocationEnvelope): Promise<void>;
  takeNext(
    request: Readonly<{
      orgId: string;
      cellId: string;
      placementEpoch: number;
      workerId: string;
      memoryTiers: readonly TFunctionMemoryTier[];
    }>,
  ): Promise<TFunctionInvocationEnvelope | null>;
}

export interface IExecutorCapacityAllocator {
  allocate(request: TExecutorCapacityRequest): Promise<TExecutorCapacityLease | null>;
  release(lease: TExecutorCapacityLease): Promise<void>;
}

export interface ISandboxDriver {
  readonly name: string;
  prepare(request: Readonly<{
    definition: TFunctionDefinition;
    artifact: Uint8Array;
  }>): Promise<TSandboxHandle>;
  start(
    prepared: TSandboxHandle,
    attempt: TFunctionAttempt,
    request: TSandboxStartRequest,
  ): Promise<TSandboxHandle>;
  execute(
    running: TSandboxHandle,
    envelope: TFunctionInvocationEnvelope,
    resources: IResourceGateway,
  ): Promise<TSandboxExecutionResult>;
  measure(running: TSandboxHandle): Promise<TUsageMetrics>;
  cancel(running: TSandboxHandle, reason: string): Promise<void>;
  reset(running: TSandboxHandle): Promise<void>;
  destroy(handle: TSandboxHandle): Promise<void>;
}

export interface IUsageSink {
  listUsageOutbox(
    tenant: TTenantContext,
    request: Readonly<{ states?: readonly TUsageOutboxState[]; limit: number }>,
  ): Promise<readonly TUsageOutboxRecord[]>;
  transitionUsageOutbox(
    tenant: TTenantContext,
    request: Readonly<{
      ids: readonly string[];
      expected: TUsageOutboxState;
      next: TUsageOutboxState;
      nowMs: number;
    }>,
  ): Promise<number>;
}

export interface IFunctionControlStore extends
  IFunctionRegistry,
  IInvocationStore,
  IInvocationLeaseAuthority,
  IResourceWritePermitAuthority,
  IUsageSink {}
