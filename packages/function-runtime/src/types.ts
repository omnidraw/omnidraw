/**
 * @file Public short-lived function definition, invocation, lease, sandbox, and usage types.
 */

import type { TOrganizationId, TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TWidgetArtifactId,
  TWidgetDefinitionId,
  TWidgetRevisionId,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionResourceAccess,
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
  mode: 'none' | 'idempotent';
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
  effect: 'fn' | 'fx' | 'tx';
  definitionRevision: number;
  serverArtifactId: TWidgetArtifactId;
  artifactDigestSha256: string;
  contractDigestSha256: string;
  descriptorDigestSha256: string;
  runtimeAbi: string;
  inputSchema: unknown;
  outputSchema: unknown;
  resources: readonly TWidgetServerFunctionResourceAccess[];
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
  contractDigestSha256: string;
  runtimeAbi: string;
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
  resultDigestSha256: string | null;
  outputByteSize: number;
  logByteSize: number;
  bodyState: 'full' | 'compacted';
  retainsRevision: boolean;
  cancelRequestedAtMs: number | null;
  availableAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  bodiesCompactedAtMs: number | null;
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
  failure: TFunctionFailure | null;
  metrics: TUsageMetrics;
  outputByteSize: number;
  logByteSize: number;
  coldStart: boolean;
  billable: boolean;
  createdAtMs: number;
  startedAtMs: number | null;
  guestCodeEnteredAtMs: number | null;
  finishedAtMs: number | null;
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

export type TSandboxStartRequest = Readonly<{
  deadlineAtMs: number;
  /** Publishes cumulative host-accounted usage while sandbox startup is still pending. */
  observeMetrics(metrics: TUsageMetrics): void;
  enterGuestCode(): Promise<void>;
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
  functionId: TFunctionId;
  definitionRevision: number;
  sandboxDriver: string;
  memoryTier: TFunctionMemoryTier;
  queuedAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number;
  coldStart: boolean;
  outcome: Extract<TAttemptStatus, 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'lost'>;
  failureOwner: TFailureOwner | null;
  billable: boolean;
  policyVersion: number;
  metrics: TUsageMetrics;
  createdAtMs: number;
}>;

export type TFunctionRevisionRegistration = Readonly<{
  widgetDefinitionId: TWidgetDefinitionId;
  widgetRevisionId: TWidgetRevisionId;
  definitionRevision: number;
  serverArtifactId: TWidgetArtifactId;
  artifactDigestSha256: string;
  contractDigestSha256: string;
  runtimeAbi: string;
  functions: readonly TWidgetServerFunctionDescriptor[];
  createdAtMs: number;
}>;

export type TInvocationIdempotencyScope =
  | Readonly<{ kind: 'organization' }>
  | Readonly<{ kind: 'canvas'; canvasId: string }>
  | Readonly<{ kind: 'widget_instance'; widgetInstanceId: string }>;

export type TInvocationCreateRequest = Readonly<{
  envelope: TFunctionInvocationEnvelope;
  idempotencyRecordId: string;
  idempotencyScope: TInvocationIdempotencyScope;
  requestFingerprintSha256: string;
  idempotencyExpiresAtMs: number | null;
}>;

export type TInvocationCreateResult =
  | Readonly<{ status: 'created'; invocation: TInvocationRecord }>
  | Readonly<{ status: 'replayed'; invocation: TInvocationRecord }>
  | Readonly<{
      status: 'conflict';
      invocationId: TFunctionInvocationId;
      reason: 'fingerprint_mismatch';
    }>;

export type TInvocationClaimRequest = Readonly<{
  /** Omit to atomically claim the next eligible invocation for the requested memory tiers. */
  invocationId?: TFunctionInvocationId;
  attemptId: TFunctionAttemptId;
  workerId: string;
  sandboxDriver: string;
  coldStart: boolean;
  memoryTiers?: readonly TFunctionMemoryTier[];
  nowMs: number;
  ttlMs: number;
}>;

export type TInvocationClaimResult =
  | Readonly<{ status: 'claimed'; attempt: TFunctionAttempt; lease: TInvocationLease }>
  | Readonly<{
      status: 'not_claimable';
      reason: 'missing' | 'state' | 'not_ready' | 'deadline' | 'cancelled' | 'lease_active';
    }>;

export type TInvocationLeaseMutationResult =
  | Readonly<{ status: 'updated'; attempt: TFunctionAttempt; lease: TInvocationLease }>
  | Readonly<{ status: 'stale' }>;

export type TInvocationHeartbeatRequest = Readonly<{
  lease: TInvocationLease;
  metrics: TUsageMetrics;
  nowMs: number;
  ttlMs: number;
}>;

export type TInvocationCancellationResult =
  | Readonly<{ status: 'requested'; invocation: TInvocationRecord }>
  | Readonly<{ status: 'cancelled'; invocation: TInvocationRecord }>
  | Readonly<{ status: 'already_terminal'; invocation: TInvocationRecord }>
  | Readonly<{ status: 'missing' }>;

export type TAttemptTerminalStatus = Extract<
  TAttemptStatus,
  'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'lost'
>;

export type TInvocationAttemptCompletionRequest = Readonly<{
  lease: TInvocationLease;
  status: Exclude<TAttemptTerminalStatus, 'lost'>;
  output: unknown | null;
  failure: TFunctionFailure | null;
  outputByteSize: number;
  logByteSize: number;
  metrics: TUsageMetrics;
  billable: boolean;
  nowMs: number;
}>;

export type TInvocationAttemptCompletionResult =
  | Readonly<{ status: 'terminal'; invocation: TInvocationRecord; attempt: TFunctionAttempt }>
  | Readonly<{
      status: 'requeued';
      invocation: TInvocationRecord;
      attempt: TFunctionAttempt;
      availableAtMs: number;
    }>
  | Readonly<{ status: 'already_completed'; invocation: TInvocationRecord; attempt: TFunctionAttempt }>
  | Readonly<{ status: 'stale' }>
  | Readonly<{ status: 'permit_active' }>;

export type TInvocationRecoveryRequest = Readonly<{
  nowMs: number;
  limit: number;
}>;

export type TInvocationRecoveryResult = Readonly<{
  recoveredInvocationIds: readonly TFunctionInvocationId[];
}>;

export type TResourceWritePermitStatus = 'active' | 'consumed' | 'revoked' | 'expired';

export type TResourceWritePermit = Readonly<{
  orgId: TOrganizationId;
  id: string;
  resourceId: string;
  invocationId: TFunctionInvocationId;
  attemptId: TFunctionAttemptId;
  leaseEpoch: number;
  operationName: string;
  operationId: string;
  operationFingerprintSha256: string;
  status: TResourceWritePermitStatus;
  result: unknown | null;
  resultDigestSha256: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number | null;
}>;

export type TResourceWritePermitAcquireRequest = Readonly<{
  id: string;
  resourceId: string;
  invocationId: TFunctionInvocationId;
  attemptId: TFunctionAttemptId;
  leaseEpoch: number;
  operationName: string;
  operationId: string;
  operationFingerprintSha256: string;
  nowMs: number;
  ttlMs: number;
}>;

export type TResourceWritePermitAcquireResult =
  | Readonly<{ status: 'acquired'; permit: TResourceWritePermit }>
  | Readonly<{ status: 'replayed'; permit: TResourceWritePermit }>
  | Readonly<{ status: 'conflict'; permit: TResourceWritePermit }>
  | Readonly<{ status: 'stale' }>;

export type TResourceWritePermitConsumeRequest = Readonly<{
  permitId: string;
  invocationId: TFunctionInvocationId;
  attemptId: TFunctionAttemptId;
  leaseEpoch: number;
  result: unknown;
  outcome: TAttemptTerminalStatus;
  failureOwner: TFailureOwner | null;
  billable: boolean;
  metrics: TUsageMetrics;
  committedAtMs: number;
  recordedAtMs: number;
}>;

export type TResourceWritePermitConsumeResult =
  | Readonly<{ status: 'consumed'; permit: TResourceWritePermit }>
  | Readonly<{ status: 'replayed'; permit: TResourceWritePermit }>
  | Readonly<{ status: 'stale' }>;

export type TUsageOutboxState = 'pending' | 'importing' | 'imported' | 'error';

export type TUsageOutboxRecord = Readonly<{
  id: string;
  orgId: TOrganizationId;
  accountId: string;
  attemptId: TFunctionAttemptId | null;
  invocationId: TFunctionInvocationId;
  functionId: TFunctionId;
  definitionRevision: number;
  sandboxDriver: string;
  memoryTier: TFunctionMemoryTier;
  queuedAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number;
  coldStart: boolean;
  resourceId: string | null;
  resourcePermitId: string | null;
  state: TUsageOutboxState;
  outcome: TAttemptTerminalStatus;
  failureOwner: TFailureOwner | null;
  billable: boolean;
  policyVersion: number;
  metrics: TUsageMetrics;
  createdAtMs: number;
  importedAtMs: number | null;
}>;

export type TTerminalHistoryCompactionRequest = Readonly<{
  nowMs: number;
  bodiesBeforeMs: number;
  releaseRevisionPinsBeforeMs: number;
  limit: number;
}>;

export type TTerminalHistoryCompactionResult = Readonly<{
  compactedInvocationIds: readonly TFunctionInvocationId[];
  releasedRevisionInvocationIds: readonly TFunctionInvocationId[];
  deletedIdempotencyRecords: number;
}>;
