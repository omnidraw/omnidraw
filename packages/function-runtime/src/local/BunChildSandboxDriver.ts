/**
 * @file Zero-warm Bun child SandboxDriver for local development and tests.
 * Wall time, CPU, and RSS are host-accounted. Disk/network remain unsupported
 * zeroes in this replaceable adapter; guest-reported metrics are never trusted.
 */

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { IResourceGateway } from '@vibecanvas/resource-runtime';
import type { ISandboxDriver } from '../interface';
import type {
  TFunctionAttempt,
  TFunctionDefinition,
  TFunctionFailure,
  TFunctionInvocationEnvelope,
  TSandboxExecutionResult,
  TSandboxHandle,
  TSandboxStartRequest,
  TUsageMetrics,
} from '../types';
import {
  createBunChildCage,
  defaultBunChildTempRoot,
  readBunChildRssBytes,
  removeBunChildCage,
  terminateBunChild,
  type TBunChildCage,
  type TBunChildProcessGroupController,
} from './BunChildLifecycle';
import { fnFunctionArtifactAdmission } from './fn.artifact-admission';
import {
  fnParseServerArtifactEnvelope,
  fnServerArtifactEntryOutput,
} from './fn.artifact-envelope';
import { fnBunFunctionWorkerCommand } from './fn.sandbox-command';
import type {
  TFunctionCanonicalRegistration,
  TFunctionWorkerToHostMessage,
  THostToFunctionWorkerMessage,
} from './worker-types';

type TPendingMessage = Readonly<{
  expected: TFunctionWorkerToHostMessage['type'];
  resolve(message: TFunctionWorkerToHostMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  deadlineAtMs: number;
  timeoutError(): Error;
}>;

type TStartupDeadline = Readonly<{
  atMs: number;
  timeoutError(): Error;
}>;

type TPrepared = Readonly<{
  definition: TFunctionDefinition;
  sourceBase64: string;
  sourceDigestSha256: string;
}>;

type TActiveExecution = {
  requestId: string;
  envelope: TFunctionInvocationEnvelope;
  resources: IResourceGateway;
  resolve(result: TSandboxExecutionResult): void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  resourceCalls: number;
  cancelRequested: boolean;
};

type TRunning = {
  handle: TSandboxHandle;
  definition: TFunctionDefinition;
  attempt: TFunctionAttempt;
  process: Bun.Subprocess;
  pending: Map<string, TPendingMessage>;
  metrics: TUsageMetrics;
  logByteSize: number;
  latestRssBytes: number;
  active: TActiveExecution | null;
  destroyed: boolean;
  memoryLimitExceeded: boolean;
  memoryTimer: ReturnType<typeof setInterval> | null;
  sandboxStartedAtMs: number;
  observeMetrics(metrics: TUsageMetrics): void;
  teardownTask: Promise<void> | null;
  teardownFailure: string | null;
  streamTasks: readonly Promise<void>[];
  cage: TBunChildCage;
};

export type TBunChildSandboxDiagnostics = Readonly<{
  warmTtlMs: 0;
  preparedInvocationCount: number;
  activeGuestCount: number;
  activeGuestPids: readonly number[];
  activeGuestProcessGroupIds: readonly number[];
  activeGuestRssBytes: number;
  teardownFailures: readonly Readonly<{
    handleId: string;
    processGroupId: number;
    message: string;
  }>[];
}>;

export type TBunChildSandboxDriverConfig = Readonly<{
  executable?: string;
  workerPath?: string;
  compiledExecutable?: boolean;
  tempRoot?: string;
  spawn?: typeof Bun.spawn;
  nowMs?: () => number;
  createId?: () => string;
  startupTimeoutMs?: number;
  cancelGraceMs?: number;
  memorySampleMs?: number;
  maxResourceCalls?: number;
  memoryTierBytes?: Readonly<Record<'small' | 'medium' | 'large', number>>;
  readRssBytes?: (pid: number) => Promise<number>;
  readCpuMs?: (pid: number) => Promise<number>;
  createCage?: (tempRoot: string) => Promise<TBunChildCage>;
  processGroups?: TBunChildProcessGroupController;
  /** Deliberately fixed at zero until measured warm reuse is separately proven. */
  warmTtlMs?: 0;
}>;

const ZERO_METRICS: TUsageMetrics = Object.freeze({
  activeWallMs: 0,
  cpuMs: 0,
  allocatedMemoryByteMs: 0,
  peakRssBytes: 0,
  diskReadBytes: 0,
  diskWriteBytes: 0,
  networkRxBytes: 0,
  networkTxBytes: 0,
});

const DEFAULT_MEMORY_TIERS = Object.freeze({
  small: 128 * 1_024 * 1_024,
  medium: 256 * 1_024 * 1_024,
  large: 512 * 1_024 * 1_024,
});

function failure(
  owner: TFunctionFailure['owner'],
  code: string,
  message: string,
  retryable: boolean,
): TFunctionFailure {
  return { owner, code, message, retryable };
}

function memoryLimitError(): Error {
  return Object.assign(new Error('Function exceeded its memory tier.'), {
    code: 'FUNCTION_MEMORY_LIMIT',
  });
}

function invocationDeadlineError(): Error {
  return Object.assign(new Error('Function invocation deadline expired during sandbox startup.'), {
    code: 'FUNCTION_TIMED_OUT',
  });
}

function canonicalRegistration(definition: TFunctionDefinition): TFunctionCanonicalRegistration {
  return {
    schemaVersion: 1,
    effect: definition.effect,
    inputSchema: definition.inputSchema as TFunctionCanonicalRegistration['inputSchema'],
    outputSchema: definition.outputSchema as TFunctionCanonicalRegistration['outputSchema'],
    resources: definition.resources,
    limits: definition.limits,
    retry: definition.retry,
  };
}

function hostJsonByteSize(value: unknown): number | null {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : Buffer.byteLength(text, 'utf8');
  } catch {
    return null;
  }
}

