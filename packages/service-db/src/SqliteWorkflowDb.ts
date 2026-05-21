import { and, asc, eq, inArray } from 'drizzle-orm';
import type { TDrizzleDb } from './DbServiceBunSqlite/index';
import * as schema from './schema';
import type { TWorkflowDefinition, TSandboxRunRow, TWorkflowClaimOptions, TWorkflowCreateSandboxRunArgs, TWorkflowDb, TWorkflowEnsureRunArgs, TWorkflowJson, TWorkflowRunRow, TWorkflowStepDefinition, TWorkflowStepRow } from '@vibecanvas/service-workflow';

export type TSqliteWorkflowDbConfig = { readonly db: TDrizzleDb; readonly randomId?: () => string };

type TWorkflowRunSelect = typeof schema.workflow_runs.$inferSelect;
type TWorkflowStepSelect = typeof schema.workflow_steps.$inferSelect;
type TSandboxRunSelect = typeof schema.sandbox_runs.$inferSelect;

function fnAssertWorkflowDefinition(definition: TWorkflowDefinition): void {
  const keys = new Set<string>();
  const indexes = new Set<number>();
  const txIdempotencyKeys = new Set<string>();
  for (const step of definition.steps) {
    if (keys.has(step.stepKey)) throw new Error(`Duplicate workflow step key "${step.stepKey}"`);
    keys.add(step.stepKey);
    if (indexes.has(step.stepIndex)) throw new Error(`Duplicate workflow step index "${step.stepIndex}"`);
    indexes.add(step.stepIndex);
    if (step.functionKind === 'tx') {
      if (step.idempotencyKey.trim().length === 0) throw new Error(`tx workflow step "${step.stepKey}" requires a non-empty idempotency key`);
      if (txIdempotencyKeys.has(step.idempotencyKey)) throw new Error(`Duplicate tx idempotency key "${step.idempotencyKey}"`);
      txIdempotencyKeys.add(step.idempotencyKey);
    }
  }
  for (let index = 0; index < definition.steps.length; index += 1) {
    if (!indexes.has(index)) throw new Error('Workflow step indexes must be contiguous from 0');
  }
}

function fnWorkflowRunFingerprint(args: TWorkflowEnsureRunArgs): string {
  return JSON.stringify({
    workspaceId: args.workspaceId ?? null,
    canvasId: args.canvasId ?? null,
    workflowKind: args.definition.workflowKind,
    subjectId: args.subjectId ?? null,
    triggerId: args.triggerId ?? null,
    steps: [...args.definition.steps].sort((a, b) => a.stepIndex - b.stepIndex).map((step) => ({
      stepKey: step.stepKey,
      stepIndex: step.stepIndex,
      phase: step.phase ?? null,
      functionKind: step.functionKind,
      functionName: step.functionName,
      idempotencyKey: step.idempotencyKey,
      portalSpec: step.portalSpec ?? null,
      args: step.args,
    })),
  });
}

export class SqliteWorkflowDb implements TWorkflowDb {
  readonly db: TDrizzleDb;
  readonly randomId: () => string;

  constructor(config: TSqliteWorkflowDbConfig) {
    this.db = config.db;
    this.randomId = config.randomId ?? (() => crypto.randomUUID());
  }

  ensureRun(args: TWorkflowEnsureRunArgs): TWorkflowRunRow {
    fnAssertWorkflowDefinition(args.definition);
    const existing = this.db.query.workflow_runs.findFirst({ where: eq(schema.workflow_runs.run_id, args.runId) }).sync();
    if (existing) {
      const steps = this.getStepsForRun(existing.id);
      const existingFingerprint = fnWorkflowRunFingerprint({
        definition: { workflowKind: existing.workflow_kind, steps: steps.map(rowToStepDefinition) },
        runId: existing.run_id,
        workspaceId: existing.workspace_id ?? undefined,
        canvasId: existing.canvas_id ?? undefined,
        subjectId: existing.subject_id ?? undefined,
        triggerId: existing.trigger_id ?? undefined,
        correlationId: existing.correlation_id,
        causationId: existing.causation_id ?? undefined,
      });
      if (existingFingerprint !== fnWorkflowRunFingerprint(args)) throw new Error(`Cannot reuse existing runId "${args.runId}" with a different workflow definition`);
      return rowToRun(existing);
    }

    return this.db.transaction((tx) => {
      const run = tx.insert(schema.workflow_runs).values({
        id: this.randomId(), workspace_id: args.workspaceId ?? null, canvas_id: args.canvasId ?? null,
        run_id: args.runId, workflow_kind: args.definition.workflowKind, subject_id: args.subjectId ?? null,
        trigger_id: args.triggerId ?? null, correlation_id: args.correlationId, causation_id: args.causationId ?? null,
        current_step_index: 0, step_count: args.definition.steps.length, status: 'starting', started_at: new Date(),
      }).returning().all()[0]!;
      for (const step of args.definition.steps) {
        tx.insert(schema.workflow_steps).values({
          id: this.randomId(), workflow_run_id: run.id, step_key: step.stepKey, step_index: step.stepIndex,
          phase: step.phase ?? null, function_kind: step.functionKind, function_name: step.functionName,
          idempotency_key: step.idempotencyKey, portal_spec: step.portalSpec ?? null, args: step.args,
          status: 'pending', attempt: 0, created_at: new Date(),
        }).run();
      }
      return rowToRun(run);
    });
  }

