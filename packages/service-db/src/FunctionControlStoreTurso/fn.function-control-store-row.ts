import type {
  TFunctionAttempt,
  TFunctionDefinition,
  TFunctionFailure,
  TInvocationLease,
  TInvocationRecord,
  TResourceWritePermit,
  TUsageMetrics,
  TUsageOutboxRecord,
} from '@vibecanvas/function-runtime';
import type { TWidgetServerFunctionResourceAccess } from '@vibecanvas/widget-contract';

function safeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`Stored ${label} is invalid.`);
  }
  return parsed;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : safeInteger(value, label);
}

function parseJson<T>(value: unknown, label: string): T {
  if (typeof value !== 'string') throw new TypeError(`Stored ${label} is invalid.`);
  return JSON.parse(value) as T;
}

function nullableJson<T>(value: unknown, label: string): T | null {
  return value === null || value === undefined ? null : parseJson<T>(value, label);
}

function metrics(row: Record<string, unknown>): TUsageMetrics {
  return {
    activeWallMs: safeInteger(row.active_wall_ms, 'active wall milliseconds'),
    cpuMs: safeInteger(row.cpu_ms, 'CPU milliseconds'),
    allocatedMemoryByteMs: safeInteger(
      row.allocated_memory_byte_ms,
      'allocated memory byte milliseconds',
    ),
    peakRssBytes: safeInteger(row.peak_rss_bytes, 'peak RSS bytes'),
    diskReadBytes: safeInteger(row.disk_read_bytes, 'disk read bytes'),
    diskWriteBytes: safeInteger(row.disk_write_bytes, 'disk write bytes'),
    networkRxBytes: safeInteger(row.network_rx_bytes, 'network receive bytes'),
    networkTxBytes: safeInteger(row.network_tx_bytes, 'network transmit bytes'),
  };
}

export function fnFunctionControlStoreDefinition(row: unknown): TFunctionDefinition {
  const value = row as Record<string, unknown>;
  return {
    orgId: String(value.org_id),
    id: String(value.id),
    widgetDefinitionId: String(value.widget_definition_id),
    widgetRevisionId: String(value.widget_revision_id),
    name: String(value.export_name),
    effect: value.effect as TFunctionDefinition['effect'],
    definitionRevision: safeInteger(value.definition_revision, 'function definition revision'),
    serverArtifactId: String(value.server_artifact_id),
    artifactDigestSha256: String(value.artifact_digest_sha256),
    contractDigestSha256: String(value.contract_digest_sha256),
    descriptorDigestSha256: String(value.descriptor_digest_sha256),
    runtimeAbi: String(value.runtime_abi),
    inputSchema: parseJson(value.input_schema_json, 'function input schema'),
    outputSchema: parseJson(value.output_schema_json, 'function output schema'),
    resources: parseJson<readonly TWidgetServerFunctionResourceAccess[]>(
      value.resources_json,
      'function resource accesses',
    ),
    limits: {
      timeoutMs: safeInteger(value.timeout_ms, 'function timeout'),
      memoryTier: value.memory_tier as TFunctionDefinition['limits']['memoryTier'],
      outputByteLimit: safeInteger(value.output_byte_limit, 'function output byte limit'),
      logByteLimit: safeInteger(value.log_byte_limit, 'function log byte limit'),
    },
    retry: {
      mode: value.retry_mode as TFunctionDefinition['retry']['mode'],
      maxAttempts: safeInteger(value.max_attempts, 'function maximum attempts'),
      initialBackoffMs: safeInteger(value.initial_backoff_ms, 'function initial backoff'),
      maxBackoffMs: safeInteger(value.max_backoff_ms, 'function maximum backoff'),
    },
  };
}