async function streamBytes(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
  onBytes: (byteSize: number) => void,
): Promise<void> {
  if (stream === null || stream === undefined || typeof stream === 'number') return;
  const reader = stream.getReader();
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) return;
      onBytes(value.value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
}

function parseProcessCpuMs(value: string): number {
  const [dayValue, timeValue] = value.includes('-')
    ? value.split('-', 2)
    : ['0', value];
  const fields = (timeValue ?? '').split(':').map(Number);
  if (fields.some((field) => !Number.isFinite(field))) return 0;
  const seconds = fields.pop() ?? 0;
  const minutes = fields.pop() ?? 0;
  const hours = fields.pop() ?? 0;
  const days = Number(dayValue);
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1_000);
}

async function defaultReadCpuMs(pid: number): Promise<number> {
  const process = Bun.spawn(['ps', '-o', 'time=', '-p', String(pid)], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: {},
  });
  const text = await new Response(process.stdout).text();
  const exit = await process.exited;
  return exit === 0 ? parseProcessCpuMs(text.trim()) : 0;
}

/** One prepared handle and one child are scoped to exactly one invocation. */
export class BunChildSandboxDriver implements ISandboxDriver {
  readonly name = 'bun-child';
  readonly #spawn: typeof Bun.spawn;
  readonly #command: readonly string[];
  readonly #tempRoot: string;
  readonly #nowMs: () => number;
  readonly #createId: () => string;
  readonly #startupTimeoutMs: number;
  readonly #cancelGraceMs: number;
  readonly #memorySampleMs: number;
  readonly #maxResourceCalls: number;
  readonly #memoryTierBytes: Readonly<Record<'small' | 'medium' | 'large', number>>;
  readonly #readRssBytes: (pid: number) => Promise<number>;
  readonly #readCpuMs: (pid: number) => Promise<number>;
  readonly #createCage: (tempRoot: string) => Promise<TBunChildCage>;
  readonly #processGroups: TBunChildProcessGroupController | undefined;
  readonly #prepared = new Map<string, TPrepared>();
  readonly #running = new Map<string, TRunning>();

