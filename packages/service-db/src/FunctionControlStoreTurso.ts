import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Database } from '@tursodatabase/database';
import {
  FUNCTION_PLATFORM_PRE_GUEST_MAX_ATTEMPTS,
  fnFunctionAttemptShouldRetry,
  fnFunctionRetryDelayMs,
} from '@vibecanvas/function-runtime';
import type {
  IFunctionControlStore,
  IScheduler,
  TFunctionAttempt,
  TFunctionDefinition,
  TFunctionFailure,
  TFunctionInvocationId,
  TFunctionRevisionRegistration,
  TInvocationAttemptCompletionRequest,
  TInvocationAttemptCompletionResult,
  TInvocationCancellationResult,
  TInvocationClaimRequest,
  TInvocationClaimResult,
  TInvocationCreateRequest,
  TInvocationCreateResult,
  TInvocationHeartbeatRequest,
  TInvocationLease,
  TInvocationLeaseMutationResult,
  TInvocationRecord,
  TInvocationRecoveryRequest,
  TInvocationRecoveryResult,
  TResourceWritePermit,
  TResourceWritePermitAcquireRequest,
  TResourceWritePermitAcquireResult,
  TResourceWritePermitConsumeRequest,
  TResourceWritePermitConsumeResult,
  TTerminalHistoryCompactionRequest,
  TTerminalHistoryCompactionResult,
  TUsageMetrics,
  TUsageOutboxRecord,
  TUsageOutboxState,
} from '@vibecanvas/function-runtime';
import type {
  TCommittedResourceWrite,
  IResourceWritePermitCoordinator,
  IResourceWritePermitGuard,
  TResourceWritePermitRecoveryCandidate,
  TResourceWritePermitRecoveryResult,
  TResourceWritePermitScope,
} from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptor,
} from '@vibecanvas/widget-contract';
import { fnFunctionCanonicalJson } from './FunctionControlStoreTurso/fn.function-json';
import {
  fnFunctionControlStoreAttempt,
  fnFunctionControlStoreDefinition,
  fnFunctionControlStoreInvocation,
  fnFunctionControlStoreLease,
  fnFunctionControlStorePermit,
  fnFunctionControlStoreUsage,
} from './FunctionControlStoreTurso/fn.function-control-store-row';
import { fnFunctionId } from './FunctionControlStoreTurso/fn.function-id';
import { txRunDatabaseTransaction } from './tx.run-database-transaction';

type TTransactionScope = { active: boolean; orgId: string };
type TStoredInvocationBundle = Readonly<{
  invocation: TInvocationRecord;
  attempt: TFunctionAttempt;
}>;

const TERMINAL_INVOCATION_STATUSES = ['succeeded', 'failed', 'cancelled', 'timed_out'] as const;
const FUNCTION_CONTROL_STORE_MAX_BATCH = 500;
const ZERO_METRICS: TUsageMetrics = {
  activeWallMs: 0,
  cpuMs: 0,
  allocatedMemoryByteMs: 0,
  peakRssBytes: 0,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
};

function functionStoreError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function terminalFailure(
  owner: TFunctionFailure['owner'],
  code: string,
  message: string,
  retryable: boolean,
): TFunctionFailure {
  return { owner, code, message, retryable };
}

