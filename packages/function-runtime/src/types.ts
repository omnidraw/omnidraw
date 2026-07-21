/**
 * @file Public short-lived function definition, invocation, lease, sandbox, and usage types.
 */

import type { TResourceRequirement } from '@vibecanvas/resource-runtime';
import type { TOrganizationId, TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TWidgetArtifactId,
  TWidgetDefinitionId,
  TWidgetRevisionId,
} from '@vibecanvas/widget-contract';

export type TFunctionId = string;
export type TFunctionName = string;
export type TFunctionInvocationId = string;
export type TFunctionAttemptId = string;

export type TFunctionMemoryTier = 'small' | 'medium' | 'large';
export type TInvocationStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';
export type TAttemptStatus =
  | 'starting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'lost';
export type TFailureOwner = 'user' | 'platform' | 'cancelled';

export type TFunctionLimits = Readonly<{
  timeoutMs: number;
  memoryTier: TFunctionMemoryTier;
  outputByteLimit: number;
  logByteLimit: number;
}>;

export type TFunctionRetryPolicy = Readonly<{
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}>;

export type TFunctionDefinition = Readonly<{
  orgId: TOrganizationId;
  id: TFunctionId;
  widgetDefinitionId: TWidgetDefinitionId;
  widgetRevisionId: TWidgetRevisionId;
  name: TFunctionName;
  definitionRevision: number;
  serverArtifactId: TWidgetArtifactId;
  artifactDigestSha256: string;
  runtimeAbi: string;
  inputSchema: unknown;
  outputSchema: unknown;
  resources: readonly TResourceRequirement[];
  limits: TFunctionLimits;
  retry: TFunctionRetryPolicy;
}>;

export type TFunctionInvocationEnvelope = Readonly<{
  id: TFunctionInvocationId;
  tenant: TTenantContext;
  widgetDefinitionId: TWidgetDefinitionId;
  widgetRevisionId: TWidgetRevisionId;
  widgetInstanceId: string;
  functionId: TFunctionId;
  functionName: TFunctionName;
  definitionRevision: number;
  artifactDigestSha256: string;
  input: unknown;
  inputDigestSha256: string;
  idempotencyKey: string;
  policyVersion: number;
  priority: number;
  limits: TFunctionLimits;
  retry: TFunctionRetryPolicy;
  createdAtMs: number;
  deadlineAtMs: number;
}>;

export type TFunctionFailure = Readonly<{
  owner: TFailureOwner;
  code: string;
  message: string;
  retryable: boolean;
}>;

export type TInvocationRecord = Readonly<{
  envelope: TFunctionInvocationEnvelope;
  status: TInvocationStatus;
  output: unknown | null;
  failure: TFunctionFailure | null;
  startedAtMs: number | null;
  finishedAtMs: number | null;
}>;

export type TFunctionAttempt = Readonly<{
  id: TFunctionAttemptId;
  invocationId: TFunctionInvocationId;
  attemptNumber: number;
  leaseEpoch: number;
  status: TAttemptStatus;
  sandboxDriver: string;
  memoryTier: TFunctionMemoryTier;
  failureOwner: TFailureOwner | null;
}>;

export type TInvocationLease = Readonly<{
  invocationId: TFunctionInvocationId;
  attemptId: TFunctionAttemptId;
  leaseEpoch: number;
  workerId: string;
  heartbeatAtMs: number;
  expiresAtMs: number;
}>;

export type TExecutorCapacityRequest = Readonly<{
  cellId: string;
  schedulingDomain: string;
  memoryTier: TFunctionMemoryTier;
}>;

export type TExecutorCapacityLease = Readonly<{
  id: string;
  cellId: string;
  schedulingDomain: string;
  memoryTier: TFunctionMemoryTier;
  expiresAtMs: number;
}>;

export type TSandboxHandle = Readonly<{
  driver: string;
  id: string;
}>;

export type TSandboxExecutionResult =
  | Readonly<{ status: 'succeeded'; output: unknown; outputByteSize: number; logByteSize: number }>
  | Readonly<{ status: 'failed'; failure: TFunctionFailure; outputByteSize: number; logByteSize: number }>;

export type TUsageMetrics = Readonly<{
  activeWallMs: number;
  cpuMs: number;
  allocatedMemoryByteMs: number;
  peakRssBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
}>;

export type TUsageReceipt = Readonly<{
  orgId: TOrganizationId;
  accountId: string;
  attemptId: TFunctionAttemptId;
  invocationId: TFunctionInvocationId;
  outcome: Extract<TAttemptStatus, 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'lost'>;
  failureOwner: TFailureOwner | null;
  billable: boolean;
  policyVersion: number;
  metrics: TUsageMetrics;
  createdAtMs: number;
}>;
