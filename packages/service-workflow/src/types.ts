export type TWorkflowJson =
  | string
  | number
  | boolean
  | null
  | readonly TWorkflowJson[]
  | { readonly [key: string]: TWorkflowJson | undefined };

export type TWorkflowFunctionKind = 'fn' | 'fx' | 'tx';
export type TWorkflowRunStatus = 'starting' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';
export type TWorkflowStepStatus = 'pending' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type TSandboxRunStatus = 'started' | 'succeeded' | 'failed' | 'timedOut' | 'killed';

export type TWorkflowError = {
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  readonly details?: Record<string, TWorkflowJson>;
};

export type TWorkflowRunRow = {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly canvasId: string | null;
  readonly runId: string;
  readonly workflowKind: string;
  readonly subjectId: string | null;
  readonly triggerId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly currentStepIndex: number;
  readonly stepCount: number;
  readonly status: TWorkflowRunStatus;
  readonly startedAt: Date;
  readonly lastHeartbeatAt: Date | null;
  readonly completedAt: Date | null;
  readonly error: TWorkflowError | null;
};

export type TWorkflowStepRow = {
  readonly id: string;
  readonly workflowRunId: string;
  readonly sandboxRunId: string | null;
  readonly stepKey: string;
  readonly stepIndex: number;
  readonly phase: string | null;
  readonly functionKind: TWorkflowFunctionKind;
  readonly functionName: string;
  readonly idempotencyKey: string;
  readonly portalSpec: TWorkflowJson;
  readonly args: TWorkflowJson;
  readonly status: TWorkflowStepStatus;
  readonly result: TWorkflowJson | null;
  readonly error: TWorkflowError | null;
  readonly claimedByRunId: string | null;
  readonly claimedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly attempt: number;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
};

export type TSandboxRunRow = {
  readonly id: string;
  readonly workflowRunId: string | null;
  readonly workflowStepId: string | null;
  readonly portalKind: TWorkflowFunctionKind;
  readonly functionName: string;
  readonly idempotencyKey: string | null;
  readonly portalSpec: TWorkflowJson;
  readonly input: TWorkflowJson;
  readonly sandboxName: string;
  readonly status: TSandboxRunStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly stdoutFileId: string | null;
  readonly stderrFileId: string | null;
};

export type TWorkflowStepDefinition = {
  readonly stepKey: string;
  readonly stepIndex: number;
  readonly phase?: string;
  readonly functionKind: TWorkflowFunctionKind;
  readonly functionName: string;
  readonly idempotencyKey: string;
  readonly portalSpec?: TWorkflowJson;
  readonly args: TWorkflowJson;
};

export type TWorkflowDefinition = {
  readonly workflowKind: string;
  readonly steps: readonly TWorkflowStepDefinition[];
};

export type TWorkflowEnsureRunArgs = {
  readonly definition: TWorkflowDefinition;
  readonly runId: string;
  readonly workspaceId?: string;
  readonly canvasId?: string;
  readonly subjectId?: string;
  readonly triggerId?: string;
  readonly correlationId: string;
  readonly causationId?: string;
};

export type TWorkflowClaimOptions = { readonly leaseMs: number };

export type TWorkflowCreateSandboxRunArgs = {
  readonly workflowRunId: string;
  readonly workflowStepId: string;
  readonly portalKind: TWorkflowFunctionKind;
  readonly functionName: string;
  readonly idempotencyKey: string | null;
  readonly portalSpec: TWorkflowJson;
  readonly input: TWorkflowJson;
  readonly sandboxName: string;
};

export type TWorkflowDb = {
  ensureRun(args: TWorkflowEnsureRunArgs): TWorkflowRunRow | Promise<TWorkflowRunRow>;
  getRun(runId: string): TWorkflowRunRow | Promise<TWorkflowRunRow>;
  patchRun(id: string, patch: Partial<Omit<TWorkflowRunRow, 'id'>>): TWorkflowRunRow | Promise<TWorkflowRunRow>;
  getStepsForRun(runId: string): readonly TWorkflowStepRow[] | Promise<readonly TWorkflowStepRow[]>;
  claimStep(id: string, workerId: string, options: TWorkflowClaimOptions): TWorkflowStepRow | Promise<TWorkflowStepRow>;
  patchStep(id: string, patch: Partial<Omit<TWorkflowStepRow, 'id'>>): TWorkflowStepRow | Promise<TWorkflowStepRow>;
  createSandboxRun(args: TWorkflowCreateSandboxRunArgs): TSandboxRunRow | Promise<TSandboxRunRow>;
  patchSandboxRun(id: string, patch: Partial<Omit<TSandboxRunRow, 'id'>>): TSandboxRunRow | Promise<TSandboxRunRow>;
  getTxResult(idempotencyKey: string): TWorkflowJson | undefined | Promise<TWorkflowJson | undefined>;
  saveTxResult(idempotencyKey: string, result: TWorkflowJson): TWorkflowJson | Promise<TWorkflowJson>;
  completeRunAtomically(runId: string): TWorkflowRunRow | Promise<TWorkflowRunRow>;
  getRunnableRuns(): readonly TWorkflowRunRow[] | Promise<readonly TWorkflowRunRow[]>;
};

export type TWorkflowSandboxExecutorArgs = {
  readonly run: TWorkflowRunRow;
  readonly step: TWorkflowStepRow;
  readonly previousResults: readonly TWorkflowJson[];
  readonly portalSpec: TWorkflowJson;
};

export type TWorkflowSandboxExecutor = (args: TWorkflowSandboxExecutorArgs) => TWorkflowJson | Promise<TWorkflowJson>;
