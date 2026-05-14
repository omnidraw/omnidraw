import { StepRunnerRequestSchema, StepRunnerResponseSchema, type TStepRunnerRequest, type TStepRunnerResponse } from './schema';

type TWorkerModule = Record<string, unknown> & { fns?: Record<string, unknown>; fxs?: Record<string, unknown>; txs?: Record<string, unknown>; functions?: Record<string, unknown> };
type TWorkerPortal = { readonly env: Record<string, string | undefined>; readonly now: () => string; readonly idempotencyKey?: string; readonly workflowRunId: string; readonly workflowStepId: string; readonly previousResults: readonly unknown[] };

function writeResponse(response: TStepRunnerResponse): void { process.stdout.write(`${JSON.stringify(response)}\n`); }
function moduleUrl(modulePath: string): string { return `${new URL(modulePath, 'file://').href}?v=${encodeURIComponent(String(Date.now()))}`; }
function tableNameForKind(functionKind: TStepRunnerRequest['functionKind']): 'fns' | 'fxs' | 'txs' { return functionKind === 'fn' ? 'fns' : functionKind === 'fx' ? 'fxs' : 'txs'; }

function getWorkerFunction(mod: TWorkerModule, input: TStepRunnerRequest): unknown {
  if (input.portalSpec.exportName) return mod[input.portalSpec.exportName];
  if (input.portalSpec.tableExportName) {
    const table = mod[input.portalSpec.tableExportName];
    return typeof table === 'object' && table !== null ? (table as Record<string, unknown>)[input.functionName] : undefined;
  }
  const table = mod[tableNameForKind(input.functionKind)] ?? mod.functions;
  return typeof table === 'object' && table !== null ? (table as Record<string, unknown>)[input.functionName] : undefined;
}

function createPortal(input: TStepRunnerRequest): TWorkerPortal {
  return { env: process.env, now: () => new Date().toISOString(), idempotencyKey: input.idempotencyKey, workflowRunId: input.workflowRunId, workflowStepId: input.workflowStepId, previousResults: input.previousResults ?? [] };
}

export async function runStepRunner(): Promise<void> {
  try {
    const input = StepRunnerRequestSchema.parse(await Bun.stdin.json());
    const mod = await import(moduleUrl(input.portalSpec.modulePath)) as TWorkerModule;
    const workerFunction = getWorkerFunction(mod, input);
    if (typeof workerFunction !== 'function') throw new Error(`Function ${input.functionName} is not exported for ${input.functionKind}`);
    const result = await workerFunction(createPortal(input), input.args);
    writeResponse(StepRunnerResponseSchema.parse({ ok: true, result }));
  } catch (error) {
    writeResponse({ ok: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    process.exitCode = 1;
  }
}
