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
  TInvocationLease,
  TInvocationRecord,
  TInvocationStatus,
  TSandboxExecutionResult,
  TSandboxHandle,
  TUsageMetrics,
  TUsageReceipt,
} from './types';

export interface IFunctionRegistry {
  resolveFunction(
    tenant: TTenantContext,
    request: Readonly<{ widgetRevisionId: string; functionName: TFunctionName }>,
  ): Promise<TFunctionDefinition | null>;
}

export interface IInvocationStore {
  createInvocation(envelope: TFunctionInvocationEnvelope): Promise<TInvocationRecord>;
  getInvocation(
    tenant: TTenantContext,
    invocationId: TFunctionInvocationId,
  ): Promise<TInvocationRecord | null>;
  transitionInvocation(
    tenant: TTenantContext,
    transition: Readonly<{
      invocationId: TFunctionInvocationId;
      expected: TInvocationStatus;
      next: TInvocationStatus;
    }>,
  ): Promise<boolean>;
  recordAttempt(tenant: TTenantContext, attempt: TFunctionAttempt): Promise<void>;
}

export interface IInvocationLeaseAuthority {
  claim(
    tenant: TTenantContext,
    request: Readonly<{
      invocationId: TFunctionInvocationId;
      attemptId: TFunctionAttemptId;
      workerId: string;
      nowMs: number;
      ttlMs: number;
    }>,
  ): Promise<TInvocationLease | null>;
  heartbeat(
    tenant: TTenantContext,
    lease: TInvocationLease,
    nowMs: number,
  ): Promise<TInvocationLease | null>;
  release(tenant: TTenantContext, lease: TInvocationLease): Promise<void>;
}

export interface IScheduler {
  notifyQueued(envelope: TFunctionInvocationEnvelope): Promise<void>;
  takeNext(
    request: Readonly<{
      cellId: string;
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
  start(prepared: TSandboxHandle, attempt: TFunctionAttempt): Promise<TSandboxHandle>;
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
  recordUsage(receipt: TUsageReceipt): Promise<void>;
}