  getRun(runId: string): TWorkflowRunRow {
    const row = this.db.query.workflow_runs.findFirst({ where: eq(schema.workflow_runs.id, runId) }).sync()
      ?? this.db.query.workflow_runs.findFirst({ where: eq(schema.workflow_runs.run_id, runId) }).sync();
    if (!row) throw new Error(`Unknown workflow run "${runId}"`);
    return rowToRun(row);
  }

  patchRun(id: string, patch: Partial<Omit<TWorkflowRunRow, 'id'>>): TWorkflowRunRow {
    this.db.update(schema.workflow_runs).set(runPatchToSqlite(patch)).where(eq(schema.workflow_runs.id, id)).run();
    return this.getRun(id);
  }

  getStepsForRun(runId: string): readonly TWorkflowStepRow[] {
    return this.db.select().from(schema.workflow_steps).where(eq(schema.workflow_steps.workflow_run_id, runId)).orderBy(asc(schema.workflow_steps.step_index)).all().map(rowToStep);
  }

  claimStep(id: string, workerId: string, options: TWorkflowClaimOptions): TWorkflowStepRow {
    const step = this.getStep(id);
    if (step.status === 'succeeded' || step.status === 'skipped' || step.status === 'failed') throw new Error(`Cannot claim terminal workflow step "${step.stepKey}"`);
    const now = new Date();
    if (step.claimedByRunId && step.claimedByRunId !== workerId && (!step.leaseExpiresAt || step.leaseExpiresAt.getTime() > now.getTime())) throw new Error(`Workflow step "${step.stepKey}" is claimed by ${step.claimedByRunId}`);
    this.db.update(schema.workflow_steps).set({ status: 'claimed', claimed_by_run_id: workerId, claimed_at: now, lease_expires_at: new Date(now.getTime() + options.leaseMs) }).where(eq(schema.workflow_steps.id, id)).run();
    return this.getStep(id);
  }

  patchStep(id: string, patch: Partial<Omit<TWorkflowStepRow, 'id'>>): TWorkflowStepRow {
    this.db.update(schema.workflow_steps).set(stepPatchToSqlite(patch)).where(eq(schema.workflow_steps.id, id)).run();
    return this.getStep(id);
  }

  createSandboxRun(args: TWorkflowCreateSandboxRunArgs): TSandboxRunRow {
    return rowToSandboxRun(this.db.insert(schema.sandbox_runs).values({
      id: this.randomId(), workflow_run_id: args.workflowRunId, workflow_step_id: args.workflowStepId,
      portal_kind: args.portalKind, function_name: args.functionName, idempotency_key: args.idempotencyKey,
      portal_spec: args.portalSpec, input: args.input, sandbox_name: args.sandboxName, status: 'started', started_at: new Date(),
    }).returning().all()[0]!);
  }

  patchSandboxRun(id: string, patch: Partial<Omit<TSandboxRunRow, 'id'>>): TSandboxRunRow {
    this.db.update(schema.sandbox_runs).set(sandboxPatchToSqlite(patch)).where(eq(schema.sandbox_runs.id, id)).run();
    const row = this.db.query.sandbox_runs.findFirst({ where: eq(schema.sandbox_runs.id, id) }).sync();
    if (!row) throw new Error(`Unknown sandbox run "${id}"`);
    return rowToSandboxRun(row);
  }

  getTxResult(idempotencyKey: string): TWorkflowJson | undefined {
    const row = this.db.query.workflow_steps.findFirst({ where: and(eq(schema.workflow_steps.function_kind, 'tx'), eq(schema.workflow_steps.idempotency_key, idempotencyKey), eq(schema.workflow_steps.status, 'succeeded')) }).sync();
    return row?.result === undefined || row.result === null ? undefined : row.result as TWorkflowJson;
  }

  saveTxResult(idempotencyKey: string, result: TWorkflowJson): TWorkflowJson {
    return this.getTxResult(idempotencyKey) ?? result;
  }

  completeRunAtomically(runId: string): TWorkflowRunRow {
    const run = this.getRun(runId);
    const steps = this.getStepsForRun(run.id);
    if (steps.length !== run.stepCount || !steps.every((step) => step.status === 'succeeded' || step.status === 'skipped')) throw new Error(`Cannot complete workflow run "${run.id}" before all steps succeed`);
    return this.patchRun(run.id, { status: 'completed', currentStepIndex: run.stepCount, completedAt: new Date(), lastHeartbeatAt: new Date(), error: null });
  }

  getRunnableRuns(): readonly TWorkflowRunRow[] {
    const runs = this.db.select().from(schema.workflow_runs).where(inArray(schema.workflow_runs.status, ['starting', 'running'])).all();
    return runs.map(rowToRun).filter((run) => !this.isBlockedByActiveLease(run.id)).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }

  private getStep(id: string): TWorkflowStepRow {
    const row = this.db.query.workflow_steps.findFirst({ where: eq(schema.workflow_steps.id, id) }).sync();
    if (!row) throw new Error(`Unknown workflow step "${id}"`);
    return rowToStep(row);
  }

  private isBlockedByActiveLease(runId: string): boolean {
    const step = this.getStepsForRun(runId).find((candidate) => candidate.status !== 'succeeded' && candidate.status !== 'skipped');
    return Boolean(step?.claimedByRunId && step.leaseExpiresAt && step.leaseExpiresAt.getTime() > Date.now());
  }
}

function rowToStepDefinition(step: TWorkflowStepRow): TWorkflowStepDefinition {
  return { stepKey: step.stepKey, stepIndex: step.stepIndex, phase: step.phase ?? undefined, functionKind: step.functionKind, functionName: step.functionName, idempotencyKey: step.idempotencyKey, portalSpec: step.portalSpec, args: step.args };
}

function rowToRun(row: TWorkflowRunSelect): TWorkflowRunRow {
  return { id: row.id, workspaceId: row.workspace_id, canvasId: row.canvas_id, runId: row.run_id, workflowKind: row.workflow_kind, subjectId: row.subject_id, triggerId: row.trigger_id, correlationId: row.correlation_id, causationId: row.causation_id, currentStepIndex: row.current_step_index, stepCount: row.step_count, status: row.status, startedAt: row.started_at, lastHeartbeatAt: row.last_heartbeat_at, completedAt: row.completed_at, error: row.error as TWorkflowRunRow['error'] ?? null };
}

function rowToStep(row: TWorkflowStepSelect): TWorkflowStepRow {
  return { id: row.id, workflowRunId: row.workflow_run_id, sandboxRunId: row.sandbox_run_id, stepKey: row.step_key, stepIndex: row.step_index, phase: row.phase, functionKind: row.function_kind, functionName: row.function_name, idempotencyKey: row.idempotency_key, portalSpec: jsonFromUnknown(row.portal_spec), args: jsonFromUnknown(row.args), status: row.status, result: row.result === null ? null : jsonFromUnknown(row.result), error: row.error as TWorkflowStepRow['error'] ?? null, claimedByRunId: row.claimed_by_run_id, claimedAt: row.claimed_at, leaseExpiresAt: row.lease_expires_at, attempt: row.attempt, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at };
}

function rowToSandboxRun(row: TSandboxRunSelect): TSandboxRunRow {
  return { id: row.id, workflowRunId: row.workflow_run_id, workflowStepId: row.workflow_step_id, portalKind: row.portal_kind, functionName: row.function_name, idempotencyKey: row.idempotency_key, portalSpec: jsonFromUnknown(row.portal_spec), input: jsonFromUnknown(row.input), sandboxName: row.sandbox_name, status: row.status, startedAt: row.started_at, completedAt: row.completed_at, stdoutFileId: row.stdout_file_id, stderrFileId: row.stderr_file_id };
}

function jsonFromUnknown(value: unknown): TWorkflowJson {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as TWorkflowJson;
    } catch {
      return value;
    }
  }
  return (value ?? null) as TWorkflowJson;
}

function runPatchToSqlite(patch: Partial<Omit<TWorkflowRunRow, 'id'>>) {
  return { workspace_id: patch.workspaceId, canvas_id: patch.canvasId, run_id: patch.runId, workflow_kind: patch.workflowKind, subject_id: patch.subjectId, trigger_id: patch.triggerId, correlation_id: patch.correlationId, causation_id: patch.causationId, current_step_index: patch.currentStepIndex, step_count: patch.stepCount, status: patch.status, started_at: patch.startedAt, last_heartbeat_at: patch.lastHeartbeatAt, completed_at: patch.completedAt, error: patch.error };
}
function stepPatchToSqlite(patch: Partial<Omit<TWorkflowStepRow, 'id'>>) {
  return { workflow_run_id: patch.workflowRunId, sandbox_run_id: patch.sandboxRunId, step_key: patch.stepKey, step_index: patch.stepIndex, phase: patch.phase, function_kind: patch.functionKind, function_name: patch.functionName, idempotency_key: patch.idempotencyKey, portal_spec: patch.portalSpec, args: patch.args, status: patch.status, result: patch.result, error: patch.error, claimed_by_run_id: patch.claimedByRunId, claimed_at: patch.claimedAt, lease_expires_at: patch.leaseExpiresAt, attempt: patch.attempt, created_at: patch.createdAt, started_at: patch.startedAt, completed_at: patch.completedAt };
}
function sandboxPatchToSqlite(patch: Partial<Omit<TSandboxRunRow, 'id'>>) {
  return { workflow_run_id: patch.workflowRunId, workflow_step_id: patch.workflowStepId, portal_kind: patch.portalKind, function_name: patch.functionName, idempotency_key: patch.idempotencyKey, portal_spec: patch.portalSpec, input: patch.input, sandbox_name: patch.sandboxName, status: patch.status, started_at: patch.startedAt, completed_at: patch.completedAt, stdout_file_id: patch.stdoutFileId, stderr_file_id: patch.stderrFileId };
}
