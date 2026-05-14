import type { TWorkflowDefinition, TWorkflowEnsureRunArgs, TWorkflowError, TWorkflowJson, TWorkflowStepRow } from './types';

export function fnAssertWorkflowDefinition(definition: TWorkflowDefinition): void {
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

export function fnWorkflowRunFingerprint(args: TWorkflowEnsureRunArgs): string {
  return JSON.stringify({
    workspaceId: args.workspaceId ?? null,
    canvasId: args.canvasId ?? null,
    workflowKind: args.definition.workflowKind,
    subjectId: args.subjectId ?? null,
    triggerId: args.triggerId ?? null,
    steps: [...args.definition.steps]
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .map((step) => ({
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

export function fnIsTerminalRunStatus(status: string): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function fnIsCompletedStep(step: TWorkflowStepRow): boolean {
  return step.status === 'succeeded' || step.status === 'skipped';
}

export function fnPreviousResults(steps: readonly TWorkflowStepRow[], beforeStepIndex: number): readonly TWorkflowJson[] {
  return steps.filter((step) => step.stepIndex < beforeStepIndex && step.status === 'succeeded').map((step) => step.result);
}

export function fnToWorkflowError(error: unknown): TWorkflowError {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}

export function fnAssertJsonSerializable(value: TWorkflowJson): void {
  if (!fnIsJsonSerializable(value)) throw new Error('Workflow function result is not JSON serializable');
}

export function fnIsJsonSerializable(value: unknown): value is TWorkflowJson {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(fnIsJsonSerializable);
  if (type !== 'object' || !value) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every(fnIsJsonSerializable);
}