/** Turso-backed atomic control plane for short-lived managed function executions. */
export class FunctionControlStoreTurso implements
  IFunctionControlStore,
  IScheduler,
  IResourceWritePermitCoordinator {
  readonly #transactionScope = new AsyncLocalStorage<TTransactionScope>();
  readonly #nowMs: () => number;

  constructor(
    private readonly database: Database,
    options: Readonly<{ nowMs?: () => number }> = {},
  ) {
    this.#nowMs = options.nowMs ?? Date.now;
  }

  async registerFunctionsForRevision(
    tenant: TTenantContext,
    registration: TFunctionRevisionRegistration,
  ): Promise<readonly TFunctionDefinition[]> {
    const canonicalDescriptors = fnCanonicalizeWidgetServerFunctionDescriptors(
      registration.functions,
    );
    const descriptorsDigest = sha256(canonicalDescriptors);
    const revision = await (await this.database.prepare(`
      SELECT definition_id, revision_number, server_artifact_id,
        contract_digest_sha256, function_descriptors_json,
        function_descriptors_digest_sha256, manifest_json
      FROM widget_definition_revisions
      WHERE org_id = ? AND definition_id = ? AND id = ?
    `)).get(tenant.orgId, registration.widgetDefinitionId, registration.widgetRevisionId) as
      | Record<string, unknown>
      | undefined;
    if (!revision) {
      throw functionStoreError('FUNCTION_REVISION_NOT_FOUND', 'Widget revision was not found.');
    }
    const runtimeAbi = JSON.parse(String(revision.manifest_json))?.server?.runtimeAbi;
    if (
      Number(revision.revision_number) !== registration.definitionRevision
      || String(revision.server_artifact_id) !== registration.serverArtifactId
      || String(revision.contract_digest_sha256) !== registration.contractDigestSha256
      || String(revision.function_descriptors_json) !== canonicalDescriptors
      || String(revision.function_descriptors_digest_sha256) !== descriptorsDigest
      || runtimeAbi !== registration.runtimeAbi
    ) {
      throw functionStoreError(
        'FUNCTION_REVISION_REGISTRATION_CONFLICT',
        'Function registration does not match the immutable widget revision.',
      );
    }
    const artifact = await (await this.database.prepare(`
      SELECT digest_sha256
      FROM artifact_references
      WHERE org_id = ? AND id = ? AND kind = 'server'
    `)).get(tenant.orgId, registration.serverArtifactId) as Record<string, unknown> | undefined;
    if (!artifact || String(artifact.digest_sha256) !== registration.artifactDigestSha256) {
      throw functionStoreError(
        'FUNCTION_ARTIFACT_REGISTRATION_CONFLICT',
        'Function registration does not match the immutable server artifact.',
      );
    }

    const rows = await (await this.database.prepare(`
      SELECT *
      FROM function_definitions
      WHERE org_id = ? AND widget_definition_id = ? AND widget_revision_id = ?
      ORDER BY export_name ASC
    `)).all(tenant.orgId, registration.widgetDefinitionId, registration.widgetRevisionId);
    const definitions = rows.map(fnFunctionControlStoreDefinition);
    const normalized = [...registration.functions]
      .map(fnNormalizeWidgetServerFunctionDescriptor)
      .sort((left, right) => left.exportName.localeCompare(right.exportName));
    if (definitions.length !== normalized.length) {
      throw functionStoreError(
        'FUNCTION_DEFINITION_REGISTRATION_CONFLICT',
        'Stored function definitions do not match the immutable descriptor set.',
      );
    }
    for (let index = 0; index < normalized.length; index += 1) {
      const descriptor = normalized[index]!;
      const definition = definitions[index]!;
      const descriptorDigest = sha256(fnFunctionCanonicalJson(descriptor));
      if (
        definition.id !== fnFunctionId(registration.widgetDefinitionId, descriptor.exportName)
        || definition.name !== descriptor.exportName
        || definition.effect !== descriptor.effect
        || definition.definitionRevision !== registration.definitionRevision
        || definition.serverArtifactId !== registration.serverArtifactId
        || definition.artifactDigestSha256 !== registration.artifactDigestSha256
        || definition.contractDigestSha256 !== registration.contractDigestSha256
        || definition.descriptorDigestSha256 !== descriptorDigest
        || definition.runtimeAbi !== registration.runtimeAbi
        || fnFunctionCanonicalJson(definition.inputSchema) !== fnFunctionCanonicalJson(descriptor.inputSchema)
        || fnFunctionCanonicalJson(definition.outputSchema) !== fnFunctionCanonicalJson(descriptor.outputSchema)
        || fnFunctionCanonicalJson(definition.resources) !== fnFunctionCanonicalJson(descriptor.resources)
        || fnFunctionCanonicalJson(definition.limits) !== fnFunctionCanonicalJson(descriptor.limits)
        || fnFunctionCanonicalJson(definition.retry) !== fnFunctionCanonicalJson(descriptor.retry)
      ) {
        throw functionStoreError(
          'FUNCTION_DEFINITION_REGISTRATION_CONFLICT',
          `Stored function definition '${descriptor.exportName}' does not match its descriptor.`,
        );
      }
    }
    return definitions;
  }

  async resolveFunction(
    tenant: TTenantContext,
    request: Readonly<{ widgetRevisionId: string; functionName: string }>,
  ): Promise<TFunctionDefinition | null> {
    const row = await (await this.database.prepare(`
      SELECT *
      FROM function_definitions
      WHERE org_id = ? AND widget_revision_id = ? AND export_name = ?
    `)).get(tenant.orgId, request.widgetRevisionId, request.functionName);
    return row ? fnFunctionControlStoreDefinition(row) : null;
  }

  async createOrReplayInvocation(
    tenant: TTenantContext,
    request: TInvocationCreateRequest,
  ): Promise<TInvocationCreateResult> {
    return this.#runImmediate(tenant, async () => {
      const envelope = request.envelope;
      if (!Number.isSafeInteger(envelope.priority) || envelope.priority < 0 || envelope.priority > 100) {
        throw new TypeError('Function invocation priority must be an integer between 0 and 100.');
      }
      this.#assertEnvelopeTenant(tenant, envelope.tenant, envelope.id);
      const inputJson = fnFunctionCanonicalJson(envelope.input);
      if (sha256(inputJson) !== envelope.inputDigestSha256) {
        throw functionStoreError(
          'FUNCTION_INPUT_DIGEST_MISMATCH',
          'Invocation input does not match its immutable digest.',
        );
      }
      const definition = await this.#getDefinitionById(
        tenant,
        envelope.widgetDefinitionId,
        envelope.widgetRevisionId,
        envelope.functionId,
      );
      if (!definition || !this.#definitionMatchesEnvelope(definition, envelope)) {
        throw functionStoreError(
          'FUNCTION_INVOCATION_AUTHORITY_MISMATCH',
          'Invocation authority snapshot does not match an immutable function definition.',
        );
      }
      if (envelope.deadlineAtMs < envelope.createdAtMs
        || envelope.deadlineAtMs > envelope.createdAtMs + envelope.limits.timeoutMs) {
        throw new TypeError('Invocation deadline exceeds its immutable timeout ceiling.');
      }
      const instance = await (await this.database.prepare(`
        SELECT instance.canvas_id
        FROM widget_instances AS instance
        INNER JOIN canvas_members AS member
          ON member.org_id = instance.org_id
          AND member.canvas_id = instance.canvas_id
          AND member.account_id = ?
        INNER JOIN collaboration_documents AS canvas_document
          ON canvas_document.org_id = instance.org_id
          AND canvas_document.canvas_id = instance.canvas_id
          AND canvas_document.widget_instance_id IS NULL
        INNER JOIN widget_instance_projection_heads AS projection_head
          ON projection_head.org_id = canvas_document.org_id
          AND projection_head.canvas_id = canvas_document.canvas_id
          AND projection_head.source_sequence = canvas_document.content_version
        WHERE instance.org_id = ? AND instance.definition_id = ?
          AND instance.revision_id = ? AND instance.id = ?
          AND instance.status = 'active'
          AND (? IS NULL OR instance.canvas_id = ?)
      `)).get(
        tenant.accountId,
        tenant.orgId,
        envelope.widgetDefinitionId,
        envelope.widgetRevisionId,
        envelope.widgetInstanceId,
        tenant.canvasId ?? null,
        tenant.canvasId ?? null,
      ) as Record<string, unknown> | undefined;
      if (!instance) {
        throw functionStoreError('FUNCTION_WIDGET_INSTANCE_NOT_FOUND', 'Widget instance was not found.');
      }
      const canvasId = String(instance.canvas_id);
      this.#assertIdempotencyScope(request, envelope.widgetInstanceId, canvasId);
      await this.#deleteExpiredIdempotencyKey(tenant, request, envelope.createdAtMs);
      const existing = await this.#findIdempotencyRecord(tenant, request);
      if (existing) {
        const existingInvocation = await this.getInvocation(
          tenant,
          String(existing.invocation_id),
        );
        if (!existingInvocation) {
          throw new Error('Idempotency record references a missing invocation.');
        }
        if (
          existingInvocation.envelope.tenant.accountId !== tenant.accountId
          || String(existing.request_fingerprint_sha256) !== request.requestFingerprintSha256
        ) {
          return {
            status: 'conflict',
            invocationId: String(existing.invocation_id),
            reason: 'fingerprint_mismatch',
          };
        }
        return { status: 'replayed', invocation: existingInvocation };
      }

      await (await this.database.prepare(`
        INSERT INTO function_invocations (
          org_id, id, account_id, canvas_id, widget_definition_id, widget_revision_id,
          widget_instance_id, function_id, function_name, definition_revision,
          artifact_digest_sha256, contract_digest_sha256, runtime_abi,
          tenant_cell_id, tenant_placement_epoch, tenant_request_id,
          tenant_roles_json, tenant_capabilities_json, input_json,
          input_digest_sha256, idempotency_key, policy_version, priority,
          timeout_ms, memory_tier, output_byte_limit, log_byte_limit,
          retry_mode, max_attempts, initial_backoff_ms, max_backoff_ms,
          status, result_json, failure_json, result_digest_sha256,
          output_byte_size, log_byte_size, body_state, retains_revision,
          created_at_ms, available_at_ms, deadline_at_ms, cancel_requested_at_ms,
          started_at_ms, finished_at_ms, bodies_compacted_at_ms
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, 0, 0, 'full', 1,
          ?, ?, ?, NULL, NULL, NULL, NULL
        )
      `)).run(
        tenant.orgId,
        envelope.id,
        tenant.accountId,
        canvasId,
        envelope.widgetDefinitionId,
        envelope.widgetRevisionId,
        envelope.widgetInstanceId,
        envelope.functionId,
        envelope.functionName,
        envelope.definitionRevision,
        envelope.artifactDigestSha256,
        envelope.contractDigestSha256,
        envelope.runtimeAbi,
        tenant.cellId,
        tenant.placementEpoch,
        tenant.requestId,
        fnFunctionCanonicalJson(tenant.roles),
        fnFunctionCanonicalJson(tenant.capabilities),
        inputJson,
        envelope.inputDigestSha256,
        envelope.idempotencyKey,
        envelope.policyVersion,
        envelope.priority,
        envelope.limits.timeoutMs,
        envelope.limits.memoryTier,
        envelope.limits.outputByteLimit,
        envelope.limits.logByteLimit,
        envelope.retry.mode,
        envelope.retry.maxAttempts,
        envelope.retry.initialBackoffMs,
        envelope.retry.maxBackoffMs,
        envelope.createdAtMs,
        envelope.createdAtMs,
        envelope.deadlineAtMs,
      );
      const scope = request.idempotencyScope;
      await (await this.database.prepare(`
        INSERT INTO idempotency_records (
          org_id, id, function_id, scope_kind, canvas_id, widget_instance_id,
          idempotency_key, request_fingerprint_sha256, widget_definition_id,
          widget_revision_id, invocation_id, created_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)).run(
        tenant.orgId,
        request.idempotencyRecordId,
        envelope.functionId,
        scope.kind,
        scope.kind === 'canvas' ? scope.canvasId : null,
        scope.kind === 'widget_instance' ? scope.widgetInstanceId : null,
        envelope.idempotencyKey,
        request.requestFingerprintSha256,
        envelope.widgetDefinitionId,
        envelope.widgetRevisionId,
        envelope.id,
        envelope.createdAtMs,
        request.idempotencyExpiresAtMs,
      );
      const invocation = await this.getInvocation(tenant, envelope.id);
      if (!invocation) throw new Error('Failed to create function invocation.');
      return { status: 'created', invocation };
    });
  }

  async getInvocation(
    tenant: TTenantContext,
    invocationId: TFunctionInvocationId,
  ): Promise<TInvocationRecord | null> {
    const row = await (await this.database.prepare(`
      SELECT * FROM function_invocations WHERE org_id = ? AND id = ?
    `)).get(tenant.orgId, invocationId);
    return row ? fnFunctionControlStoreInvocation(row) : null;
  }

  async listAttempts(
    tenant: TTenantContext,
    invocationId: TFunctionInvocationId,
  ): Promise<readonly TFunctionAttempt[]> {
    const rows = await (await this.database.prepare(`
      SELECT * FROM function_attempts
      WHERE org_id = ? AND invocation_id = ?
      ORDER BY attempt_number ASC
    `)).all(tenant.orgId, invocationId);
    return rows.map(fnFunctionControlStoreAttempt);
  }

  /** The durable queue is already the notification source; this is intentionally wake-neutral. */
  async notifyQueued(): Promise<void> {}

  async takeNext(
    request: Readonly<{
      orgId: string;
      cellId: string;
      placementEpoch: number;
      workerId: string;
      memoryTiers: readonly TFunctionDefinition['limits']['memoryTier'][];
    }>,
  ): Promise<TInvocationRecord['envelope'] | null> {
    if (request.memoryTiers.length === 0) return null;
    if (request.workerId.trim().length === 0) throw new TypeError('Worker id is required.');
    const nowMs = this.#nowMs();
    const row = await (await this.database.prepare(`
      SELECT invocation.* FROM function_invocations AS invocation
      WHERE invocation.org_id = ? AND invocation.tenant_cell_id = ?
        AND invocation.tenant_placement_epoch = ? AND invocation.status = 'queued'
        AND invocation.cancel_requested_at_ms IS NULL
        AND invocation.available_at_ms <= ? AND invocation.deadline_at_ms > ?
        AND invocation.memory_tier IN (${request.memoryTiers.map(() => '?').join(', ')})
      ORDER BY invocation.priority DESC, invocation.available_at_ms ASC,
        invocation.created_at_ms ASC, invocation.id ASC
      LIMIT 1
    `)).get(
      request.orgId,
      request.cellId,
      request.placementEpoch,
      nowMs,
      nowMs,
      ...request.memoryTiers,
    );
    return row ? fnFunctionControlStoreInvocation(row).envelope : null;
  }

  async claim(
    tenant: TTenantContext,
    request: TInvocationClaimRequest,
  ): Promise<TInvocationClaimResult> {
    return this.#runImmediate(tenant, async () => {
      this.#positiveTtl(request.ttlMs);
      const tiers = request.memoryTiers ?? ['small', 'medium', 'large'];
      if (tiers.length === 0) return { status: 'not_claimable', reason: 'not_ready' };
      const row = request.invocationId
        ? await (await this.database.prepare(`
            SELECT * FROM function_invocations WHERE org_id = ? AND id = ?
          `)).get(tenant.orgId, request.invocationId)
        : await (await this.database.prepare(`
            SELECT * FROM function_invocations
            WHERE org_id = ? AND status = 'queued' AND cancel_requested_at_ms IS NULL
              AND account_id = ? AND tenant_cell_id = ? AND tenant_placement_epoch = ?
              AND available_at_ms <= ? AND deadline_at_ms > ?
              AND memory_tier IN (${tiers.map(() => '?').join(', ')})
            ORDER BY priority DESC, available_at_ms ASC, created_at_ms ASC, id ASC
            LIMIT 1
          `)).get(
            tenant.orgId,
            tenant.accountId,
            tenant.cellId,
            tenant.placementEpoch,
            request.nowMs,
            request.nowMs,
            ...tiers,
          );
      if (!row) return { status: 'not_claimable', reason: 'missing' };
      const invocationId = String((row as Record<string, unknown>).id);
      const status = String((row as Record<string, unknown>).status);
      if (
        String((row as Record<string, unknown>).account_id) !== tenant.accountId
        || String((row as Record<string, unknown>).tenant_cell_id) !== tenant.cellId
        || Number((row as Record<string, unknown>).tenant_placement_epoch) !== tenant.placementEpoch
      ) return { status: 'not_claimable', reason: 'state' };
      if (status !== 'queued') return { status: 'not_claimable', reason: 'state' };
      if (Number((row as Record<string, unknown>).cancel_requested_at_ms ?? -1) >= 0) {
        return { status: 'not_claimable', reason: 'cancelled' };
      }
      if (Number((row as Record<string, unknown>).available_at_ms) > request.nowMs) {
        return { status: 'not_claimable', reason: 'not_ready' };
      }
      if (Number((row as Record<string, unknown>).deadline_at_ms) <= request.nowMs) {
        await this.#timeoutQueuedInvocation(tenant, invocationId, request.nowMs);
        return { status: 'not_claimable', reason: 'deadline' };
      }
      const activeLease = await (await this.database.prepare(`
        SELECT 1 FROM invocation_leases WHERE org_id = ? AND invocation_id = ?
      `)).get(tenant.orgId, invocationId);
      if (activeLease) return { status: 'not_claimable', reason: 'lease_active' };
      const counters = await (await this.database.prepare(`
        SELECT coalesce(max(attempt_number), 0) + 1 AS attempt_number,
          coalesce(max(lease_epoch), 0) + 1 AS lease_epoch
        FROM function_attempts WHERE org_id = ? AND invocation_id = ?
      `)).get(tenant.orgId, invocationId) as Record<string, unknown>;
      const attemptNumber = Number(counters.attempt_number);
      const leaseEpoch = Number(counters.lease_epoch);
      const expiresAtMs = Math.min(
        Number((row as Record<string, unknown>).deadline_at_ms),
        request.nowMs + request.ttlMs,
      );
      if (expiresAtMs <= request.nowMs) return { status: 'not_claimable', reason: 'deadline' };
      const updated = await (await this.database.prepare(`
        UPDATE function_invocations SET status = 'claimed'
        WHERE org_id = ? AND id = ? AND status = 'queued'
          AND account_id = ? AND tenant_cell_id = ? AND tenant_placement_epoch = ?
          AND available_at_ms <= ? AND deadline_at_ms > ?
          AND cancel_requested_at_ms IS NULL
      `)).run(
        tenant.orgId,
        invocationId,
        tenant.accountId,
        tenant.cellId,
        tenant.placementEpoch,
        request.nowMs,
        request.nowMs,
      );
      if (updated.changes === 0) return { status: 'not_claimable', reason: 'state' };
      await (await this.database.prepare(`
        INSERT INTO function_attempts (
          org_id, id, invocation_id, attempt_number, lease_epoch, status,
          sandbox_driver, memory_tier, active_wall_ms, cpu_ms,
          allocated_memory_byte_ms, peak_rss_bytes, disk_read_bytes,
          disk_write_bytes, network_rx_bytes, network_tx_bytes,
          output_byte_size, log_byte_size, cold_start, failure_owner,
          failure_json, billable, created_at_ms, started_at_ms,
          guest_code_entered_at_ms, finished_at_ms
        ) VALUES (?, ?, ?, ?, ?, 'starting', ?, ?, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, ?, NULL, NULL, 0, ?, NULL, NULL, NULL)
      `)).run(
        tenant.orgId,
        request.attemptId,
        invocationId,
        attemptNumber,
        leaseEpoch,
        request.sandboxDriver,
        String((row as Record<string, unknown>).memory_tier),
        Number(request.coldStart),
        request.nowMs,
      );
      await (await this.database.prepare(`
        INSERT INTO invocation_leases (
          org_id, invocation_id, attempt_id, lease_epoch, worker_id,
          created_at_ms, heartbeat_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)).run(
        tenant.orgId,
        invocationId,
        request.attemptId,
        leaseEpoch,
        request.workerId,
        request.nowMs,
        request.nowMs,
        expiresAtMs,
      );
      const attempt = await this.#getAttempt(tenant, invocationId, request.attemptId);
      const lease = await this.#getLease(tenant, invocationId);
      if (!attempt || !lease) throw new Error('Failed to atomically claim invocation.');
      return { status: 'claimed', attempt, lease };
    });
  }

  async startAttempt(
    tenant: TTenantContext,
    request: Readonly<{ lease: TInvocationLease; nowMs: number }>,
  ): Promise<TInvocationLeaseMutationResult> {
    return this.#runImmediate(tenant, async () => {
      const current = await this.#getFencedExecution(tenant, request.lease, request.nowMs);
      if (!current || current.attempt.status !== 'starting' || current.invocation.status !== 'claimed'
        || current.invocation.cancelRequestedAtMs !== null) return { status: 'stale' };
      await (await this.database.prepare(`
        UPDATE function_attempts SET status = 'running', started_at_ms = ?
        WHERE org_id = ? AND invocation_id = ? AND id = ? AND lease_epoch = ?
          AND status = 'starting'
      `)).run(
        request.nowMs,
        tenant.orgId,
        request.lease.invocationId,
        request.lease.attemptId,
        request.lease.leaseEpoch,
      );
      await (await this.database.prepare(`
        UPDATE function_invocations SET status = 'running', started_at_ms = ?
        WHERE org_id = ? AND id = ? AND status = 'claimed'
      `)).run(request.nowMs, tenant.orgId, request.lease.invocationId);
      const attempt = await this.#getAttempt(
        tenant,
        request.lease.invocationId,
        request.lease.attemptId,
      );
      const lease = await this.#getLease(tenant, request.lease.invocationId);
      if (!attempt || !lease) return { status: 'stale' };
      return { status: 'updated', attempt, lease };
    });
  }

  async enterGuestCode(
    tenant: TTenantContext,
    request: Readonly<{ lease: TInvocationLease; nowMs: number }>,
  ): Promise<TInvocationLeaseMutationResult> {
    return this.#runImmediate(tenant, async () => {
      const current = await this.#getFencedExecution(tenant, request.lease, request.nowMs);
      if (!current || current.invocation.status !== 'running' || current.attempt.status !== 'running'
        || current.invocation.cancelRequestedAtMs !== null) return { status: 'stale' };
      await (await this.database.prepare(`
        UPDATE function_attempts
        SET guest_code_entered_at_ms = coalesce(guest_code_entered_at_ms, ?)
        WHERE org_id = ? AND invocation_id = ? AND id = ? AND lease_epoch = ?
          AND status = 'running'
      `)).run(
        request.nowMs,
        tenant.orgId,
        request.lease.invocationId,
        request.lease.attemptId,
        request.lease.leaseEpoch,
      );
      const attempt = await this.#getAttempt(
        tenant,
        request.lease.invocationId,
        request.lease.attemptId,
      );
      const lease = await this.#getLease(tenant, request.lease.invocationId);
      if (!attempt || attempt.guestCodeEnteredAtMs === null || !lease) return { status: 'stale' };
      return { status: 'updated', attempt, lease };
    });
  }

  async heartbeat(
    tenant: TTenantContext,
    request: TInvocationHeartbeatRequest,
  ): Promise<TInvocationLeaseMutationResult> {
    return this.#runImmediate(tenant, async () => {
      this.#positiveTtl(request.ttlMs);
      const current = await this.#getFencedExecution(tenant, request.lease, request.nowMs);
      if (!current || current.invocation.status !== 'running' || current.attempt.status !== 'running'
        || current.invocation.cancelRequestedAtMs !== null) return { status: 'stale' };
      const expiresAtMs = Math.min(
        current.invocation.envelope.deadlineAtMs,
        request.nowMs + request.ttlMs,
      );
      if (expiresAtMs <= request.nowMs) return { status: 'stale' };
      const metrics = this.#highWaterMetrics(current.attempt.metrics, request.metrics);
      await this.#updateAttemptMetrics(
        tenant,
        request.lease.invocationId,
        request.lease.attemptId,
        metrics,
      );
      const result = await (await this.database.prepare(`
        UPDATE invocation_leases SET heartbeat_at_ms = ?, expires_at_ms = ?
        WHERE org_id = ? AND invocation_id = ? AND attempt_id = ?
          AND lease_epoch = ? AND worker_id = ? AND expires_at_ms > ?
      `)).run(
        request.nowMs,
        expiresAtMs,
        tenant.orgId,
        request.lease.invocationId,
        request.lease.attemptId,
        request.lease.leaseEpoch,
        request.lease.workerId,
        request.nowMs,
      );
      if (result.changes === 0) return { status: 'stale' };
      const attempt = await this.#getAttempt(
        tenant,
        request.lease.invocationId,
        request.lease.attemptId,
      );
      const lease = await this.#getLease(tenant, request.lease.invocationId);
      if (!attempt || !lease) return { status: 'stale' };
      return { status: 'updated', attempt, lease };
    });
  }

  async requestCancellation(
    tenant: TTenantContext,
    request: Readonly<{ invocationId: TFunctionInvocationId; nowMs: number }>,
  ): Promise<TInvocationCancellationResult> {
    return this.#runImmediate(tenant, async () => {
      const invocation = await this.getInvocation(tenant, request.invocationId);
      if (
        !invocation
        || !this.#invocationPlacementMatches(tenant, invocation)
        || !await this.#hasInvocationCallerAuthority(tenant, invocation)
      ) {
        return { status: 'missing' };
      }
      if (TERMINAL_INVOCATION_STATUSES.includes(invocation.status as never)) {
        return { status: 'already_terminal', invocation };
      }
      const failure = terminalFailure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.', false);
      if (invocation.status === 'queued') {
        await (await this.database.prepare(`
          UPDATE function_invocations
          SET status = 'cancelled', failure_json = ?, cancel_requested_at_ms = ?, finished_at_ms = ?
          WHERE org_id = ? AND id = ? AND status = 'queued'
        `)).run(
          fnFunctionCanonicalJson(failure),
          request.nowMs,
          request.nowMs,
          tenant.orgId,
          request.invocationId,
        );
        const cancelled = await this.getInvocation(tenant, request.invocationId);
        if (!cancelled) throw new Error('Cancelled invocation disappeared.');
        return { status: 'cancelled', invocation: cancelled };
      }
      await (await this.database.prepare(`
        UPDATE function_invocations SET cancel_requested_at_ms = coalesce(cancel_requested_at_ms, ?)
        WHERE org_id = ? AND id = ? AND status IN ('claimed', 'running')
      `)).run(request.nowMs, tenant.orgId, request.invocationId);
      await this.#expireInvocationPermits(tenant, request.invocationId, request.nowMs);
      const activePermit = await this.#hasActivePermit(tenant, request.invocationId, request.nowMs);
      if (activePermit) {
        const requested = await this.getInvocation(tenant, request.invocationId);
        if (!requested) throw new Error('Cancellation-requested invocation disappeared.');
        return { status: 'requested', invocation: requested };
      }
      const lease = await this.#getLease(tenant, request.invocationId);
      if (!lease) {
        const requested = await this.getInvocation(tenant, request.invocationId);
        if (!requested) throw new Error('Cancellation-requested invocation disappeared.');
        return { status: 'requested', invocation: requested };
      }
      const attempt = await this.#getAttempt(tenant, request.invocationId, lease.attemptId);
      if (!attempt || (attempt.status !== 'starting' && attempt.status !== 'running')) {
        const requested = await this.getInvocation(tenant, request.invocationId);
        if (!requested) throw new Error('Cancellation-requested invocation disappeared.');
        return { status: 'requested', invocation: requested };
      }
      await this.#finishAttemptAndInvocation(tenant, {
        invocation,
        attempt,
        lease,
        status: 'cancelled',
        failure,
        output: null,
        outputByteSize: attempt.outputByteSize,
        logByteSize: attempt.logByteSize,
        metrics: attempt.metrics,
        billable: attempt.billable,
        nowMs: request.nowMs,
        allowRetry: false,
      });
      const cancelled = await this.getInvocation(tenant, request.invocationId);
      if (!cancelled) throw new Error('Cancelled invocation disappeared.');
      return { status: 'cancelled', invocation: cancelled };
    });
  }

  async completeAttempt(
    tenant: TTenantContext,
    request: TInvocationAttemptCompletionRequest,
  ): Promise<TInvocationAttemptCompletionResult> {
    return this.#runImmediate(tenant, async () => {
      const current = await this.#getFencedExecution(tenant, request.lease, request.nowMs);
      if (!current) {
        const completed = await this.#getCompletedBundle(tenant, request.lease);
        return completed
          ? { status: 'already_completed', ...completed }
          : { status: 'stale' };
      }
      await this.#expireInvocationPermits(tenant, request.lease.invocationId, request.nowMs);
      if (current.attempt.status !== 'starting' && current.attempt.status !== 'running') {
        return { status: 'already_completed', invocation: current.invocation, attempt: current.attempt };
      }
      if (await this.#hasActivePermit(tenant, request.lease.invocationId, request.nowMs)) {
        return { status: 'permit_active' };
      }
      this.#assertCompletion(current.invocation, current.attempt, request);
      const cancellation = current.invocation.cancelRequestedAtMs !== null;
      const status = cancellation ? 'cancelled' : request.status;
      const failure = cancellation
        ? terminalFailure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.', false)
        : request.failure;
      const result = await this.#finishAttemptAndInvocation(tenant, {
        invocation: current.invocation,
        attempt: current.attempt,
        lease: request.lease,
        status,
        failure,
        output: status === 'succeeded' ? request.output : null,
        outputByteSize: request.outputByteSize,
        logByteSize: request.logByteSize,
        metrics: this.#highWaterMetrics(current.attempt.metrics, request.metrics),
        billable: request.billable,
        nowMs: request.nowMs,
        allowRetry: !cancellation,
      });
      return result;
    });
  }

  async recoverExpiredLeases(
    tenant: TTenantContext,
    request: TInvocationRecoveryRequest,
  ): Promise<TInvocationRecoveryResult> {
    return this.#runImmediate(tenant, async () => {
      const limit = this.#batchLimit(request.limit);
      await this.#expireWritePermitsInScope(tenant, request.nowMs, limit);
      const expiredQueuedRows = await (await this.database.prepare(`
        SELECT id
        FROM function_invocations
        WHERE org_id = ? AND tenant_cell_id = ? AND tenant_placement_epoch = ?
          AND status = 'queued' AND deadline_at_ms <= ?
        ORDER BY deadline_at_ms ASC, id ASC
        LIMIT ?
      `)).all(
        tenant.orgId,
        tenant.cellId,
        tenant.placementEpoch,
        request.nowMs,
        limit,
      ) as Record<string, unknown>[];
      const recoveredInvocationIds: string[] = [];
      for (const row of expiredQueuedRows) {
        const invocationId = String(row.id);
        await this.#timeoutQueuedInvocation(tenant, invocationId, request.nowMs);
        recoveredInvocationIds.push(invocationId);
      }
      const remainingLimit = Math.max(0, limit - recoveredInvocationIds.length);
      if (remainingLimit === 0) return { recoveredInvocationIds };
      const rows = await (await this.database.prepare(`
        SELECT lease.*
        FROM invocation_leases AS lease
        JOIN function_invocations AS invocation
          ON invocation.org_id = lease.org_id AND invocation.id = lease.invocation_id
        WHERE lease.org_id = ? AND invocation.tenant_cell_id = ?
          AND invocation.tenant_placement_epoch = ? AND lease.expires_at_ms <= ?
          AND NOT EXISTS (
            SELECT 1 FROM resource_write_permits AS permit
            WHERE permit.org_id = lease.org_id
              AND permit.invocation_id = lease.invocation_id
              AND permit.attempt_id = lease.attempt_id
              AND permit.lease_epoch = lease.lease_epoch
              AND permit.status = 'active'
          )
        ORDER BY lease.expires_at_ms ASC, lease.invocation_id ASC
        LIMIT ?
      `)).all(
        tenant.orgId,
        tenant.cellId,
        tenant.placementEpoch,
        request.nowMs,
        remainingLimit,
      );
      for (const row of rows) {
        const lease = fnFunctionControlStoreLease(row);
        const invocation = await this.getInvocation(tenant, lease.invocationId);
        const attempt = await this.#getAttempt(tenant, lease.invocationId, lease.attemptId);
        if (!invocation || !attempt || (attempt.status !== 'starting' && attempt.status !== 'running')) {
          await (await this.database.prepare(`
            DELETE FROM invocation_leases
            WHERE org_id = ? AND invocation_id = ? AND attempt_id = ? AND lease_epoch = ?
          `)).run(tenant.orgId, lease.invocationId, lease.attemptId, lease.leaseEpoch);
          continue;
        }
        const cancelled = invocation.cancelRequestedAtMs !== null;
        const failure = cancelled
          ? terminalFailure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.', false)
          : terminalFailure('platform', 'FUNCTION_LEASE_LOST', 'Function executor lease expired.', true);
        await this.#finishAttemptAndInvocation(tenant, {
          invocation,
          attempt,
          lease,
          status: cancelled ? 'cancelled' : 'lost',
          failure,
          output: null,
          outputByteSize: attempt.outputByteSize,
          logByteSize: attempt.logByteSize,
          metrics: attempt.metrics,
          billable: attempt.billable,
          nowMs: request.nowMs,
          allowRetry: !cancelled,
        });
        recoveredInvocationIds.push(lease.invocationId);
      }
      return { recoveredInvocationIds };
    });
  }

  async acquireWritePermit(
    tenant: TTenantContext,
    request: TResourceWritePermitAcquireRequest,
  ): Promise<TResourceWritePermitAcquireResult> {
    return this.#runImmediate(tenant, async () => {
      this.#positiveTtl(request.ttlMs);
      if (!/^[0-9a-f]{64}$/.test(request.operationFingerprintSha256)) {
        throw new TypeError('Resource write operation fingerprint must be lowercase SHA-256.');
      }
      const invocation = await this.getInvocation(tenant, request.invocationId);
      if (!invocation || !this.#invocationPlacementMatches(tenant, invocation)) {
        return { status: 'stale' };
      }
      await this.#expireInvocationPermits(tenant, request.invocationId, request.nowMs);
      const existing = await (await this.database.prepare(`
        SELECT * FROM resource_write_permits
        WHERE org_id = ? AND resource_id = ? AND invocation_id = ? AND operation_id = ?
      `)).get(tenant.orgId, request.resourceId, request.invocationId, request.operationId);
      if (existing) {
        const permit = fnFunctionControlStorePermit(existing);
        if (
          permit.operationName !== request.operationName
          || permit.operationFingerprintSha256 !== request.operationFingerprintSha256
        ) {
          return { status: 'conflict', permit };
        }
        if (permit.status === 'consumed') return { status: 'replayed', permit };
        if (permit.status === 'active') {
          const exact = permit.attemptId === request.attemptId
            && permit.leaseEpoch === request.leaseEpoch;
          return exact ? { status: 'replayed', permit } : { status: 'conflict', permit };
        }
        if (permit.status !== 'expired') return { status: 'conflict', permit };
      }
      const lease = await this.#getLease(tenant, request.invocationId);
      if (invocation.status !== 'running' || invocation.cancelRequestedAtMs !== null
        || !lease || lease.attemptId !== request.attemptId
        || lease.leaseEpoch !== request.leaseEpoch || lease.expiresAtMs <= request.nowMs) {
        return { status: 'stale' };
      }
      const expiresAtMs = Math.min(
        request.nowMs + request.ttlMs,
        lease.expiresAtMs,
        invocation.envelope.deadlineAtMs,
      );
      if (expiresAtMs <= request.nowMs) return { status: 'stale' };
      if (existing) {
        const prior = fnFunctionControlStorePermit(existing);
        const rearmed = await (await this.database.prepare(`
          UPDATE resource_write_permits
          SET attempt_id = ?, lease_epoch = ?, status = 'active',
            result_json = NULL, result_digest_sha256 = NULL,
            issued_at_ms = ?, expires_at_ms = ?, consumed_at_ms = NULL
          WHERE org_id = ? AND id = ? AND status = 'expired'
            AND resource_id = ? AND invocation_id = ?
            AND operation_name = ? AND operation_id = ?
            AND operation_fingerprint_sha256 = ?
        `)).run(
          request.attemptId,
          request.leaseEpoch,
          request.nowMs,
          expiresAtMs,
          tenant.orgId,
          prior.id,
          request.resourceId,
          request.invocationId,
          request.operationName,
          request.operationId,
          request.operationFingerprintSha256,
        );
        if (rearmed.changes === 0) return { status: 'conflict', permit: prior };
        const permit = await this.getWritePermit(tenant, prior.id);
        if (!permit) throw new Error('Re-armed resource write permit disappeared.');
        return { status: 'acquired', permit };
      }
      await (await this.database.prepare(`
        INSERT INTO resource_write_permits (
          org_id, id, resource_id, invocation_id, attempt_id, lease_epoch,
          operation_name, operation_id, operation_fingerprint_sha256,
          status, result_json, result_digest_sha256,
          issued_at_ms, expires_at_ms, consumed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?, NULL)
      `)).run(
        tenant.orgId,
        request.id,
        request.resourceId,
        request.invocationId,
        request.attemptId,
        request.leaseEpoch,
        request.operationName,
        request.operationId,
        request.operationFingerprintSha256,
        request.nowMs,
        expiresAtMs,
      );
      const permit = await this.getWritePermit(tenant, request.id);
      if (!permit) throw new Error('Failed to acquire resource write permit.');
      return { status: 'acquired', permit };
    });
  }

  async getWritePermit(
    tenant: TTenantContext,
    permitId: string,
  ): Promise<TResourceWritePermit | null> {
    const row = await (await this.database.prepare(`
      SELECT permit.*
      FROM resource_write_permits AS permit
      JOIN function_invocations AS invocation
        ON invocation.org_id = permit.org_id AND invocation.id = permit.invocation_id
      WHERE permit.org_id = ? AND permit.id = ?
        AND invocation.tenant_cell_id = ? AND invocation.tenant_placement_epoch = ?
    `)).get(tenant.orgId, permitId, tenant.cellId, tenant.placementEpoch);
    return row ? fnFunctionControlStorePermit(row) : null;
  }

  async listRecoverableWritePermits(
    tenant: TTenantContext,
    request: Readonly<{ resourceId: string; afterPermitId?: string; limit: number }>,
  ): Promise<readonly TResourceWritePermitRecoveryCandidate[]> {
    const limit = this.#batchLimit(request.limit);
    const rows = await (await this.database.prepare(`
      SELECT permit.* FROM resource_write_permits AS permit
      JOIN function_invocations AS invocation
        ON invocation.org_id = permit.org_id AND invocation.id = permit.invocation_id
      WHERE permit.org_id = ? AND permit.resource_id = ?
        AND invocation.tenant_cell_id = ? AND invocation.tenant_placement_epoch = ?
        AND permit.status IN ('active', 'expired', 'revoked')
        AND (? IS NULL OR permit.id > ?)
      ORDER BY permit.id ASC
      LIMIT ?
    `)).all(
      tenant.orgId,
      request.resourceId,
      tenant.cellId,
      tenant.placementEpoch,
      request.afterPermitId ?? null,
      request.afterPermitId ?? null,
      limit,
    );
    return rows.map((row) => {
      const permit = fnFunctionControlStorePermit(row);
      return {
        permitId: permit.id,
        resourceId: permit.resourceId,
        invocationId: permit.invocationId,
        attemptId: permit.attemptId,
        leaseEpoch: permit.leaseEpoch,
        operationName: permit.operationName,
        operationId: permit.operationId,
        operationFingerprintSha256: permit.operationFingerprintSha256,
      };
    });
  }

  async reconcileCommittedWritePermit(
    tenant: TTenantContext,
    write: TCommittedResourceWrite,
  ): Promise<TResourceWritePermitRecoveryResult> {
    return this.#runImmediate(tenant, async () => {
      if (!Number.isInteger(write.recordedAtMs) || write.recordedAtMs < 0) {
        throw new RangeError('Resource write recovery timestamp must be a non-negative integer.');
      }
      const resultJson = fnFunctionCanonicalJson(write.output);
      const resultDigest = sha256(resultJson);
      const permit = await this.getWritePermit(tenant, write.permitId);
      if (!permit) return { status: 'missing' };
      if (
        permit.resourceId !== write.resourceId
        || permit.invocationId !== write.invocationId
        || permit.attemptId !== write.attemptId
        || permit.leaseEpoch !== write.leaseEpoch
        || permit.operationName !== write.operationName
        || permit.operationId !== write.operationId
        || permit.operationFingerprintSha256 !== write.operationFingerprintSha256
      ) return { status: 'conflict' };
      if (permit.status === 'consumed') {
        return { status: permit.resultDigestSha256 === resultDigest ? 'replayed' : 'conflict' };
      }
      if (!['active', 'expired', 'revoked'].includes(permit.status)) return { status: 'conflict' };
      const invocation = await this.getInvocation(tenant, permit.invocationId);
      if (!invocation) return { status: 'missing' };
      const attempt = await this.#getAttempt(tenant, permit.invocationId, permit.attemptId);
      if (!attempt) return { status: 'missing' };
      const updated = await (await this.database.prepare(`
        UPDATE resource_write_permits
        SET status = 'consumed', result_json = ?, result_digest_sha256 = ?, consumed_at_ms = ?
        WHERE org_id = ? AND id = ? AND status IN ('active', 'expired', 'revoked')
      `)).run(
        resultJson,
        resultDigest,
        write.recordedAtMs,
        tenant.orgId,
        permit.id,
      );
      if (updated.changes === 0) return { status: 'conflict' };
      await this.#insertUsage(tenant, {
        id: permit.id,
        invocation,
        attempt,
        finishedAtMs: write.recordedAtMs,
        attemptId: null,
        resourceId: permit.resourceId,
        resourcePermitId: permit.id,
        outcome: 'succeeded',
        failureOwner: null,
        billable: false,
        metrics: ZERO_METRICS,
        createdAtMs: write.recordedAtMs,
      });
      return { status: 'consumed' };
    });
  }

  async consumeWritePermit(
    tenant: TTenantContext,
    request: TResourceWritePermitConsumeRequest,
  ): Promise<TResourceWritePermitConsumeResult> {
    return this.#runImmediate(tenant, async () => {
      const resultJson = fnFunctionCanonicalJson(request.result);
      const resultDigest = sha256(resultJson);
      const permit = await this.getWritePermit(tenant, request.permitId);
      if (!permit) return { status: 'stale' };
      if (permit.status === 'consumed') {
        return permit.resultDigestSha256 === resultDigest
          ? { status: 'replayed', permit }
          : { status: 'stale' };
      }
      if (permit.status !== 'active'
        || permit.invocationId !== request.invocationId
        || permit.attemptId !== request.attemptId
        || permit.leaseEpoch !== request.leaseEpoch
        || request.committedAtMs >= permit.expiresAtMs) return { status: 'stale' };
      const lease = await this.#getLease(tenant, request.invocationId);
      const invocation = await this.getInvocation(tenant, request.invocationId);
      const attempt = await this.#getAttempt(tenant, request.invocationId, request.attemptId);
      if (!lease || !invocation || !attempt || invocation.status !== 'running'
        || invocation.cancelRequestedAtMs !== null
        || lease.attemptId !== request.attemptId || lease.leaseEpoch !== request.leaseEpoch
        || lease.expiresAtMs <= request.committedAtMs) return { status: 'stale' };
      const updated = await (await this.database.prepare(`
        UPDATE resource_write_permits
        SET status = 'consumed', result_json = ?, result_digest_sha256 = ?, consumed_at_ms = ?
        WHERE org_id = ? AND id = ? AND status = 'active' AND expires_at_ms > ?
      `)).run(
        resultJson,
        resultDigest,
        request.committedAtMs,
        tenant.orgId,
        request.permitId,
        request.committedAtMs,
      );
      if (updated.changes === 0) return { status: 'stale' };
      await this.#insertUsage(tenant, {
        id: request.permitId,
        invocation,
        attempt,
        finishedAtMs: request.recordedAtMs,
        attemptId: null,
        resourceId: permit.resourceId,
        resourcePermitId: permit.id,
        outcome: request.outcome,
        failureOwner: request.failureOwner,
        billable: request.billable,
        metrics: request.metrics,
        createdAtMs: request.recordedAtMs,
      });
      const consumed = await this.getWritePermit(tenant, request.permitId);
      if (!consumed) throw new Error('Consumed resource write permit disappeared.');
      return { status: 'consumed', permit: consumed };
    });
  }

  async expireWritePermits(
    tenant: TTenantContext,
    request: Readonly<{ nowMs: number; limit: number }>,
  ): Promise<number> {
    return this.#runImmediate(tenant, () => this.#expireWritePermitsInScope(
      tenant,
      request.nowMs,
      this.#batchLimit(request.limit),
    ));
  }

  async runWithWritePermit<T>(
    tenant: TTenantContext,
    scope: TResourceWritePermitScope,
    operation: (guard: IResourceWritePermitGuard) => Promise<T>,
  ): Promise<T> {
    this.#assertPermitScope(tenant, scope);
    const guard: IResourceWritePermitGuard = {
      assertCanCommit: async () => {
        const valid = await this.#isPermitFenceLive(tenant, scope, this.#nowMs());
        if (!valid) {
          throw functionStoreError(
            'RESOURCE_WRITE_CAPABILITY_STALE',
            'Resource write permit or executor lease is no longer active.',
          );
        }
      },
    };
    await guard.assertCanCommit();
    const result = await operation(guard);
    const committedAtMs = this.#nowMs();
    const replayValue = result !== null && typeof result === 'object' && 'output' in result
      ? (result as Readonly<{ output: unknown }>).output
      : result;
    const consumed = await this.consumeWritePermit(tenant, {
      permitId: scope.claims.permitId,
      invocationId: scope.claims.invocationId,
      attemptId: scope.claims.attemptId,
      leaseEpoch: scope.claims.leaseEpoch,
      result: replayValue,
      outcome: 'succeeded',
      failureOwner: null,
      billable: false,
      metrics: ZERO_METRICS,
      committedAtMs,
      recordedAtMs: committedAtMs,
    });
    if (consumed.status === 'stale') {
      throw functionStoreError(
        'RESOURCE_WRITE_CAPABILITY_STALE',
        'Resource mutation committed without a consumable authoritative permit.',
      );
    }
    return result;
  }

  async listUsageOutbox(
    tenant: TTenantContext,
    request: Readonly<{ states?: readonly TUsageOutboxState[]; limit: number }>,
  ): Promise<readonly TUsageOutboxRecord[]> {
    const limit = this.#batchLimit(request.limit);
    const states = request.states ?? ['pending', 'importing', 'imported', 'error'];
    if (states.length === 0) return [];
    const rows = await (await this.database.prepare(`
      SELECT * FROM usage_outbox
      WHERE org_id = ? AND state IN (${states.map(() => '?').join(', ')})
      ORDER BY created_at_ms ASC, id ASC LIMIT ?
    `)).all(tenant.orgId, ...states, limit);
    return rows.map(fnFunctionControlStoreUsage);
  }

  async transitionUsageOutbox(
    tenant: TTenantContext,
    request: Readonly<{
      ids: readonly string[];
      expected: TUsageOutboxState;
      next: TUsageOutboxState;
      nowMs: number;
    }>,
  ): Promise<number> {
    if (request.ids.length === 0) return 0;
    if (request.ids.length > FUNCTION_CONTROL_STORE_MAX_BATCH) {
      throw new TypeError('Usage outbox transition exceeds the maximum batch size.');
    }
    return this.#runImmediate(tenant, async () => {
      const result = await (await this.database.prepare(`
        UPDATE usage_outbox
        SET state = ?, imported_at_ms = CASE WHEN ? = 'imported' THEN ? ELSE NULL END
        WHERE org_id = ? AND state = ?
          AND id IN (${request.ids.map(() => '?').join(', ')})
      `)).run(
        request.next,
        request.next,
        request.nowMs,
        tenant.orgId,
        request.expected,
        ...request.ids,
      );
      return Number(result.changes);
    });
  }

  async compactTerminalHistory(
    tenant: TTenantContext,
    request: TTerminalHistoryCompactionRequest,
  ): Promise<TTerminalHistoryCompactionResult> {
    return this.#runImmediate(tenant, async () => {
      const limit = this.#batchLimit(request.limit);
      const expiredIdempotencyRows = await (await this.database.prepare(`
        SELECT id FROM idempotency_records
        WHERE org_id = ? AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?
        ORDER BY expires_at_ms ASC, id ASC LIMIT ?
      `)).all(tenant.orgId, request.nowMs, limit) as Record<string, unknown>[];
      const expiredIdempotencyIds = expiredIdempotencyRows.map((row) => String(row.id));
      const deletedIdempotencyRecords = expiredIdempotencyIds.length === 0
        ? 0
        : Number((await (await this.database.prepare(`
            DELETE FROM idempotency_records
            WHERE org_id = ? AND id IN (${expiredIdempotencyIds.map(() => '?').join(', ')})
              AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?
          `)).run(tenant.orgId, ...expiredIdempotencyIds, request.nowMs)).changes);
      const bodyRows = await (await this.database.prepare(`
        SELECT id, failure_json FROM function_invocations
        WHERE org_id = ? AND status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
          AND body_state = 'full' AND finished_at_ms < ?
          AND NOT EXISTS (
            SELECT 1 FROM idempotency_records AS record
            WHERE record.org_id = function_invocations.org_id
              AND record.invocation_id = function_invocations.id
              AND (record.expires_at_ms IS NULL OR record.expires_at_ms > ?)
          )
        ORDER BY finished_at_ms ASC, id ASC LIMIT ?
      `)).all(tenant.orgId, request.bodiesBeforeMs, request.nowMs, limit);
      const compactedInvocationIds: string[] = [];
      for (const row of bodyRows as Record<string, unknown>[]) {
        const id = String(row.id);
        const failure = row.failure_json === null
          ? null
          : JSON.parse(String(row.failure_json)) as TFunctionFailure;
        const summary = failure === null ? null : {
          owner: failure.owner,
          code: failure.code,
          message: 'Function failure details compacted.',
          retryable: failure.retryable,
        };
        const updated = await (await this.database.prepare(`
          UPDATE function_invocations
          SET input_json = NULL, result_json = NULL, failure_json = ?,
            body_state = 'compacted', bodies_compacted_at_ms = ?
          WHERE org_id = ? AND id = ? AND body_state = 'full'
            AND status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
        `)).run(
          summary === null ? null : fnFunctionCanonicalJson(summary),
          request.nowMs,
          tenant.orgId,
          id,
        );
        if (updated.changes > 0) compactedInvocationIds.push(id);
      }
      const releaseRows = await (await this.database.prepare(`
        SELECT invocation.id
        FROM function_invocations AS invocation
        WHERE invocation.org_id = ?
          AND invocation.status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
          AND invocation.retains_revision = 1 AND invocation.finished_at_ms < ?
          AND NOT EXISTS (
            SELECT 1 FROM idempotency_records AS record
            WHERE record.org_id = invocation.org_id
              AND record.invocation_id = invocation.id
              AND (record.expires_at_ms IS NULL OR record.expires_at_ms > ?)
          )
        ORDER BY invocation.finished_at_ms ASC, invocation.id ASC LIMIT ?
      `)).all(tenant.orgId, request.releaseRevisionPinsBeforeMs, request.nowMs, limit);
      const releasedRevisionInvocationIds: string[] = [];
      for (const row of releaseRows as Record<string, unknown>[]) {
        const id = String(row.id);
        const updated = await (await this.database.prepare(`
          UPDATE function_invocations SET retains_revision = 0
          WHERE org_id = ? AND id = ? AND retains_revision = 1
            AND status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
        `)).run(tenant.orgId, id);
        if (updated.changes > 0) releasedRevisionInvocationIds.push(id);
      }
      return {
        compactedInvocationIds,
        releasedRevisionInvocationIds,
        deletedIdempotencyRecords,
      };
    });
  }

  async #getDefinitionById(
    tenant: TTenantContext,
    widgetDefinitionId: string,
    widgetRevisionId: string,
    functionId: string,
  ): Promise<TFunctionDefinition | null> {
    const row = await (await this.database.prepare(`
      SELECT * FROM function_definitions
      WHERE org_id = ? AND widget_definition_id = ? AND widget_revision_id = ? AND id = ?
    `)).get(tenant.orgId, widgetDefinitionId, widgetRevisionId, functionId);
    return row ? fnFunctionControlStoreDefinition(row) : null;
  }

  async #getAttempt(
    tenant: TTenantContext,
    invocationId: string,
    attemptId: string,
  ): Promise<TFunctionAttempt | null> {
    const row = await (await this.database.prepare(`
      SELECT * FROM function_attempts WHERE org_id = ? AND invocation_id = ? AND id = ?
    `)).get(tenant.orgId, invocationId, attemptId);
    return row ? fnFunctionControlStoreAttempt(row) : null;
  }

  async #countAttemptsByGuestEntry(
    tenant: TTenantContext,
    invocationId: string,
    entered: boolean,
  ): Promise<number> {
    const row = await (await this.database.prepare(`
      SELECT count(*) AS count
      FROM function_attempts
      WHERE org_id = ? AND invocation_id = ?
        AND guest_code_entered_at_ms IS ${entered ? 'NOT NULL' : 'NULL'}
    `)).get(tenant.orgId, invocationId) as Record<string, unknown>;
    return Number(row.count);
  }

  async #getLease(
    tenant: TTenantContext,
    invocationId: string,
  ): Promise<TInvocationLease | null> {
    const row = await (await this.database.prepare(`
      SELECT * FROM invocation_leases WHERE org_id = ? AND invocation_id = ?
    `)).get(tenant.orgId, invocationId);
    return row ? fnFunctionControlStoreLease(row) : null;
  }

  async #getFencedExecution(
    tenant: TTenantContext,
    fence: TInvocationLease,
    nowMs: number,
  ): Promise<TStoredInvocationBundle | null> {
    const lease = await this.#getLease(tenant, fence.invocationId);
    if (!lease || lease.attemptId !== fence.attemptId || lease.leaseEpoch !== fence.leaseEpoch
      || lease.workerId !== fence.workerId || lease.expiresAtMs <= nowMs) return null;
    const invocation = await this.getInvocation(tenant, fence.invocationId);
    const attempt = await this.#getAttempt(tenant, fence.invocationId, fence.attemptId);
    return invocation && attempt && this.#invocationPlacementMatches(tenant, invocation)
      ? { invocation, attempt }
      : null;
  }

  async #getCompletedBundle(
    tenant: TTenantContext,
    fence: TInvocationLease,
  ): Promise<TStoredInvocationBundle | null> {
    const attempt = await this.#getAttempt(tenant, fence.invocationId, fence.attemptId);
    const invocation = await this.getInvocation(tenant, fence.invocationId);
    if (!attempt || !invocation || !this.#invocationPlacementMatches(tenant, invocation)
      || attempt.leaseEpoch !== fence.leaseEpoch
      || attempt.status === 'starting' || attempt.status === 'running') return null;
    return { invocation, attempt };
  }

  async #finishAttemptAndInvocation(
    tenant: TTenantContext,
    args: Readonly<{
      invocation: TInvocationRecord;
      attempt: TFunctionAttempt;
      lease: TInvocationLease;
      status: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'lost';
      failure: TFunctionFailure | null;
      output: unknown | null;
      outputByteSize: number;
      logByteSize: number;
      metrics: TUsageMetrics;
      billable: boolean;
      nowMs: number;
      allowRetry: boolean;
    }>,
  ): Promise<TInvocationAttemptCompletionResult> {
    if (!this.#invocationPlacementMatches(tenant, args.invocation)) {
      throw functionStoreError(
        'FUNCTION_PLACEMENT_STALE',
        'Function attempt placement fence is stale.',
      );
    }
    const preGuestFailure = args.attempt.guestCodeEnteredAtMs === null;
    const policyAttemptNumber = await this.#countAttemptsByGuestEntry(
      tenant,
      args.invocation.envelope.id,
      !preGuestFailure,
    );
    const canRetry = args.allowRetry
      && (preGuestFailure || args.invocation.envelope.retry.mode === 'idempotent')
      && args.failure?.retryable === true
      && fnFunctionAttemptShouldRetry({
        status: args.status,
        failureOwner: args.failure?.owner ?? null,
        attemptNumber: policyAttemptNumber,
        maxAttempts: preGuestFailure
          ? FUNCTION_PLATFORM_PRE_GUEST_MAX_ATTEMPTS
          : args.invocation.envelope.retry.maxAttempts,
      });
    const delayMs = canRetry
      ? fnFunctionRetryDelayMs(args.invocation.envelope.retry, policyAttemptNumber)
      : 0;
    const availableAtMs = args.nowMs + delayMs;
    const requeue = canRetry && availableAtMs < args.invocation.envelope.deadlineAtMs;
    const metrics = this.#highWaterMetrics(args.attempt.metrics, args.metrics);
    await (await this.database.prepare(`
      UPDATE function_attempts
      SET status = ?, active_wall_ms = ?, cpu_ms = ?, allocated_memory_byte_ms = ?,
        peak_rss_bytes = ?, disk_read_bytes = ?, disk_write_bytes = ?,
        network_rx_bytes = ?, network_tx_bytes = ?, output_byte_size = ?,
        log_byte_size = ?, failure_owner = ?, failure_json = ?, billable = ?,
        finished_at_ms = ?
      WHERE org_id = ? AND invocation_id = ? AND id = ? AND lease_epoch = ?
        AND status IN ('starting', 'running')
    `)).run(
      args.status,
      metrics.activeWallMs,
      metrics.cpuMs,
      metrics.allocatedMemoryByteMs,
      metrics.peakRssBytes,
      metrics.diskReadBytes,
      metrics.diskWriteBytes,
      metrics.networkRxBytes,
      metrics.networkTxBytes,
      args.outputByteSize,
      args.logByteSize,
      args.failure?.owner ?? null,
      args.failure === null ? null : fnFunctionCanonicalJson(args.failure),
      Number(args.billable),
      args.nowMs,
      tenant.orgId,
      args.invocation.envelope.id,
      args.attempt.id,
      args.attempt.leaseEpoch,
    );
    await this.#insertUsage(tenant, {
      id: args.attempt.id,
      invocation: args.invocation,
      attempt: args.attempt,
      finishedAtMs: args.nowMs,
      attemptId: args.attempt.id,
      resourceId: null,
      resourcePermitId: null,
      outcome: args.status,
      failureOwner: args.failure?.owner ?? null,
      billable: args.billable,
      metrics,
      createdAtMs: args.nowMs,
    });
    await (await this.database.prepare(`
      DELETE FROM invocation_leases
      WHERE org_id = ? AND invocation_id = ? AND attempt_id = ? AND lease_epoch = ?
    `)).run(tenant.orgId, args.lease.invocationId, args.lease.attemptId, args.lease.leaseEpoch);
    if (requeue) {
      await (await this.database.prepare(`
        UPDATE function_invocations
        SET status = 'queued', result_json = NULL, failure_json = NULL,
          result_digest_sha256 = NULL, output_byte_size = 0, log_byte_size = 0,
          available_at_ms = ?, started_at_ms = NULL, finished_at_ms = NULL
        WHERE org_id = ? AND id = ? AND status IN ('claimed', 'running')
      `)).run(availableAtMs, tenant.orgId, args.invocation.envelope.id);
    } else {
      const invocationStatus = args.status === 'lost' ? 'failed' : args.status;
      const resultJson = invocationStatus === 'succeeded'
        ? fnFunctionCanonicalJson(args.output)
        : null;
      const resultDigest = resultJson === null ? null : sha256(resultJson);
      await (await this.database.prepare(`
        UPDATE function_invocations
        SET status = ?, result_json = ?, failure_json = ?, result_digest_sha256 = ?,
          output_byte_size = ?, log_byte_size = ?, finished_at_ms = ?
        WHERE org_id = ? AND id = ? AND status IN ('claimed', 'running')
      `)).run(
        invocationStatus,
        resultJson,
        args.failure === null ? null : fnFunctionCanonicalJson(args.failure),
        resultDigest,
        args.outputByteSize,
        args.logByteSize,
        args.nowMs,
        tenant.orgId,
        args.invocation.envelope.id,
      );
    }
    const invocation = await this.getInvocation(tenant, args.invocation.envelope.id);
    const attempt = await this.#getAttempt(tenant, args.invocation.envelope.id, args.attempt.id);
    if (!invocation || !attempt) throw new Error('Failed to atomically finalize function attempt.');
    return requeue
      ? { status: 'requeued', invocation, attempt, availableAtMs }
      : { status: 'terminal', invocation, attempt };
  }

  async #insertUsage(
    tenant: TTenantContext,
    args: Readonly<{
      id: string;
      invocation: TInvocationRecord;
      attempt: TFunctionAttempt;
      finishedAtMs: number;
      attemptId: string | null;
      resourceId: string | null;
      resourcePermitId: string | null;
      outcome: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'lost';
      failureOwner: TFunctionFailure['owner'] | null;
      billable: boolean;
      metrics: TUsageMetrics;
      createdAtMs: number;
    }>,
  ): Promise<void> {
    await (await this.database.prepare(`
      INSERT INTO usage_outbox (
        org_id, id, account_id, attempt_id, invocation_id, function_id,
        definition_revision, sandbox_driver, memory_tier, queued_at_ms,
        started_at_ms, finished_at_ms, cold_start, resource_id, resource_permit_id,
        state, outcome, failure_owner, billable, policy_version, active_wall_ms,
        cpu_ms, allocated_memory_byte_ms, peak_rss_bytes, disk_read_bytes,
        disk_write_bytes, network_rx_bytes, network_tx_bytes, created_at_ms, imported_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending',
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT (org_id, id) DO NOTHING
    `)).run(
      tenant.orgId,
      args.id,
      args.invocation.envelope.tenant.accountId,
      args.attemptId,
      args.invocation.envelope.id,
      args.invocation.envelope.functionId,
      args.invocation.envelope.definitionRevision,
      args.attempt.sandboxDriver,
      args.attempt.memoryTier,
      args.invocation.envelope.createdAtMs,
      args.attempt.startedAtMs,
      args.finishedAtMs,
      Number(args.attempt.coldStart),
      args.resourceId,
      args.resourcePermitId,
      args.outcome,
      args.failureOwner,
      Number(args.billable),
      args.invocation.envelope.policyVersion,
      args.metrics.activeWallMs,
      args.metrics.cpuMs,
      args.metrics.allocatedMemoryByteMs,
      args.metrics.peakRssBytes,
      args.metrics.diskReadBytes,
      args.metrics.diskWriteBytes,
      args.metrics.networkRxBytes,
      args.metrics.networkTxBytes,
      args.createdAtMs,
    );
  }

  async #updateAttemptMetrics(
    tenant: TTenantContext,
    invocationId: string,
    attemptId: string,
    metrics: TUsageMetrics,
  ): Promise<void> {
    await (await this.database.prepare(`
      UPDATE function_attempts SET active_wall_ms = ?, cpu_ms = ?,
        allocated_memory_byte_ms = ?, peak_rss_bytes = ?, disk_read_bytes = ?,
        disk_write_bytes = ?, network_rx_bytes = ?, network_tx_bytes = ?
      WHERE org_id = ? AND invocation_id = ? AND id = ?
    `)).run(
      metrics.activeWallMs,
      metrics.cpuMs,
      metrics.allocatedMemoryByteMs,
      metrics.peakRssBytes,
      metrics.diskReadBytes,
      metrics.diskWriteBytes,
      metrics.networkRxBytes,
      metrics.networkTxBytes,
      tenant.orgId,
      invocationId,
      attemptId,
    );
  }

  async #hasActivePermit(
    tenant: TTenantContext,
    invocationId: string,
    nowMs: number,
  ): Promise<boolean> {
    const row = await (await this.database.prepare(`
      SELECT 1 FROM resource_write_permits
      WHERE org_id = ? AND invocation_id = ? AND status = 'active' AND expires_at_ms > ?
      LIMIT 1
    `)).get(tenant.orgId, invocationId, nowMs);
    return Boolean(row);
  }

  async #expireInvocationPermits(
    tenant: TTenantContext,
    invocationId: string,
    nowMs: number,
  ): Promise<void> {
    await (await this.database.prepare(`
      UPDATE resource_write_permits SET status = 'expired'
      WHERE org_id = ? AND invocation_id = ? AND status = 'active' AND expires_at_ms <= ?
    `)).run(tenant.orgId, invocationId, nowMs);
  }

  async #expireWritePermitsInScope(
    tenant: TTenantContext,
    nowMs: number,
    limit: number,
  ): Promise<number> {
    const rows = await (await this.database.prepare(`
      SELECT permit.id FROM resource_write_permits AS permit
      JOIN function_invocations AS invocation
        ON invocation.org_id = permit.org_id AND invocation.id = permit.invocation_id
      WHERE permit.org_id = ? AND invocation.tenant_cell_id = ?
        AND invocation.tenant_placement_epoch = ?
        AND permit.status = 'active' AND permit.expires_at_ms <= ?
      ORDER BY permit.expires_at_ms ASC, permit.id ASC LIMIT ?
    `)).all(tenant.orgId, tenant.cellId, tenant.placementEpoch, nowMs, limit);
    if (rows.length === 0) return 0;
    const ids = (rows as Record<string, unknown>[]).map((row) => String(row.id));
    const result = await (await this.database.prepare(`
      UPDATE resource_write_permits SET status = 'expired'
      WHERE org_id = ? AND status = 'active' AND expires_at_ms <= ?
        AND id IN (${ids.map(() => '?').join(', ')})
    `)).run(tenant.orgId, nowMs, ...ids);
    return Number(result.changes);
  }

  async #isPermitFenceLive(
    tenant: TTenantContext,
    scope: TResourceWritePermitScope,
    nowMs: number,
  ): Promise<boolean> {
    const row = await (await this.database.prepare(`
      SELECT 1
      FROM resource_write_permits AS permit
      JOIN invocation_leases AS lease
        ON lease.org_id = permit.org_id
       AND lease.invocation_id = permit.invocation_id
       AND lease.attempt_id = permit.attempt_id
       AND lease.lease_epoch = permit.lease_epoch
      JOIN function_invocations AS invocation
        ON invocation.org_id = permit.org_id AND invocation.id = permit.invocation_id
      WHERE permit.org_id = ? AND permit.id = ? AND permit.resource_id = ?
        AND permit.invocation_id = ? AND permit.attempt_id = ? AND permit.lease_epoch = ?
        AND permit.operation_name = ? AND permit.operation_id = ?
        AND permit.operation_fingerprint_sha256 = ?
        AND permit.status = 'active' AND permit.expires_at_ms > ?
        AND lease.expires_at_ms > ? AND invocation.status = 'running'
        AND invocation.tenant_cell_id = ? AND invocation.tenant_placement_epoch = ?
        AND invocation.cancel_requested_at_ms IS NULL
    `)).get(
      tenant.orgId,
      scope.claims.permitId,
      scope.resourceId,
      scope.claims.invocationId,
      scope.claims.attemptId,
      scope.claims.leaseEpoch,
      scope.operation,
      scope.operationId,
      scope.operationFingerprintSha256,
      nowMs,
      nowMs,
      tenant.cellId,
      tenant.placementEpoch,
    );
    return Boolean(row);
  }

  async #timeoutQueuedInvocation(
    tenant: TTenantContext,
    invocationId: string,
    nowMs: number,
  ): Promise<void> {
    const failure = terminalFailure(
      'platform',
      'FUNCTION_DEADLINE_EXCEEDED',
      'Function invocation deadline elapsed before execution.',
      false,
    );
    await (await this.database.prepare(`
      UPDATE function_invocations
      SET status = 'timed_out', failure_json = ?, finished_at_ms = ?
      WHERE org_id = ? AND id = ? AND tenant_cell_id = ? AND tenant_placement_epoch = ?
        AND status = 'queued' AND deadline_at_ms <= ?
    `)).run(
      fnFunctionCanonicalJson(failure),
      nowMs,
      tenant.orgId,
      invocationId,
      tenant.cellId,
      tenant.placementEpoch,
      nowMs,
    );
  }

  async #deleteExpiredIdempotencyKey(
    tenant: TTenantContext,
    request: TInvocationCreateRequest,
    nowMs: number,
  ): Promise<void> {
    const scope = request.idempotencyScope;
    const envelope = request.envelope;
    await (await this.database.prepare(`
      DELETE FROM idempotency_records
      WHERE org_id = ? AND function_id = ? AND scope_kind = ? AND idempotency_key = ?
        AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?
        AND canvas_id IS ? AND widget_instance_id IS ?
    `)).run(
      tenant.orgId,
      envelope.functionId,
      scope.kind,
      envelope.idempotencyKey,
      nowMs,
      scope.kind === 'canvas' ? scope.canvasId : null,
      scope.kind === 'widget_instance' ? scope.widgetInstanceId : null,
    );
  }

  async #findIdempotencyRecord(
    tenant: TTenantContext,
    request: TInvocationCreateRequest,
  ): Promise<Record<string, unknown> | null> {
    const scope = request.idempotencyScope;
    const row = await (await this.database.prepare(`
      SELECT * FROM idempotency_records
      WHERE org_id = ? AND function_id = ? AND scope_kind = ? AND idempotency_key = ?
        AND canvas_id IS ? AND widget_instance_id IS ?
    `)).get(
      tenant.orgId,
      request.envelope.functionId,
      scope.kind,
      request.envelope.idempotencyKey,
      scope.kind === 'canvas' ? scope.canvasId : null,
      scope.kind === 'widget_instance' ? scope.widgetInstanceId : null,
    );
    return row ? row as Record<string, unknown> : null;
  }

  #definitionMatchesEnvelope(
    definition: TFunctionDefinition,
    envelope: TInvocationRecord['envelope'],
  ): boolean {
    return definition.id === envelope.functionId
      && definition.widgetDefinitionId === envelope.widgetDefinitionId
      && definition.widgetRevisionId === envelope.widgetRevisionId
      && definition.name === envelope.functionName
      && definition.definitionRevision === envelope.definitionRevision
      && definition.artifactDigestSha256 === envelope.artifactDigestSha256
      && definition.contractDigestSha256 === envelope.contractDigestSha256
      && definition.runtimeAbi === envelope.runtimeAbi
      && fnFunctionCanonicalJson(definition.limits) === fnFunctionCanonicalJson(envelope.limits)
      && fnFunctionCanonicalJson(definition.retry) === fnFunctionCanonicalJson(envelope.retry);
  }

  #assertEnvelopeTenant(
    tenant: TTenantContext,
    snapshot: TTenantContext,
    invocationId: string,
  ): void {
    if (
      snapshot.orgId !== tenant.orgId
      || snapshot.accountId !== tenant.accountId
      || snapshot.cellId !== tenant.cellId
      || snapshot.placementEpoch !== tenant.placementEpoch
      || snapshot.requestId !== tenant.requestId
      || snapshot.canvasId !== tenant.canvasId
      || (snapshot.invocationId !== undefined && snapshot.invocationId !== invocationId)
      || fnFunctionCanonicalJson(snapshot.roles) !== fnFunctionCanonicalJson(tenant.roles)
      || fnFunctionCanonicalJson(snapshot.capabilities) !== fnFunctionCanonicalJson(tenant.capabilities)
    ) {
      throw functionStoreError(
        'FUNCTION_TENANT_AUTHORITY_MISMATCH',
        'Invocation tenant snapshot does not match the authoritative request context.',
      );
    }
  }

  #assertIdempotencyScope(
    request: TInvocationCreateRequest,
    widgetInstanceId: string,
    canvasId: string,
  ): void {
    const scope = request.idempotencyScope;
    if (scope.kind === 'canvas' && scope.canvasId !== canvasId) {
      throw functionStoreError('FUNCTION_IDEMPOTENCY_SCOPE_MISMATCH', 'Canvas idempotency scope is invalid.');
    }
    if (scope.kind === 'widget_instance' && scope.widgetInstanceId !== widgetInstanceId) {
      throw functionStoreError(
        'FUNCTION_IDEMPOTENCY_SCOPE_MISMATCH',
        'Widget-instance idempotency scope is invalid.',
      );
    }
  }

  #assertCompletion(
    invocation: TInvocationRecord,
    attempt: TFunctionAttempt,
    request: TInvocationAttemptCompletionRequest,
  ): void {
    if (request.status === 'succeeded') {
      if (attempt.status !== 'running') throw new TypeError('A starting attempt cannot succeed.');
      if (request.failure !== null) throw new TypeError('A successful attempt cannot include a failure.');
      fnFunctionCanonicalJson(request.output);
    } else if (request.failure === null || request.failure.owner === 'user' && request.failure.retryable) {
      throw new TypeError('A failed attempt requires a valid terminal failure.');
    }
    if (!Number.isSafeInteger(request.outputByteSize) || request.outputByteSize < 0
      || request.outputByteSize > invocation.envelope.limits.outputByteLimit) {
      throw functionStoreError('FUNCTION_OUTPUT_LIMIT_EXCEEDED', 'Function output byte limit exceeded.');
    }
    if (!Number.isSafeInteger(request.logByteSize) || request.logByteSize < 0
      || request.logByteSize > invocation.envelope.limits.logByteLimit) {
      throw functionStoreError('FUNCTION_LOG_LIMIT_EXCEEDED', 'Function log byte limit exceeded.');
    }
  }

  #invocationPlacementMatches(
    tenant: TTenantContext,
    invocation: TInvocationRecord,
  ): boolean {
    return invocation.envelope.tenant.orgId === tenant.orgId
      && invocation.envelope.tenant.cellId === tenant.cellId
      && invocation.envelope.tenant.placementEpoch === tenant.placementEpoch;
  }

  async #hasInvocationCallerAuthority(
    tenant: TTenantContext,
    invocation: TInvocationRecord,
  ): Promise<boolean> {
    const canvasId = invocation.envelope.tenant.canvasId;
    if (
      invocation.envelope.tenant.accountId !== tenant.accountId
      || canvasId === undefined
      || (tenant.canvasId !== undefined && tenant.canvasId !== canvasId)
    ) {
      return false;
    }
    const membership = await (await this.database.prepare(`
      SELECT 1
      FROM canvas_members
      WHERE org_id = ? AND canvas_id = ? AND account_id = ?
      LIMIT 1
    `)).get(tenant.orgId, canvasId, tenant.accountId);
    return membership != null;
  }

  #assertPermitScope(tenant: TTenantContext, scope: TResourceWritePermitScope): void {
    if (
      scope.claims.orgId !== tenant.orgId
      || scope.claims.resourceId !== scope.resourceId
      || scope.claims.operation !== scope.operation
      || scope.claims.operationId !== scope.operationId
      || scope.claims.operationFingerprintSha256 !== scope.operationFingerprintSha256
    ) {
      throw functionStoreError(
        'RESOURCE_WRITE_CAPABILITY_INVALID',
        'Resource write capability does not match the resolved operation.',
      );
    }
  }

  #highWaterMetrics(previous: TUsageMetrics, next: TUsageMetrics): TUsageMetrics {
    return {
      activeWallMs: Math.max(previous.activeWallMs, next.activeWallMs),
      cpuMs: Math.max(previous.cpuMs, next.cpuMs),
      allocatedMemoryByteMs: Math.max(
        previous.allocatedMemoryByteMs,
        next.allocatedMemoryByteMs,
      ),
      peakRssBytes: Math.max(previous.peakRssBytes, next.peakRssBytes),
      diskReadBytes: Math.max(previous.diskReadBytes, next.diskReadBytes),
      diskWriteBytes: Math.max(previous.diskWriteBytes, next.diskWriteBytes),
      networkRxBytes: Math.max(previous.networkRxBytes, next.networkRxBytes),
      networkTxBytes: Math.max(previous.networkTxBytes, next.networkTxBytes),
    };
  }

  #runImmediate<T>(tenant: TTenantContext, operation: () => Promise<T>): Promise<T> {
    const current = this.#transactionScope.getStore();
    if (current?.active) {
      if (current.orgId !== tenant.orgId) {
        return Promise.reject(functionStoreError(
          'FUNCTION_TRANSACTION_SCOPE_MISMATCH',
          'A function control transaction cannot cross organization scope.',
        ));
      }
      return operation();
    }
    return txRunDatabaseTransaction({ database: this.database }, {
      operation: async () => {
        const scope: TTransactionScope = { active: true, orgId: tenant.orgId };
        return this.#transactionScope.run(scope, async () => {
          try {
            return await operation();
          } finally {
            scope.active = false;
          }
        });
      },
    });
  }

  #positiveTtl(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('TTL must be a positive integer.');
  }

  #batchLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > FUNCTION_CONTROL_STORE_MAX_BATCH) {
      throw new TypeError(
        `Batch limit must be an integer between 1 and ${FUNCTION_CONTROL_STORE_MAX_BATCH}.`,
      );
    }
    return value;
  }
}
