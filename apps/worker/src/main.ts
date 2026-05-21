import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DbServiceBunSqlite } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import { WorkflowWorkerService, type TWorkflowJson, type TWorkflowSandboxExecutor } from '@vibecanvas/service-workflow';
import { fnXdgPaths } from '@vibecanvas/shared-functions/vibecanvas-config/fn.xdg-paths';
import { runStepRunner } from './step-runner';
import { StepRunnerResponseSchema, WorkerPortalSpecSchema, type TStepRunnerResponse } from './schema';

type TChild = ReturnType<typeof Bun.spawn>;
type TStepRunnerSuccessResponse = Extract<TStepRunnerResponse, { ok: true }>;
const children = new Set<TChild>();

function env(name: string, fallback: string): string { return process.env[name] ?? fallback; }
function childCommand(): string[] { return [process.execPath, 'run', process.argv[1] ?? import.meta.path]; }

function parseChildResponse(stdout: string, stderr: string, exitCode: number): TStepRunnerSuccessResponse {
  const lastLine = stdout.trim().split('\n').filter(Boolean).at(-1);
  if (!lastLine) throw new Error(`Step runner produced no response. stderr=${stderr}`);
  const response = StepRunnerResponseSchema.parse(JSON.parse(lastLine));
  if (!response.ok) throw new Error(response.stack ? `${response.error}\n${response.stack}` : response.error);
  if (exitCode !== 0) throw new Error(`Step runner exited ${exitCode}. stderr=${stderr}`);
  return response;
}

function createRunStepInChild(): TWorkflowSandboxExecutor {
  return async ({ run, step, previousResults, portalSpec }) => {
    const parsedPortalSpec = WorkerPortalSpecSchema.parse(portalSpec);
    const child = Bun.spawn({
      cmd: childCommand(), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, VIBECANVAS_WORKER_MODE: 'step' },
    });
    children.add(child);
    try {
      child.stdin.write(JSON.stringify({ functionKind: step.functionKind, functionName: step.functionName, idempotencyKey: step.idempotencyKey, portalSpec: parsedPortalSpec, args: step.args, previousResults, workflowRunId: run.id, workflowStepId: step.id }));
      child.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return parseChildResponse(stdout, stderr, exitCode).result as TWorkflowJson;
    } finally {
      children.delete(child);
    }
  };
}

async function createWorkflowWorker(): Promise<{ readonly worker: WorkflowWorkerService; readonly closeDb: () => Promise<void> }> {
  const databasePath = process.env.VIBECANVAS_DB_PATH;
  if (!databasePath) {
    const [paths, pathError] = fnXdgPaths({ env: process.env });
    if (pathError) throw new Error(pathError.internalMessage);
    return await createWorkflowWorkerForDatabase(paths.databasePath);
  }
  return await createWorkflowWorkerForDatabase(databasePath);
}

async function createWorkflowWorkerForDatabase(databasePath: string): Promise<{ readonly worker: WorkflowWorkerService; readonly closeDb: () => Promise<void> }> {
  mkdirSync(dirname(databasePath), { recursive: true });
  const dbService = new DbServiceBunSqlite({ databasePath, dataDir: dirname(databasePath), cacheDir: dirname(databasePath), silentMigrations: true });
  await dbService.start();
  return { closeDb: () => dbService.stop(), worker: new WorkflowWorkerService({ db: dbService.workflow, workerId: env('VIBECANVAS_WORKER_ID', `worker-${crypto.randomUUID()}`), sandboxName: env('VIBECANVAS_WORKER_SANDBOX_NAME', 'local-process'), leaseMs: Number(process.env.VIBECANVAS_WORKER_LEASE_MS ?? '30000'), pollIntervalMs: Number(process.env.VIBECANVAS_WORKER_POLL_INTERVAL_MS ?? '1000'), runStepInSandbox: createRunStepInChild() }) };
}

async function main(): Promise<void> {
  if (process.env.VIBECANVAS_WORKER_MODE === 'step') { await runStepRunner(); return; }
  const { worker, closeDb } = await createWorkflowWorker();
  const server = Bun.serve({ hostname: env('VIBECANVAS_WORKER_CONTROL_HOST', '127.0.0.1'), port: Number(process.env.VIBECANVAS_WORKER_CONTROL_PORT ?? '8787'), fetch(request) { if (new URL(request.url).pathname === '/health') { const status = worker.getStatus(); return Response.json({ ok: status.lastError === null, ...status }, { status: status.lastError === null ? 200 : 503 }); } return Response.json({ error: 'not found' }, { status: 404 }); } });
  async function stop(): Promise<void> { worker.stop(); for (const child of children) child.kill('SIGTERM'); await Promise.allSettled(Array.from(children).map((child) => child.exited)); server.stop(true); await closeDb(); process.exit(0); }
  process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
  if (process.env.VIBECANVAS_WORKER_ONCE === '1') { await worker.drain(); await stop(); return; }
  worker.startPolling();
  await new Promise(() => {});
}

await main();
