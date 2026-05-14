import type { IService, IServiceContext, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import { fnAssertJsonSerializable, fnIsCompletedStep, fnIsTerminalRunStatus, fnPreviousResults, fnToWorkflowError } from './fn.workflow';
import type { TWorkflowDb, TWorkflowJson, TWorkflowRunRow, TWorkflowSandboxExecutor, TWorkflowStepRow } from './types';

export type TWorkflowWorkerConfig = {
  readonly db: TWorkflowDb;
  readonly workerId: string;
  readonly sandboxName: string;
  readonly runStepInSandbox: TWorkflowSandboxExecutor;
  readonly leaseMs?: number;
  readonly pollIntervalMs?: number;
};
export type TWorkflowWorkerRunOnceResult = { readonly status: 'idle' } | { readonly status: 'completed' | 'failed'; readonly run: TWorkflowRunRow; readonly step: TWorkflowStepRow };
export type TWorkflowWorkerDrainResult = { readonly completedSteps: number; readonly failedSteps: number };
export type TWorkflowWorkerStatus = { readonly polling: boolean; readonly lastError: string | null };
export type TWorkflowWorkerHooks = object;
export type TWorkflowWorkerRuntimeConfig = { readonly workflowWorker?: { readonly autoStart?: boolean } };

export class WorkflowWorkerService implements IService<TWorkflowWorkerHooks>, IStartableService<TWorkflowWorkerHooks, TWorkflowWorkerRuntimeConfig>, IStoppableService {
  readonly name = 'workflowWorker';
  readonly db: TWorkflowDb;
  readonly workerId: string;
  readonly sandboxName: string;
  readonly runStepInSandbox: TWorkflowSandboxExecutor;
  readonly leaseMs: number;
  readonly pollIntervalMs: number;
  #polling = false;
  #lastError: string | null = null;

  constructor(config: TWorkflowWorkerConfig) {
    this.db = config.db;
    this.workerId = config.workerId;
    this.sandboxName = config.sandboxName;
    this.runStepInSandbox = config.runStepInSandbox;
    this.leaseMs = config.leaseMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 1_000;
  }

  start(ctx: IServiceContext<TWorkflowWorkerHooks, TWorkflowWorkerRuntimeConfig>): void {
    if (ctx.config.workflowWorker?.autoStart === false) return;
    this.startPolling();
  }

  async runOnce(): Promise<TWorkflowWorkerRunOnceResult> {
    const run = (await this.db.getRunnableRuns())[0];
    if (!run || fnIsTerminalRunStatus(run.status)) return { status: 'idle' };
    const nextStep = (await this.db.getStepsForRun(run.id)).find((step) => !fnIsCompletedStep(step));
    if (!nextStep || nextStep.status === 'failed') return { status: 'idle' };
    return await this.executeStep(run, nextStep);
  }

  async drain(): Promise<TWorkflowWorkerDrainResult> {
    let completedSteps = 0;
    let failedSteps = 0;
    while (true) {
      const result = await this.runOnce();
      if (result.status === 'idle') return { completedSteps, failedSteps };
      if (result.status === 'completed') completedSteps += 1;
      else failedSteps += 1;
    }
  }

  startPolling(): void {
    if (this.#polling) return;
    this.#polling = true;
    void this.poll();
  }

  stop(): void { this.#polling = false; }
  getStatus(): TWorkflowWorkerStatus { return { polling: this.#polling, lastError: this.#lastError }; }

  private async poll(): Promise<void> {
    while (this.#polling) {
      try { await this.runOnce(); this.#lastError = null; }
      catch (error) { this.#lastError = error instanceof Error ? error.message : String(error); }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private async executeStep(run: TWorkflowRunRow, step: TWorkflowStepRow): Promise<TWorkflowWorkerRunOnceResult> {
    let currentRun = await this.db.patchRun(run.id, { status: 'running', lastHeartbeatAt: new Date(), error: null });
    const claimedStep = await this.db.claimStep(step.id, this.workerId, { leaseMs: this.leaseMs });
    let runningStep = await this.db.patchStep(claimedStep.id, { status: 'running', attempt: claimedStep.attempt + 1, startedAt: claimedStep.startedAt ?? new Date(), error: null });

    if (runningStep.functionKind === 'tx') {
      const existingResult = await this.db.getTxResult(runningStep.idempotencyKey);
      if (existingResult !== undefined) {
        const succeededStep = await this.succeedStep(runningStep, existingResult);
        currentRun = await this.advanceOrCompleteRun(currentRun, succeededStep);
        return { status: 'completed', run: currentRun, step: succeededStep };
      }
    }

    const sandboxRun = await this.db.createSandboxRun({
      workflowRunId: currentRun.id,
      workflowStepId: runningStep.id,
      portalKind: runningStep.functionKind,
      functionName: runningStep.functionName,
      idempotencyKey: runningStep.functionKind === 'tx' ? runningStep.idempotencyKey : null,
      portalSpec: runningStep.portalSpec,
      input: runningStep.args,
      sandboxName: this.sandboxName,
    });
    runningStep = await this.db.patchStep(runningStep.id, { sandboxRunId: sandboxRun.id });

    try {
      const result = await this.runStepInSandbox({ run: currentRun, step: runningStep, previousResults: fnPreviousResults(await this.db.getStepsForRun(currentRun.id), runningStep.stepIndex), portalSpec: runningStep.portalSpec });
      fnAssertJsonSerializable(result);
      const storedResult = runningStep.functionKind === 'tx' ? await this.db.saveTxResult(runningStep.idempotencyKey, result) : result;
      await this.db.patchSandboxRun(sandboxRun.id, { status: 'succeeded', completedAt: new Date() });
      const succeededStep = await this.succeedStep(runningStep, storedResult);
      currentRun = await this.advanceOrCompleteRun(currentRun, succeededStep);
      return { status: 'completed', run: currentRun, step: succeededStep };
    } catch (error) {
      await this.db.patchSandboxRun(sandboxRun.id, { status: 'failed', completedAt: new Date() });
      const workflowError = fnToWorkflowError(error);
      const failedStep = await this.db.patchStep(runningStep.id, { status: 'failed', error: workflowError, completedAt: new Date() });
      const failedRun = await this.db.patchRun(currentRun.id, { status: 'failed', currentStepIndex: runningStep.stepIndex, error: workflowError, lastHeartbeatAt: new Date() });
      return { status: 'failed', run: failedRun, step: failedStep };
    }
  }

  private async succeedStep(step: TWorkflowStepRow, result: TWorkflowJson): Promise<TWorkflowStepRow> {
    return await this.db.patchStep(step.id, { status: 'succeeded', result, error: null, completedAt: new Date() });
  }

  private async advanceOrCompleteRun(run: TWorkflowRunRow, step: TWorkflowStepRow): Promise<TWorkflowRunRow> {
    const advancedRun = await this.db.patchRun(run.id, { currentStepIndex: step.stepIndex + 1, lastHeartbeatAt: new Date() });
    const steps = await this.db.getStepsForRun(run.id);
    if (steps.length === advancedRun.stepCount && steps.every(fnIsCompletedStep)) return await this.db.completeRunAtomically(run.id);
    return advancedRun;
  }
}
