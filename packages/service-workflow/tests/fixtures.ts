import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import { SqliteWorkflowDb } from '../src/index';
import type { TWorkflowDefinition, TWorkflowJson, TWorkflowSandboxExecutor, TWorkflowStepDefinition, TWorkflowStepRow } from '../src/index';

export type TWorkflowTestDb = {
  readonly dbService: DbServiceBunSqlite;
  readonly workflowDb: SqliteWorkflowDb;
  readonly cleanup: () => Promise<void>;
};

export async function createWorkflowTestDb(): Promise<TWorkflowTestDb> {
  const root = mkdtempSync(join(tmpdir(), 'vibecanvas-service-workflow-'));
  const dbService = new DbServiceBunSqlite({
    databasePath: join(root, 'test.sqlite'),
    dataDir: root,
    cacheDir: root,
    silentMigrations: true,
  });
  await dbService.start();

  return {
    dbService,
    workflowDb: new SqliteWorkflowDb({ db: dbService.drizzle }),
    cleanup: async () => {
      await dbService.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function createStep(
  index: number,
  functionName = `fn.step${index}`,
  portalSpec: TWorkflowJson = { bundle: 'test' },
): TWorkflowStepDefinition {
  return {
    stepKey: `step-${index}`,
    stepIndex: index,
    functionKind: functionName.startsWith('tx.') ? 'tx' : functionName.startsWith('fx.') ? 'fx' : 'fn',
    functionName,
    args: { index },
    idempotencyKey: `idem-step-${index}`,
    portalSpec,
  };
}

export function createWorkflowDefinition(steps: readonly TWorkflowStepDefinition[]): TWorkflowDefinition {
  return { workflowKind: 'test-workflow', steps };
}

export function createExecutor(calls: string[] = []): TWorkflowSandboxExecutor {
  return ({ step }) => {
    calls.push(step.functionName);
    return step.functionName === 'tx.write' ? { wrote: true } : { value: step.stepIndex };
  };
}

export async function getStepByKey(db: SqliteWorkflowDb, runId: string, stepKey: string): Promise<TWorkflowStepRow> {
  const step = db.getStepsForRun(runId).find((candidate) => candidate.stepKey === stepKey);
  if (!step) throw new Error(`missing step ${stepKey}`);
  return step;
}