export function fnFunctionControlStoreInvocation(row: unknown): TInvocationRecord {
  const value = row as Record<string, unknown>;
  const bodyState = value.body_state as TInvocationRecord['bodyState'];
  if (
    value.subject_kind !== 'widget_instance'
    && value.subject_kind !== 'widget_preview'
  ) {
    throw new TypeError('Stored function invocation subject kind is invalid.');
  }
  const subject = {
    kind: value.subject_kind as 'widget_instance' | 'widget_preview',
    canvasId: String(value.canvas_id),
    widgetInstanceId: String(value.widget_instance_id),
  };
  return {
    envelope: {
      id: String(value.id),
      tenant: {
        orgId: String(value.org_id),
        accountId: String(value.account_id),
        cellId: String(value.tenant_cell_id),
        placementEpoch: safeInteger(value.tenant_placement_epoch, 'tenant placement epoch'),
        roles: parseJson<readonly string[]>(value.tenant_roles_json, 'tenant roles'),
        capabilities: parseJson<readonly string[]>(
          value.tenant_capabilities_json,
          'tenant capabilities',
        ),
        requestId: String(value.tenant_request_id),
        ...(value.canvas_id === null || value.canvas_id === undefined
          ? {}
          : { canvasId: String(value.canvas_id) }),
        invocationId: String(value.id),
      },
      widgetDefinitionId: String(value.widget_definition_id),
      widgetRevisionId: String(value.widget_revision_id),
      subject,
      functionId: String(value.function_id),
      functionName: String(value.function_name),
      definitionRevision: safeInteger(value.definition_revision, 'invocation definition revision'),
      artifactDigestSha256: String(value.artifact_digest_sha256),
      contractDigestSha256: String(value.contract_digest_sha256),
      runtimeAbi: String(value.runtime_abi),
      input: bodyState === 'compacted'
        ? null
        : parseJson(value.input_json, 'invocation input'),
      inputDigestSha256: String(value.input_digest_sha256),
      idempotencyKey: String(value.idempotency_key),
      policyVersion: safeInteger(value.policy_version, 'invocation policy version'),
      priority: safeInteger(value.priority, 'invocation priority'),
      limits: {
        timeoutMs: safeInteger(value.timeout_ms, 'invocation timeout'),
        memoryTier: value.memory_tier as TInvocationRecord['envelope']['limits']['memoryTier'],
        outputByteLimit: safeInteger(value.output_byte_limit, 'invocation output byte limit'),
        logByteLimit: safeInteger(value.log_byte_limit, 'invocation log byte limit'),
      },
      retry: {
        mode: value.retry_mode as TInvocationRecord['envelope']['retry']['mode'],
        maxAttempts: safeInteger(value.max_attempts, 'invocation maximum attempts'),
        initialBackoffMs: safeInteger(value.initial_backoff_ms, 'invocation initial backoff'),
        maxBackoffMs: safeInteger(value.max_backoff_ms, 'invocation maximum backoff'),
      },
      createdAtMs: safeInteger(value.created_at_ms, 'invocation created timestamp'),
      deadlineAtMs: safeInteger(value.deadline_at_ms, 'invocation deadline'),
    },
    status: value.status as TInvocationRecord['status'],
    output: nullableJson(value.result_json, 'invocation result'),
    failure: nullableJson<TFunctionFailure>(value.failure_json, 'invocation failure'),
    resultDigestSha256: value.result_digest_sha256 === null
      ? null
      : String(value.result_digest_sha256),
    outputByteSize: safeInteger(value.output_byte_size, 'invocation output byte size'),
    logByteSize: safeInteger(value.log_byte_size, 'invocation log byte size'),
    bodyState,
    retainsRevision: value.retains_revision === 1 || value.retains_revision === true,
    cancelRequestedAtMs: nullableInteger(
      value.cancel_requested_at_ms,
      'invocation cancellation timestamp',
    ),
    availableAtMs: safeInteger(value.available_at_ms, 'invocation availability timestamp'),
    startedAtMs: nullableInteger(value.started_at_ms, 'invocation started timestamp'),
    finishedAtMs: nullableInteger(value.finished_at_ms, 'invocation finished timestamp'),
    bodiesCompactedAtMs: nullableInteger(
      value.bodies_compacted_at_ms,
      'invocation compaction timestamp',
    ),
  };
}