  constructor(config: TBunChildSandboxDriverConfig = {}) {
    if (config.warmTtlMs !== undefined && config.warmTtlMs !== 0) {
      throw new RangeError('Bun child warm TTL is fixed at zero.');
    }
    if (config.memorySampleMs !== undefined && (
      !Number.isInteger(config.memorySampleMs)
      || config.memorySampleMs < 1
    )) {
      throw new RangeError('Bun child memory sample interval must be positive.');
    }
    if (config.startupTimeoutMs !== undefined && (
      !Number.isInteger(config.startupTimeoutMs)
      || config.startupTimeoutMs < 1
    )) {
      throw new RangeError('Bun child startup timeout must be positive.');
    }
    this.#spawn = config.spawn ?? Bun.spawn;
    this.#command = fnBunFunctionWorkerCommand({
      executable: config.executable ?? process.execPath,
      workerPath: config.workerPath ?? fileURLToPath(new URL('./function-worker.ts', import.meta.url)),
      compiledExecutable: config.compiledExecutable ?? false,
    });
    this.#tempRoot = config.tempRoot ?? defaultBunChildTempRoot();
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#createId = config.createId ?? randomUUID;
    this.#startupTimeoutMs = config.startupTimeoutMs ?? 5_000;
    this.#cancelGraceMs = config.cancelGraceMs ?? 100;
    this.#memorySampleMs = config.memorySampleMs ?? 50;
    this.#maxResourceCalls = config.maxResourceCalls ?? 256;
    this.#memoryTierBytes = config.memoryTierBytes ?? DEFAULT_MEMORY_TIERS;
    this.#readRssBytes = config.readRssBytes ?? readBunChildRssBytes;
    this.#readCpuMs = config.readCpuMs ?? defaultReadCpuMs;
    this.#createCage = config.createCage ?? createBunChildCage;
    this.#processGroups = config.processGroups;
  }

  async prepare(request: Readonly<{
    definition: TFunctionDefinition;
    artifact: Uint8Array;
  }>): Promise<TSandboxHandle> {
    const artifactDigest = createHash('sha256').update(request.artifact).digest('hex');
    if (artifactDigest !== request.definition.artifactDigestSha256) {
      throw new Error('Function artifact bytes do not match the pinned definition digest.');
    }
    const envelope = fnParseServerArtifactEnvelope({
      text: Buffer.from(request.artifact).toString('utf8'),
      expectedRuntimeAbi: request.definition.runtimeAbi,
    });
    const output = fnServerArtifactEntryOutput(envelope);
    const source = Buffer.from(output.bytesBase64, 'base64');
    if (source.toString('base64') !== output.bytesBase64) {
      throw new Error('Function artifact entry point is not canonical base64.');
    }
    const sourceDigest = createHash('sha256').update(source).digest('hex');
    if (sourceDigest !== output.digestSha256) {
      throw new Error('Function artifact entry point digest is invalid.');
    }
    const admission = fnFunctionArtifactAdmission(source.toString('utf8'));
    if (!admission.allowed) {
      throw new Error(`Function artifact uses unsupported runtime construct '${admission.token}'.`);
    }
    const id = this.#createId();
    const handle = Object.freeze({ driver: this.name, id });
    this.#prepared.set(id, Object.freeze({
      definition: request.definition,
      sourceBase64: output.bytesBase64,
      sourceDigestSha256: sourceDigest,
    }));
    return handle;
  }

  async start(
    preparedHandle: TSandboxHandle,
    attempt: TFunctionAttempt,
    request: TSandboxStartRequest,
  ): Promise<TSandboxHandle> {
    const prepared = this.#prepared.get(preparedHandle.id);
    if (preparedHandle.driver !== this.name || prepared === undefined) {
      throw new Error('Bun child prepared handle is invalid.');
    }
    if (attempt.memoryTier !== prepared.definition.limits.memoryTier) {
      throw new Error('Function attempt memory tier differs from its pinned definition.');
    }
    this.#prepared.delete(preparedHandle.id);
    const startupLimitAtMs = this.#nowMs() + this.#startupTimeoutMs;
    const deadline: TStartupDeadline = request.deadlineAtMs <= startupLimitAtMs
      ? Object.freeze({ atMs: request.deadlineAtMs, timeoutError: invocationDeadlineError })
      : Object.freeze({
          atMs: startupLimitAtMs,
          timeoutError: () => new Error('Bun child exceeded its startup limit.'),
        });
    this.#assertBeforeStartupDeadline(deadline);
    const id = preparedHandle.id;
    const handle = preparedHandle;
    const cage = await this.#awaitBeforeStartupDeadline(
      this.#createCage(this.#tempRoot),
      deadline,
      (lateCage) => removeBunChildCage(lateCage),
    );
    try {
      this.#assertBeforeStartupDeadline(deadline);
    } catch (error) {
      await removeBunChildCage(cage);
      throw error;
    }
    let running!: TRunning;
    let process: Bun.Subprocess;
    try {
      this.#assertBeforeStartupDeadline(deadline);
      process = this.#spawn([...this.#command], {
        cwd: cage.path,
        detached: true,
        env: {},
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        ipc: (message) => this.#onMessage(running, message as TFunctionWorkerToHostMessage),
      });
    } catch (error) {
      try {
        await removeBunChildCage(cage);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Bun child failed to spawn and its cage cleanup also failed.',
        );
      }
      throw error;
    }
    const onStreamBytes = (byteSize: number) => this.#addLogBytes(running, byteSize);
    const streamTasks = [
      streamBytes(process.stdout, onStreamBytes),
      streamBytes(process.stderr, onStreamBytes),
    ];
    running = {
      handle,
      definition: prepared.definition,
      attempt,
      process,
      pending: new Map(),
      metrics: ZERO_METRICS,
      logByteSize: 0,
      latestRssBytes: 0,
      active: null,
      destroyed: false,
      memoryLimitExceeded: false,
      memoryTimer: null,
      sandboxStartedAtMs: this.#nowMs(),
      observeMetrics: request.observeMetrics,
      teardownTask: null,
      teardownFailure: null,
      streamTasks,
      cage,
    };
    this.#running.set(id, running);
    void process.exited.then((exitCode) => this.#onExit(running, exitCode));
    running.memoryTimer = setInterval(() => {
      void this.#sampleMemory(running);
    }, this.#memorySampleMs);
    (running.memoryTimer as unknown as { unref?: () => void }).unref?.();
    try {
      this.#assertBeforeStartupDeadline(deadline);
      const ready = this.#waitMessage(running, 'ready', 'ready', deadline);
      // Attach the readiness rejection before yielding to the host RSS probe.
      // A child may exit immediately after spawn; awaiting the promises
      // sequentially would expose that rejection as unhandled under load.
      await this.#awaitBeforeStartupDeadline(
        Promise.all([ready, this.#sampleMemory(running)]),
        deadline,
      );
      this.#assertMemoryWithinLimit(running);
      this.#assertBeforeStartupDeadline(deadline);
      await this.#awaitBeforeStartupDeadline(request.enterGuestCode(), deadline);
      this.#assertBeforeStartupDeadline(deadline);
      const requestId = this.#createId();
      const loaded = this.#waitMessage(running, requestId, 'loaded', deadline);
      this.#assertBeforeStartupDeadline(deadline);
      this.#send(running, {
        type: 'load',
        requestId,
        sourceBase64: prepared.sourceBase64,
        sourceDigestSha256: prepared.sourceDigestSha256,
        exportName: prepared.definition.name,
        canonicalRegistration: canonicalRegistration(prepared.definition),
      });
      await loaded;
      this.#assertBeforeStartupDeadline(deadline);
      await this.#awaitBeforeStartupDeadline(this.#sampleMemory(running), deadline);
      this.#assertMemoryWithinLimit(running);
      this.#assertBeforeStartupDeadline(deadline);
      return handle;
    } catch (error) {
      try {
        await this.destroy(handle);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Bun child startup failed and teardown also failed.',
        );
      }
      throw error;
    }
  }

  execute(
    runningHandle: TSandboxHandle,
    envelope: TFunctionInvocationEnvelope,
    resources: IResourceGateway,
  ): Promise<TSandboxExecutionResult> {
    const running = this.#requireRunning(runningHandle);
    if (running.memoryLimitExceeded) {
      return Promise.resolve({
        status: 'failed',
        failure: failure('user', 'FUNCTION_MEMORY_LIMIT', 'Function exceeded its memory tier.', false),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      });
    }
    if (running.active !== null) throw new Error('Bun child already has an active invocation.');
    if (
      running.attempt.invocationId !== envelope.id
      || running.definition.id !== envelope.functionId
      || running.definition.widgetRevisionId !== envelope.widgetRevisionId
      || running.definition.definitionRevision !== envelope.definitionRevision
      || running.definition.artifactDigestSha256 !== envelope.artifactDigestSha256
      || running.definition.contractDigestSha256 !== envelope.contractDigestSha256
      || running.definition.runtimeAbi !== envelope.runtimeAbi
    ) {
      throw new Error('Bun child execution envelope does not match its pinned definition/attempt.');
    }
    const remainingMs = Math.min(
      envelope.limits.timeoutMs,
      envelope.deadlineAtMs - this.#nowMs(),
    );
    if (remainingMs <= 0) {
      return Promise.resolve({
        status: 'failed',
        failure: failure('cancelled', 'FUNCTION_TIMED_OUT', 'Function deadline expired before execution.', false),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      });
    }
    const requestId = this.#createId();
    return new Promise<TSandboxExecutionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.#finishExecution(running, {
          status: 'failed',
          failure: failure('cancelled', 'FUNCTION_TIMED_OUT', 'Function execution exceeded its deadline.', false),
          outputByteSize: 0,
          logByteSize: running.logByteSize,
        }, true);
      }, remainingMs);
      running.active = {
        requestId,
        envelope,
        resources,
        resolve,
        timer,
        settled: false,
        resourceCalls: 0,
        cancelRequested: false,
      };
      this.#send(running, {
        type: 'execute',
        requestId,
        input: envelope.input,
        context: {
          identity: {
            orgId: envelope.tenant.orgId,
            accountId: envelope.tenant.accountId,
            roles: envelope.tenant.roles,
          },
          invocationId: envelope.id,
          widgetDefinitionId: envelope.widgetDefinitionId,
          widgetRevisionId: envelope.widgetRevisionId,
          widgetInstanceId: envelope.widgetInstanceId,
          attemptId: running.attempt.id,
          leaseEpoch: running.attempt.leaseEpoch,
          deadlineAtMs: envelope.deadlineAtMs,
        },
      });
    });
  }

  async measure(runningHandle: TSandboxHandle): Promise<TUsageMetrics> {
    const running = this.#requireRunning(runningHandle);
    await this.#sampleMemory(running);
    this.#assertMemoryWithinLimit(running);
    return {
      ...running.metrics,
      peakRssBytes: Math.max(running.metrics.peakRssBytes, running.latestRssBytes),
    };
  }

  async cancel(runningHandle: TSandboxHandle, reason: string): Promise<void> {
    const running = this.#requireRunning(runningHandle);
    if (running.active === null) return;
    running.active.cancelRequested = true;
    this.#send(running, { type: 'cancel', requestId: running.active.requestId, reason });
    const active = running.active;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.#cancelGraceMs);
      const originalResolve = active.resolve;
      active.resolve = (result) => {
        clearTimeout(timer);
        originalResolve(result);
        resolve();
      };
    });
    if (running.active === active) {
      this.#finishExecution(running, {
        status: 'failed',
        failure: failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.', false),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      }, true);
    }
  }

  async reset(runningHandle: TSandboxHandle): Promise<void> {
    await this.destroy(runningHandle);
  }

  async destroy(handle: TSandboxHandle): Promise<void> {
    this.#prepared.delete(handle.id);
    const running = this.#running.get(handle.id);
    if (!running) return;
    if (running.teardownTask !== null) return running.teardownTask;
    const teardownTask = this.#destroyRunning(running);
    running.teardownTask = teardownTask;
    try {
      await teardownTask;
    } finally {
      if (running.teardownTask === teardownTask) running.teardownTask = null;
    }
  }

  async #destroyRunning(running: TRunning): Promise<void> {
    if (!running.destroyed) {
      this.#refreshTimeMetrics(running);
      this.#publishMetrics(running);
      running.destroyed = true;
      if (running.memoryTimer !== null) clearInterval(running.memoryTimer);
      running.memoryTimer = null;
      for (const pending of running.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Bun child was destroyed.'));
      }
      running.pending.clear();
      if (running.active) {
        this.#finishExecution(running, {
          status: 'failed',
          failure: failure('platform', 'FUNCTION_SANDBOX_DESTROYED', 'Function sandbox was destroyed.', true),
          outputByteSize: 0,
          logByteSize: running.logByteSize,
        });
      }
    }
    try {
      await terminateBunChild(
        running.process,
        running.cage,
        this.#cancelGraceMs,
        this.#processGroups,
      );
      await Promise.allSettled(running.streamTasks);
      running.teardownFailure = null;
      this.#running.delete(running.handle.id);
    } catch (error) {
      running.teardownFailure = error instanceof Error
        ? error.message
        : 'Function child teardown failed.';
      throw error;
    }
  }

  diagnostics(): TBunChildSandboxDiagnostics {
    // Failed teardown remains tracked: a process group must never disappear
    // from diagnostics merely because host-side destruction was attempted.
    const running = [...this.#running.values()];
    return Object.freeze({
      warmTtlMs: 0,
      preparedInvocationCount: this.#prepared.size,
      activeGuestCount: running.length,
      activeGuestPids: Object.freeze(running.map((value) => value.process.pid)),
      activeGuestProcessGroupIds: Object.freeze(running.map((value) => value.process.pid)),
      activeGuestRssBytes: running.reduce((sum, value) => sum + value.latestRssBytes, 0),
      teardownFailures: Object.freeze(running.flatMap((value) => value.teardownFailure === null
        ? []
        : [{
            handleId: value.handle.id,
            processGroupId: value.process.pid,
            message: value.teardownFailure,
          }])),
    });
  }

  #requireRunning(handle: TSandboxHandle): TRunning {
    const running = this.#running.get(handle.id);
    if (handle.driver !== this.name || !running || running.destroyed) {
      throw new Error('Bun child running handle is invalid.');
    }
    return running;
  }

  #send(running: TRunning, message: THostToFunctionWorkerMessage): void {
    if (running.destroyed) throw new Error('Bun child is destroyed.');
    running.process.send(message);
  }

  #waitMessage(
    running: TRunning,
    requestId: string,
    expected: TFunctionWorkerToHostMessage['type'],
    deadline: TStartupDeadline,
  ): Promise<TFunctionWorkerToHostMessage> {
    if (running.memoryLimitExceeded) return Promise.reject(memoryLimitError());
    const timeoutMs = this.#remainingStartupMs(deadline);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        running.pending.delete(requestId);
        reject(deadline.timeoutError());
      }, timeoutMs);
      running.pending.set(requestId, {
        expected,
        resolve,
        reject,
        timer,
        deadlineAtMs: deadline.atMs,
        timeoutError: deadline.timeoutError,
      });
    });
  }

  #onMessage(running: TRunning, message: TFunctionWorkerToHostMessage): void {
    if (running.destroyed || running.memoryLimitExceeded) return;
    if (message.type === 'ready') {
      this.#resolvePending(running, 'ready', message);
      return;
    }
    if (message.type === 'loaded' || message.type === 'load_error') {
      if (message.type === 'load_error') {
        this.#rejectPending(running, message.requestId, new Error(message.failure.message));
      } else {
        this.#resolvePending(running, message.requestId, message);
      }
      return;
    }
    if (message.type === 'memory') {
      // Child-reported resource data is diagnostic-only and is deliberately
      // excluded from authoritative limits, completion, and usage receipts.
      return;
    }
    const active = running.active;
    if (!active || !('requestId' in message) || message.requestId !== active.requestId) return;
    if (message.type === 'log') {
      const byteSize = hostJsonByteSize(message.values);
      this.#addLogBytes(running, byteSize ?? active.envelope.limits.logByteLimit + 1);
      return;
    }
    if (message.type === 'resource_call') {
      active.resourceCalls += 1;
      if (active.resourceCalls > this.#maxResourceCalls) {
        this.#replyToResourceCall(running, active, {
          type: 'resource_result',
          requestId: active.requestId,
          callId: message.callId,
          error: { code: 'FUNCTION_RESOURCE_CALL_LIMIT', message: 'Function resource call limit exceeded.' },
        });
        return;
      }
      void Promise.resolve()
        .then(() => active.resources.call(active.envelope.tenant, message.call))
        .then(
          (result) => this.#replyToResourceCall(running, active, {
            type: 'resource_result', requestId: active.requestId, callId: message.callId, result,
          }),
          (error) => this.#replyToResourceCall(running, active, {
            type: 'resource_result',
            requestId: active.requestId,
            callId: message.callId,
            error: {
              code: error instanceof Error && 'code' in error ? String(error.code) : undefined,
              message: error instanceof Error ? error.message : 'Resource call failed.',
            },
          }),
        ).catch(() => undefined);
      return;
    }
    if (message.type === 'result') {
      const outputByteSize = hostJsonByteSize(message.output);
      const invalid = outputByteSize === null;
      const overLimit = outputByteSize !== null
        && outputByteSize > active.envelope.limits.outputByteLimit;
      this.#finishExecution(running, invalid || overLimit
        ? {
            status: 'failed',
            failure: failure(
              'user',
              invalid ? 'FUNCTION_OUTPUT_INVALID' : 'FUNCTION_OUTPUT_LIMIT',
              invalid
                ? 'Function output is not JSON serializable.'
                : 'Function output exceeds its byte limit.',
              false,
            ),
            outputByteSize: 0,
            logByteSize: running.logByteSize,
          }
        : {
            status: 'succeeded',
            output: message.output,
            outputByteSize,
            logByteSize: running.logByteSize,
          });
      return;
    }
    if (message.type === 'failure') {
      this.#finishExecution(running, {
        status: 'failed',
        failure: active.cancelRequested
          ? failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.', false)
          : failure('user', 'FUNCTION_HANDLER_FAILED', 'Function handler failed.', false),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      });
    }
  }

  #resolvePending(running: TRunning, requestId: string, message: TFunctionWorkerToHostMessage): void {
    const pending = running.pending.get(requestId);
    if (!pending || pending.expected !== message.type) return;
    running.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (this.#nowMs() >= pending.deadlineAtMs) {
      pending.reject(pending.timeoutError());
      return;
    }
    pending.resolve(message);
  }

  #remainingStartupMs(deadline: TStartupDeadline): number {
    const remainingMs = deadline.atMs - this.#nowMs();
    if (remainingMs <= 0) throw deadline.timeoutError();
    return remainingMs;
  }

  #assertBeforeStartupDeadline(deadline: TStartupDeadline): void {
    this.#remainingStartupMs(deadline);
  }

  #awaitBeforeStartupDeadline<T>(
    task: Promise<T>,
    deadline: TStartupDeadline,
    cleanupLateValue?: (value: T) => Promise<void>,
  ): Promise<T> {
    const timeoutMs = this.#remainingStartupMs(deadline);
    if (cleanupLateValue !== undefined) {
      return new Promise<T>((resolve, reject) => {
        let completed = false;
        let timedOut = false;
        const timeout = setTimeout(() => {
          if (completed) return;
          // A successfully created cage must be identity-checked and removed
          // before the timeout is observable to the caller. Settling here
          // would leave cleanup detached from `start()` under host load.
          timedOut = true;
        }, timeoutMs);
        task.then(
          (value) => {
            if (completed) return;
            const expired = timedOut || this.#nowMs() >= deadline.atMs;
            if (!expired) {
              completed = true;
              clearTimeout(timeout);
              resolve(value);
              return;
            }
            completed = true;
            clearTimeout(timeout);
            const timeoutError = deadline.timeoutError();
            void cleanupLateValue(value).then(
              () => reject(timeoutError),
              (cleanupError: unknown) => reject(new AggregateError(
                [timeoutError, cleanupError],
                'Bun child startup timed out and its late cage cleanup failed.',
              )),
            );
          },
          (error: unknown) => {
            if (completed) return;
            completed = true;
            clearTimeout(timeout);
            reject(timedOut ? deadline.timeoutError() : error);
          },
        );
      });
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(deadline.timeoutError());
      }, timeoutMs);
      task.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (this.#nowMs() >= deadline.atMs) {
            reject(deadline.timeoutError());
            return;
          }
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  #rejectPending(running: TRunning, requestId: string, error: Error): void {
    const pending = running.pending.get(requestId);
    if (!pending) return;
    running.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  #addLogBytes(running: TRunning, byteSize: number): void {
    running.logByteSize += Math.max(0, byteSize);
    const active = running.active;
    if (active && running.logByteSize > active.envelope.limits.logByteLimit) {
      this.#finishExecution(running, {
        status: 'failed',
        failure: failure('user', 'FUNCTION_LOG_LIMIT', 'Function logs exceed their byte limit.', false),
        outputByteSize: 0,
        logByteSize: active.envelope.limits.logByteLimit,
      }, true);
    }
  }

  async #sampleMemory(running: TRunning): Promise<void> {
    if (running.destroyed) return;
    this.#refreshTimeMetrics(running);
    let rssBytes: number;
    try {
      rssBytes = await this.#readRssBytes(running.process.pid);
    } catch {
      this.#publishMetrics(running);
      return;
    }
    if (running.destroyed) return;
    running.latestRssBytes = Math.max(0, rssBytes);
    running.metrics = {
      ...running.metrics,
      peakRssBytes: Math.max(running.metrics.peakRssBytes, rssBytes),
    };
    this.#refreshTimeMetrics(running);
    this.#publishMetrics(running);
    const active = running.active;
    if (rssBytes > this.#memoryTierBytes[running.attempt.memoryTier]) {
      running.memoryLimitExceeded = true;
      const error = memoryLimitError();
      for (const pending of running.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      running.pending.clear();
      if (active) {
        this.#finishExecution(running, {
          status: 'failed',
          failure: failure('user', 'FUNCTION_MEMORY_LIMIT', 'Function exceeded its memory tier.', false),
          outputByteSize: 0,
          logByteSize: running.logByteSize,
        }, true);
      } else {
        try { running.process.kill(); } catch { /* teardown verifies the process group */ }
      }
      return;
    }
    try {
      const cpuMs = await this.#readCpuMs(running.process.pid);
      if (running.destroyed) return;
      running.metrics = {
        ...running.metrics,
        cpuMs: Math.max(running.metrics.cpuMs, cpuMs),
      };
    } catch {
      // CPU probe failures do not weaken the independent RSS limit.
    }
    this.#refreshTimeMetrics(running);
    this.#publishMetrics(running);
  }

  #refreshTimeMetrics(running: TRunning): void {
    const activeWallMs = Math.max(
      running.metrics.activeWallMs,
      this.#nowMs() - running.sandboxStartedAtMs,
      0,
    );
    running.metrics = {
      ...running.metrics,
      activeWallMs,
      allocatedMemoryByteMs: this.#memoryTierBytes[running.attempt.memoryTier] * activeWallMs,
    };
  }

  #publishMetrics(running: TRunning): void {
    try {
      running.observeMetrics(Object.freeze({ ...running.metrics }));
    } catch {
      // The accounting observer must never interrupt sandbox enforcement.
    }
  }

  #assertMemoryWithinLimit(running: TRunning): void {
    if (running.memoryLimitExceeded) throw memoryLimitError();
  }

  #finishExecution(
    running: TRunning,
    result: TSandboxExecutionResult,
    kill = false,
  ): void {
    const active = running.active;
    if (!active || active.settled) return;
    active.settled = true;
    clearTimeout(active.timer);
    this.#refreshTimeMetrics(running);
    running.metrics = {
      ...running.metrics,
      peakRssBytes: Math.max(running.metrics.peakRssBytes, running.latestRssBytes),
    };
    this.#publishMetrics(running);
    running.active = null;
    active.resolve(result);
    if (kill) {
      try { running.process.kill(); } catch { /* already exited */ }
    }
  }

  #onExit(running: TRunning, exitCode: number): void {
    if (running.destroyed) return;
    for (const pending of running.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Bun child exited before startup completed (${exitCode}).`));
    }
    running.pending.clear();
    if (running.active) {
      this.#finishExecution(running, {
        status: 'failed',
        failure: failure('platform', 'FUNCTION_SANDBOX_CRASHED', 'Function sandbox exited unexpectedly.', true),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      });
    }
  }

  #replyToResourceCall(
    running: TRunning,
    active: TActiveExecution,
    message: Extract<THostToFunctionWorkerMessage, Readonly<{ type: 'resource_result' }>>,
  ): void {
    if (running.destroyed || active.settled || running.active !== active) return;
    try {
      this.#send(running, message);
    } catch {
      if (running.destroyed || active.settled || running.active !== active) return;
      this.#finishExecution(running, {
        status: 'failed',
        failure: failure(
          'platform',
          'FUNCTION_SANDBOX_IPC_FAILED',
          'Function sandbox IPC failed while returning a resource result.',
          true,
        ),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      }, true);
    }
  }
}
