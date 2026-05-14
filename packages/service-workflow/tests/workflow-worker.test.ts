import { afterEach, describe, expect, test } from 'bun:test';
import { WorkflowSuperviserService, WorkflowWorkerService } from '../src/index';
import type { TWorkflowSandboxExecutor } from '../src/index';
import { createExecutor, createStep, createWorkflowDefinition, createWorkflowTestDb, getStepByKey } from './fixtures';

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

describe('WorkflowWorkerService', () => {
  test('drains runnable workflow steps through the sandbox executor', async () => {
    const calls: string[] = [];
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const worker = new WorkflowWorkerService({ db, workerId: 'worker-a', sandboxName: 'test-sandbox', runStepInSandbox: createExecutor(calls) });

    const run = await superviser.ensureRun({ definition: createWorkflowDefinition([createStep(0), createStep(1)]), runId: 'run-1', correlationId: 'corr-1' });
    const result = await worker.drain();

    expect(result).toEqual({ completedSteps: 2, failedSteps: 0 });
    expect(calls).toEqual(['fn.step0', 'fn.step1']);
    expect((await db.getRun(run.id)).status).toBe('completed');
  });

  test('passes previous results and opaque portalSpec to executor', async () => {
    const seen: unknown[] = [];
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const worker = new WorkflowWorkerService({
      db,
      workerId: 'worker-a',
      sandboxName: 'test-sandbox',
      runStepInSandbox: ({ step, previousResults, portalSpec }) => {
        seen.push({ step: step.stepKey, previousResults, portalSpec });
        return { value: step.stepIndex };
      },
    });

    await superviser.ensureRun({
      definition: createWorkflowDefinition([createStep(0, 'fn.step0', { bundleId: 'bundle-a' }), createStep(1, 'fn.step1', { bundleId: 'bundle-b' })]),
      runId: 'run-1',
      correlationId: 'corr-1',
    });

    await worker.drain();

    expect(seen).toEqual([
      { step: 'step-0', previousResults: [], portalSpec: { bundleId: 'bundle-a' } },
      { step: 'step-1', previousResults: [{ value: 0 }], portalSpec: { bundleId: 'bundle-b' } },
    ]);
  });

  test('failure marks current step and run failed without running later steps', async () => {
    const calls: string[] = [];
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const worker = new WorkflowWorkerService({
      db,
      workerId: 'worker-a',
      sandboxName: 'test-sandbox',
      runStepInSandbox: ({ step }) => {
        calls.push(step.functionName);
        if (step.functionName === 'fn.fail') throw new Error('sandbox failed');
        return { value: step.stepIndex };
      },
    });
    const run = await superviser.ensureRun({ definition: createWorkflowDefinition([createStep(0), createStep(1, 'fn.fail'), createStep(2)]), runId: 'run-1', correlationId: 'corr-1' });

    const result = await worker.drain();

    expect(result).toEqual({ completedSteps: 1, failedSteps: 1 });
    expect(calls).toEqual(['fn.step0', 'fn.fail']);
    expect((await db.getRun(run.id)).status).toBe('failed');
    expect((await getStepByKey(db, run.id, 'step-1')).status).toBe('failed');
    expect((await getStepByKey(db, run.id, 'step-2')).status).toBe('pending');
  });

  test('retry resumes at the failed step without rerunning prior successful steps', async () => {
    const calls: string[] = [];
    let shouldFail = true;
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const worker = new WorkflowWorkerService({
      db,
      workerId: 'worker-a',
      sandboxName: 'test-sandbox',
      runStepInSandbox: ({ step }) => {
        calls.push(step.functionName);
        if (step.functionName === 'fn.flaky' && shouldFail) throw new Error('flaky failed');
        return { value: step.stepIndex };
      },
    });
    const run = await superviser.ensureRun({ definition: createWorkflowDefinition([createStep(0), createStep(1, 'fn.flaky'), createStep(2)]), runId: 'run-1', correlationId: 'corr-1' });

    await worker.drain();
    shouldFail = false;
    await superviser.retryRun({ runId: run.id });
    await worker.drain();

    expect(calls).toEqual(['fn.step0', 'fn.flaky', 'fn.flaky', 'fn.step2']);
    expect((await db.getRun(run.id)).status).toBe('completed');
  });

  test('active leases block competing workers until expiry', async () => {
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const workerB = new WorkflowWorkerService({ db, workerId: 'worker-b', sandboxName: 'test-sandbox', leaseMs: 10, runStepInSandbox: createExecutor() });
    const run = await superviser.ensureRun({ definition: createWorkflowDefinition([createStep(0)]), runId: 'run-1', correlationId: 'corr-1' });
    const step = await getStepByKey(db, run.id, 'step-0');
    await db.claimStep(step.id, 'worker-a', { leaseMs: 10_000 });

    expect(await workerB.drain()).toEqual({ completedSteps: 0, failedSteps: 0 });

    await db.patchStep(step.id, { leaseExpiresAt: new Date(Date.now() - 1) });
    expect(await workerB.drain()).toEqual({ completedSteps: 1, failedSteps: 0 });
    expect((await getStepByKey(db, run.id, 'step-0')).claimedByRunId).toBe('worker-b');
  });

  test('non JSON serializable result fails before success is stored', async () => {
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const worker = new WorkflowWorkerService({ db, workerId: 'worker-a', sandboxName: 'test-sandbox', runStepInSandbox: (() => ({ bad: undefined })) as TWorkflowSandboxExecutor });
    const run = await superviser.ensureRun({ definition: createWorkflowDefinition([createStep(0)]), runId: 'run-1', correlationId: 'corr-1' });

    await worker.drain();

    expect((await db.getRun(run.id)).status).toBe('failed');
    expect((await getStepByKey(db, run.id, 'step-0')).status).toBe('failed');
    expect((await getStepByKey(db, run.id, 'step-0')).result).toBeNull();
  });

  test('tx step is retried after lease expiry with the same idempotency key', async () => {
    const seenKeys: string[] = [];
    const { workflowDb: db, cleanup: cleanupDb } = await createWorkflowTestDb();
    cleanup.push(cleanupDb);
    const superviser = new WorkflowSuperviserService({ db });
    const workerA = new WorkflowWorkerService({ db, workerId: 'worker-a', sandboxName: 'test-sandbox', leaseMs: 10, runStepInSandbox: ({ step }) => { seenKeys.push(step.idempotencyKey); throw new Error('worker-a crashed after ambiguous tx request'); } });
    const workerB = new WorkflowWorkerService({ db, workerId: 'worker-b', sandboxName: 'test-sandbox', leaseMs: 10, runStepInSandbox: ({ step }) => { seenKeys.push(step.idempotencyKey); return { wrote: true }; } });
    const run = await superviser.ensureRun({ definition: createWorkflowDefinition([{ ...createStep(0, 'tx.write'), idempotencyKey: 'tx-run-1-step-0' }]), runId: 'run-1', correlationId: 'corr-1' });
    const txStep = await getStepByKey(db, run.id, 'step-0');

    await workerA.drain();
    await superviser.retryRun({ runId: run.id });
    await db.patchStep(txStep.id, { leaseExpiresAt: new Date(Date.now() - 1) });
    await workerB.drain();

    expect(seenKeys).toEqual(['tx-run-1-step-0', 'tx-run-1-step-0']);
    expect((await getStepByKey(db, run.id, 'step-0')).attempt).toBe(2);
    expect((await db.getRun(run.id)).status).toBe('completed');
  });
});
