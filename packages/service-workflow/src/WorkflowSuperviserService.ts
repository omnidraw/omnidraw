import type { IService } from '@vibecanvas/runtime';
import { fnAssertWorkflowDefinition, fnIsTerminalRunStatus } from './fn.workflow';
import type { TWorkflowDb, TWorkflowEnsureRunArgs, TWorkflowRunRow } from './types';

export type TWorkflowSuperviserConfig = { readonly db: TWorkflowDb };
export type TWorkflowRetryRunArgs = { readonly runId: string };
export type TWorkflowCancelRunArgs = { readonly runId: string };
export type TWorkflowGetRunStatusArgs = { readonly runId: string };

export class WorkflowSuperviserService implements IService {
  readonly name = 'workflowSuperviser';
  readonly db: TWorkflowDb;

  constructor(config: TWorkflowSuperviserConfig) {
    this.db = config.db;
  }

  async ensureRun(args: TWorkflowEnsureRunArgs): Promise<TWorkflowRunRow> {
    fnAssertWorkflowDefinition(args.definition);
    return await this.db.ensureRun(args);
  }

  async retryRun(args: TWorkflowRetryRunArgs): Promise<TWorkflowRunRow> {
    const run = await this.db.getRun(args.runId);
    if (fnIsTerminalRunStatus(run.status)) return run;
    const failedStep = (await this.db.getStepsForRun(run.id)).find((step) => step.status === 'failed');
    if (failedStep) {
      await this.db.patchStep(failedStep.id, {
        status: 'pending', error: null, claimedByRunId: null, claimedAt: null,
        leaseExpiresAt: null, startedAt: null, completedAt: null,
      });
    }
    return await this.db.patchRun(run.id, {
      status: 'running',
      currentStepIndex: failedStep?.stepIndex ?? run.currentStepIndex,
      error: null,
      completedAt: null,
    });
  }

  async cancelRun(args: TWorkflowCancelRunArgs): Promise<TWorkflowRunRow> {
    const run = await this.db.getRun(args.runId);
    if (run.status === 'completed' || run.status === 'cancelled') return run;
    return await this.db.patchRun(run.id, { status: 'cancelled', completedAt: new Date() });
  }

  async getRunStatus(args: TWorkflowGetRunStatusArgs): Promise<TWorkflowRunRow> {
    return await this.db.getRun(args.runId);
  }
}