export function fnFunctionControlStoreAttempt(row: unknown): TFunctionAttempt {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.id),
    invocationId: String(value.invocation_id),
    attemptNumber: safeInteger(value.attempt_number, 'attempt number'),
    leaseEpoch: safeInteger(value.lease_epoch, 'attempt lease epoch'),
    status: value.status as TFunctionAttempt['status'],
    sandboxDriver: String(value.sandbox_driver),
    memoryTier: value.memory_tier as TFunctionAttempt['memoryTier'],
    failureOwner: value.failure_owner === null ? null : value.failure_owner as TFunctionAttempt['failureOwner'],
    failure: nullableJson<TFunctionFailure>(value.failure_json, 'attempt failure'),
    metrics: metrics(value),
    outputByteSize: safeInteger(value.output_byte_size, 'attempt output byte size'),
    logByteSize: safeInteger(value.log_byte_size, 'attempt log byte size'),
    coldStart: value.cold_start === 1 || value.cold_start === true,
    billable: value.billable === 1 || value.billable === true,
    createdAtMs: safeInteger(value.created_at_ms, 'attempt created timestamp'),
    startedAtMs: nullableInteger(value.started_at_ms, 'attempt started timestamp'),
    guestCodeEnteredAtMs: nullableInteger(
      value.guest_code_entered_at_ms,
      'attempt guest-code entry timestamp',
    ),
    finishedAtMs: nullableInteger(value.finished_at_ms, 'attempt finished timestamp'),
  };
}

export function fnFunctionControlStoreLease(row: unknown): TInvocationLease {
  const value = row as Record<string, unknown>;
  return {
    invocationId: String(value.invocation_id),
    attemptId: String(value.attempt_id),
    leaseEpoch: safeInteger(value.lease_epoch, 'lease epoch'),
    workerId: String(value.worker_id),
    heartbeatAtMs: safeInteger(value.heartbeat_at_ms, 'lease heartbeat timestamp'),
    expiresAtMs: safeInteger(value.expires_at_ms, 'lease expiry timestamp'),
  };
}

export function fnFunctionControlStorePermit(row: unknown): TResourceWritePermit {
  const value = row as Record<string, unknown>;
  return {
    orgId: String(value.org_id),
    id: String(value.id),
    resourceId: String(value.resource_id),
    invocationId: String(value.invocation_id),
    attemptId: String(value.attempt_id),
    leaseEpoch: safeInteger(value.lease_epoch, 'permit lease epoch'),
    operationName: String(value.operation_name),
    operationId: String(value.operation_id),
    operationFingerprintSha256: String(value.operation_fingerprint_sha256),
    status: value.status as TResourceWritePermit['status'],
    result: nullableJson(value.result_json, 'permit result'),
    resultDigestSha256: value.result_digest_sha256 === null
      ? null
      : String(value.result_digest_sha256),
    issuedAtMs: safeInteger(value.issued_at_ms, 'permit issued timestamp'),
    expiresAtMs: safeInteger(value.expires_at_ms, 'permit expiry timestamp'),
    consumedAtMs: nullableInteger(value.consumed_at_ms, 'permit consumed timestamp'),
  };
}

export function fnFunctionControlStoreUsage(row: unknown): TUsageOutboxRecord {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.id),
    orgId: String(value.org_id),
    accountId: String(value.account_id),
    attemptId: value.attempt_id === null ? null : String(value.attempt_id),
    invocationId: String(value.invocation_id),
    functionId: String(value.function_id),
    definitionRevision: safeInteger(value.definition_revision, 'usage definition revision'),
    sandboxDriver: String(value.sandbox_driver),
    memoryTier: value.memory_tier as TUsageOutboxRecord['memoryTier'],
    queuedAtMs: safeInteger(value.queued_at_ms, 'usage queued timestamp'),
    startedAtMs: nullableInteger(value.started_at_ms, 'usage started timestamp'),
    finishedAtMs: safeInteger(value.finished_at_ms, 'usage finished timestamp'),
    coldStart: value.cold_start === 1 || value.cold_start === true,
    resourceId: value.resource_id === null ? null : String(value.resource_id),
    resourcePermitId: value.resource_permit_id === null
      ? null
      : String(value.resource_permit_id),
    state: value.state as TUsageOutboxRecord['state'],
    outcome: value.outcome as TUsageOutboxRecord['outcome'],
    failureOwner: value.failure_owner === null
      ? null
      : value.failure_owner as TUsageOutboxRecord['failureOwner'],
    billable: value.billable === 1 || value.billable === true,
    policyVersion: safeInteger(value.policy_version, 'usage policy version'),
    metrics: metrics(value),
    createdAtMs: safeInteger(value.created_at_ms, 'usage created timestamp'),
    importedAtMs: nullableInteger(value.imported_at_ms, 'usage imported timestamp'),
  };
}
