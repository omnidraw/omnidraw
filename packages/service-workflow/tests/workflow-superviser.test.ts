import { afterEach, describe, expect, test } from 'bun:test';
import { WorkflowSuperviserService } from '../src/index';
import { createStep, createWorkflowDefinition, createWorkflowTestDb, getStepByKey } from './fixtures';

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe('WorkflowSuperviserService', () => {
  test('creating the same run twice reuses existing run and steps', async () => {
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const definition = createWorkflowDefinition([createStep(0), createStep(1)]);

    const first = await superviser.ensureRun({ definition, runId: 'run-1', correlationId: 'corr-1' });
    const second = await superviser.ensureRun({ definition, runId: 'run-1', correlationId: 'corr-1' });

    expect(second.id).toBe(first.id);
    expect(await db.getRunnableRuns()).toHaveLength(1);
    expect(await db.getStepsForRun(first.id)).toHaveLength(2);
    expect(second.workspaceId).toBeNull();
  });

  test('rejects reused runId with a different definition', async () => {
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });

    await superviser.ensureRun({ definition: createWorkflowDefinition([createStep(0)]), runId: 'run-1', correlationId: 'corr-1' });

    await expect(superviser.ensureRun({
      definition: createWorkflowDefinition([createStep(0), createStep(1)]),
      runId: 'run-1',
      correlationId: 'corr-1',
    })).rejects.toThrow('existing runId');
  });

  test('validates step indexes, keys, and tx idempotency keys', async () => {
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });

    await expect(superviser.ensureRun({
      definition: createWorkflowDefinition([createStep(0), { ...createStep(1), stepKey: 'step-0' }]),
      runId: 'run-keys',
      correlationId: 'corr-1',
    })).rejects.toThrow('Duplicate workflow step key');

    await expect(superviser.ensureRun({
      definition: createWorkflowDefinition([createStep(0), { ...createStep(2), stepKey: 'step-2' }]),
      runId: 'run-indexes',
      correlationId: 'corr-2',
    })).rejects.toThrow('contiguous');

    await expect(superviser.ensureRun({
      definition: createWorkflowDefinition([createStep(0, 'tx.write'), { ...createStep(1, 'tx.write'), idempotencyKey: 'idem-step-0' }]),
      runId: 'run-tx',
      correlationId: 'corr-3',
    })).rejects.toThrow('Duplicate tx idempotency key');
  });

  test('retry resets failed step and leaves terminal runs alone', async () => {
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const run = await superviser.ensureRun({
      definition: createWorkflowDefinition([createStep(0), createStep(1)]),
      runId: 'run-1',
      correlationId: 'corr-1',
    });
    const failedStep = await getStepByKey(db, run.id, 'step-1');

    await db.patchStep(failedStep.id, {
      status: 'failed',
      error: { message: 'failed' },
      claimedByRunId: 'worker-a',
      claimedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 10_000),
    });
    await db.patchRun(run.id, { status: 'failed', currentStepIndex: 1, error: { message: 'failed' } });

    const retried = await superviser.retryRun({ runId: run.id });
    const resetStep = await getStepByKey(db, run.id, 'step-1');

    expect(retried.status).toBe('running');
    expect(retried.currentStepIndex).toBe(1);
    expect(resetStep.status).toBe('pending');
    expect(resetStep.claimedByRunId).toBeNull();

    await db.patchRun(run.id, { status: 'cancelled' });
    expect((await superviser.retryRun({ runId: run.id })).status).toBe('cancelled');
  });
});
