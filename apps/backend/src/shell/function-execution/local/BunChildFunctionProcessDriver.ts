/**
 * @file Zero-warm disposable Bun child for trusted local function execution.
 * Wall time, CPU, and RSS are host-accounted. Disk/network remain unsupported
 * zeroes in this replaceable adapter; guest-reported metrics are never trusted.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  WIDGET_SERVER_MODULE_ABI,
  WIDGET_SERVER_MODULE_FORMAT,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnEncodePortableResourceFailure,
  fnWidgetServerModulePolicyAdmission,
} from '@omnidraw/sdk/contract';
import type { IResourceGateway } from '#backend/shell/resources';
import type { IFunctionProcessDriver } from '../interface';
import type {
  TDirectFunctionCall,
  TDirectFunctionDefinition,
  TFunctionFailure,
  TFunctionProcessExecutionResult,
  TFunctionProcessHandle,
  TFunctionProcessStartRequest,
  TFunctionUsageMetrics,
} from '../types';
import {
  type TBunChildCage,
  type TBunChildProcessGroupController,
} from './BunChildLifecycle';
import { fnRoutePortableResourceCall } from './DirectInvocationResourceGateway';
import { fnBunFunctionWorkerCommand } from './fn.function-worker-command';
import type {
  TFunctionCanonicalRegistration,
  TFunctionWorkerToHostMessage,
  THostToFunctionWorkerMessage,
} from './worker-types';

type TPendingMessage = Readonly<{
  expected: TFunctionWorkerToHostMessage['type'];
  resolve(message: TFunctionWorkerToHostMessage): void;
  reject(error: Error): void;
  timer: unknown;
  deadlineAtMs: number;
  timeoutError(): Error;
}>;

type TStartupDeadline = Readonly<{
  atMs: number;
  timeoutError(): Error;
}>;

type TPrepared = Readonly<{
  definition: TDirectFunctionDefinition;
  moduleBytes: Uint8Array;
  moduleDigestSha256: string;
}>;

type TActiveExecution = {
  requestId: string;
  call: TDirectFunctionCall;
  resources: IResourceGateway;
  resolve(result: TFunctionProcessExecutionResult): void;
  timer: unknown;
  settled: boolean;
  resourceCalls: number;
  cancelRequested: boolean;
};

type TRunning = {
  handle: TFunctionProcessHandle;
  definition: TDirectFunctionDefinition;
  process: Bun.Subprocess;
  pending: Map<string, TPendingMessage>;
  metrics: TFunctionUsageMetrics;
  logByteSize: number;
  latestRssBytes: number;
  active: TActiveExecution | null;
  destroyed: boolean;
  memoryLimitExceeded: boolean;
  memoryTimer: unknown | null;
  processStartedAtMs: number;
  observeMetrics(metrics: TFunctionUsageMetrics): void;
  teardownTask: Promise<void> | null;
  teardownFailure: string | null;
  streamTasks: readonly Promise<void>[];
  cage: TBunChildCage;
};

export type TBunChildFunctionProcessDiagnostics = Readonly<{
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

export type TBunChildFunctionProcessDriverConfig = Readonly<{
  executable: string;
  workerPath: string;
  tempRoot: string;
  spawn: typeof Bun.spawn;
  nowMs: () => number;
  createId: () => string;
  timers: Readonly<{
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(timer: unknown): void;
    setInterval(callback: () => void, delayMs: number): unknown;
    clearInterval(timer: unknown): void;
  }>;
  startupTimeoutMs?: number;
  cancelGraceMs?: number;
  memorySampleMs?: number;
  maxResourceCalls?: number;
  memoryTierBytes?: Readonly<Record<'small', number>>;
  readRssBytes: (pid: number) => Promise<number>;
  readCpuMs: (pid: number) => Promise<number>;
  createCage: (tempRoot: string) => Promise<TBunChildCage>;
  removeCage(cage: TBunChildCage): Promise<void>;
  terminateChild(
    process: Bun.Subprocess,
    cage: TBunChildCage,
    graceMs: number,
    processGroups: TBunChildProcessGroupController,
  ): Promise<void>;
  processGroups: TBunChildProcessGroupController;
  /** Deliberately fixed at zero until measured warm reuse is separately proven. */
  warmTtlMs?: 0;
}>;

const ZERO_METRICS: TFunctionUsageMetrics = Object.freeze({
  activeWallMs: 0,
  cpuMs: 0,
  allocatedMemoryByteMs: 0,
  peakRssBytes: 0,
});

const DEFAULT_MEMORY_TIERS = Object.freeze({
  small: 128 * 1_024 * 1_024,
});

function failure(
  owner: TFunctionFailure['owner'],
  code: string,
  message: string,
): TFunctionFailure {
  return { owner, code, message };
}

function memoryLimitError(): Error {
  return Object.assign(new Error('Function exceeded its memory tier.'), {
    code: 'FUNCTION_MEMORY_LIMIT',
  });
}

function invocationDeadlineError(): Error {
  return Object.assign(new Error('Function invocation deadline expired during child-process startup.'), {
    code: 'FUNCTION_TIMED_OUT',
  });
}

function canonicalRegistration(definition: TDirectFunctionDefinition): TFunctionCanonicalRegistration {
  const descriptor = definition.descriptor;
  return {
    schemaVersion: 1,
    effect: descriptor.effect,
    inputSchema: descriptor.inputSchema as TFunctionCanonicalRegistration['inputSchema'],
    outputSchema: descriptor.outputSchema as TFunctionCanonicalRegistration['outputSchema'],
    resources: descriptor.resources,
    limits: descriptor.limits,
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

export async function readBunChildCpuMs(pid: number): Promise<number> {
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
export class BunChildFunctionProcessDriver implements IFunctionProcessDriver {
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
  readonly #memoryTierBytes: Readonly<Record<'small', number>>;
  readonly #readRssBytes: (pid: number) => Promise<number>;
  readonly #readCpuMs: (pid: number) => Promise<number>;
  readonly #createCage: (tempRoot: string) => Promise<TBunChildCage>;
  readonly #removeCage: (cage: TBunChildCage) => Promise<void>;
  readonly #terminateChild: TBunChildFunctionProcessDriverConfig['terminateChild'];
  readonly #processGroups: TBunChildProcessGroupController;
  readonly #timers: TBunChildFunctionProcessDriverConfig['timers'];
  readonly #prepared = new Map<string, TPrepared>();
  readonly #running = new Map<string, TRunning>();

  constructor(config: TBunChildFunctionProcessDriverConfig) {
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
    this.#spawn = config.spawn;
    this.#command = fnBunFunctionWorkerCommand({
      executable: config.executable,
      workerPath: config.workerPath,
    });
    this.#tempRoot = config.tempRoot;
    this.#nowMs = config.nowMs;
    this.#createId = config.createId;
    this.#startupTimeoutMs = config.startupTimeoutMs ?? 5_000;
    this.#cancelGraceMs = config.cancelGraceMs ?? 100;
    this.#memorySampleMs = config.memorySampleMs ?? 50;
    this.#maxResourceCalls = config.maxResourceCalls ?? 256;
    this.#memoryTierBytes = config.memoryTierBytes ?? DEFAULT_MEMORY_TIERS;
    this.#readRssBytes = config.readRssBytes;
    this.#readCpuMs = config.readCpuMs;
    this.#createCage = config.createCage;
    this.#removeCage = config.removeCage;
    this.#terminateChild = config.terminateChild;
    this.#processGroups = config.processGroups;
    this.#timers = config.timers;
  }

  async prepare(request: Readonly<{
    definition: TDirectFunctionDefinition;
    artifact: Uint8Array;
  }>): Promise<TFunctionProcessHandle> {
    const serverModule = request.definition.serverModule;
    if (
      serverModule.format !== WIDGET_SERVER_MODULE_FORMAT
      || serverModule.abi !== WIDGET_SERVER_MODULE_ABI
    ) {
      throw new Error('Function execution requires the fixed portable server module.');
    }
    const moduleBytes = new Uint8Array(request.artifact);
    const moduleDigestSha256 = createHash('sha256').update(moduleBytes).digest('hex');
    if (moduleDigestSha256 !== serverModule.moduleDigestSha256) {
      throw new Error('Function module bytes do not match the pinned definition digest.');
    }
    const descriptorDigestSha256 = createHash('sha256').update(
      fnCanonicalizeWidgetServerFunctionDescriptors(serverModule.functionDescriptors),
    ).digest('hex');
    if (descriptorDigestSha256 !== serverModule.functionDescriptorsDigestSha256) {
      throw new Error('Function descriptor bytes do not match the pinned definition digest.');
    }
    const selected = serverModule.functionDescriptors.find(
      (descriptor) => descriptor.exportName === request.definition.descriptor.exportName,
    );
    if (selected === undefined || JSON.stringify(selected) !== JSON.stringify(request.definition.descriptor)) {
      throw new Error('Selected function descriptor is absent from the pinned server module.');
    }
    const admission = fnWidgetServerModulePolicyAdmission({
      phase: 'closed_bundle',
      source: Buffer.from(moduleBytes).toString('utf8'),
    });
    if (!admission.allowed) {
      throw new Error(`Function artifact uses unsupported runtime construct '${admission.token}'.`);
    }
    const id = this.#createId();
    const handle = Object.freeze({ driver: this.name, id });
    this.#prepared.set(id, Object.freeze({
      definition: request.definition,
      moduleBytes,
      moduleDigestSha256,
    }));
    return handle;
  }

  async start(
    preparedHandle: TFunctionProcessHandle,
    request: TFunctionProcessStartRequest,
  ): Promise<TFunctionProcessHandle> {
    const prepared = this.#prepared.get(preparedHandle.id);
    if (preparedHandle.driver !== this.name || prepared === undefined) {
      throw new Error('Bun child prepared handle is invalid.');
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
      (lateCage) => this.#removeCage(lateCage),
    );
    try {
      this.#assertBeforeStartupDeadline(deadline);
    } catch (error) {
      await this.#removeCage(cage);
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
        await this.#removeCage(cage);
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
      process,
      pending: new Map(),
      metrics: ZERO_METRICS,
      logByteSize: 0,
      latestRssBytes: 0,
      active: null,
      destroyed: false,
      memoryLimitExceeded: false,
      memoryTimer: null,
      processStartedAtMs: this.#nowMs(),
      observeMetrics: request.observeMetrics,
      teardownTask: null,
      teardownFailure: null,
      streamTasks,
      cage,
    };
    this.#running.set(id, running);
    void process.exited.then((exitCode) => this.#onExit(running, exitCode));
    running.memoryTimer = this.#timers.setInterval(() => {
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
      const requestId = this.#createId();
      const loaded = this.#waitMessage(running, requestId, 'loaded', deadline);
      this.#assertBeforeStartupDeadline(deadline);
      this.#send(running, {
        type: 'load',
        requestId,
        moduleBytes: prepared.moduleBytes,
        moduleDigestSha256: prepared.moduleDigestSha256,
        exportName: prepared.definition.descriptor.exportName,
        functionDescriptors: prepared.definition.serverModule.functionDescriptors,
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
    runningHandle: TFunctionProcessHandle,
    call: TDirectFunctionCall,
    resources: IResourceGateway,
  ): Promise<TFunctionProcessExecutionResult> {
    const running = this.#requireRunning(runningHandle);
    if (running.memoryLimitExceeded) {
      return Promise.resolve({
        status: 'failed',
        failure: failure('user', 'FUNCTION_MEMORY_LIMIT', 'Function exceeded its memory tier.'),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      });
    }
    if (running.active !== null) throw new Error('Bun child already has an active invocation.');
    if (
      running.definition.widgetKey !== call.definition.widgetKey
      || running.definition.catalogGeneration !== call.definition.catalogGeneration
      || running.definition.serverModule.moduleDigestSha256
        !== call.definition.serverModule.moduleDigestSha256
      || running.definition.serverModule.functionDescriptorsDigestSha256
        !== call.definition.serverModule.functionDescriptorsDigestSha256
      || running.definition.descriptor.exportName !== call.definition.descriptor.exportName
    ) {
      throw new Error('Bun child call does not match its captured filesystem definition.');
    }
    const remainingMs = Math.min(
      call.definition.descriptor.limits.timeoutMs,
      call.deadlineAtMs - this.#nowMs(),
    );
    if (remainingMs <= 0) {
      return Promise.resolve({
        status: 'failed',
        failure: failure('cancelled', 'FUNCTION_TIMED_OUT', 'Function deadline expired before execution.'),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      });
    }
    const requestId = this.#createId();
    return new Promise<TFunctionProcessExecutionResult>((resolve) => {
      const timer = this.#timers.setTimeout(() => {
        this.#finishExecution(running, {
          status: 'failed',
          failure: failure('cancelled', 'FUNCTION_TIMED_OUT', 'Function execution exceeded its deadline.'),
          outputByteSize: 0,
          logByteSize: running.logByteSize,
        }, true);
      }, remainingMs);
      running.active = {
        requestId,
        call,
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
        input: call.input,
        context: {
          invocationId: call.id,
          widgetKey: call.definition.widgetKey,
          catalogGeneration: call.definition.catalogGeneration,
          subject: call.subject,
          deadlineAtMs: call.deadlineAtMs,
        },
      });
    });
  }

  async measure(runningHandle: TFunctionProcessHandle): Promise<TFunctionUsageMetrics> {
    const running = this.#requireRunning(runningHandle);
    await this.#sampleMemory(running);
    this.#assertMemoryWithinLimit(running);
    return {
      ...running.metrics,
      peakRssBytes: Math.max(running.metrics.peakRssBytes, running.latestRssBytes),
    };
  }

  async cancel(runningHandle: TFunctionProcessHandle, reason: string): Promise<void> {
    const running = this.#requireRunning(runningHandle);
    if (running.active === null) return;
    running.active.cancelRequested = true;
    this.#send(running, { type: 'cancel', requestId: running.active.requestId, reason });
    const active = running.active;
    await new Promise<void>((resolve) => {
      const timer = this.#timers.setTimeout(resolve, this.#cancelGraceMs);
      const originalResolve = active.resolve;
      active.resolve = (result) => {
        this.#timers.clearTimeout(timer);
        originalResolve(result);
        resolve();
      };
    });
    if (running.active === active) {
      this.#finishExecution(running, {
        status: 'failed',
        failure: failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.'),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      }, true);
    }
  }

  async reset(runningHandle: TFunctionProcessHandle): Promise<void> {
    await this.destroy(runningHandle);
  }

  async destroy(handle: TFunctionProcessHandle): Promise<void> {
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
      if (running.memoryTimer !== null) this.#timers.clearInterval(running.memoryTimer);
      running.memoryTimer = null;
      for (const pending of running.pending.values()) {
        this.#timers.clearTimeout(pending.timer);
        pending.reject(new Error('Bun child was destroyed.'));
      }
      running.pending.clear();
      if (running.active) {
        this.#finishExecution(running, {
          status: 'failed',
          failure: failure('platform', 'FUNCTION_PROCESS_DESTROYED', 'Function child process was destroyed.'),
          outputByteSize: 0,
          logByteSize: running.logByteSize,
        });
      }
    }
    try {
      await this.#terminateChild(
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

  diagnostics(): TBunChildFunctionProcessDiagnostics {
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

  #requireRunning(handle: TFunctionProcessHandle): TRunning {
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
      const timer = this.#timers.setTimeout(() => {
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
      this.#addLogBytes(running, byteSize ?? active.call.definition.descriptor.limits.logByteLimit + 1);
      return;
    }
    if (message.type === 'resource_call') {
      active.resourceCalls += 1;
      if (active.resourceCalls > this.#maxResourceCalls) {
        try {
          this.#replyToResourceCall(running, active, {
            type: 'resource_result',
            requestId: active.requestId,
            response: fnEncodePortableResourceFailure({
              correlationId: message.request.correlationId,
              failure: {
                code: 'RESOURCE_LIMIT_EXCEEDED',
                message: 'Resource operation exceeded a limit.',
              },
            }),
          });
        } catch {
          this.#finishExecution(running, {
            status: 'failed',
            failure: failure(
              'platform',
              'FUNCTION_PROCESS_IPC_INVALID',
              'Function child sent an invalid resource request.',
            ),
            outputByteSize: 0,
            logByteSize: running.logByteSize,
          }, true);
        }
        return;
      }
      void fnRoutePortableResourceCall(active.resources, message.request)
        .then((response) => this.#replyToResourceCall(running, active, {
          type: 'resource_result',
          requestId: active.requestId,
          response,
        }))
        .catch(() => {
          if (running.destroyed || active.settled || running.active !== active) return;
          this.#finishExecution(running, {
            status: 'failed',
            failure: failure(
              'platform',
              'FUNCTION_PROCESS_IPC_INVALID',
              'Function child sent an invalid resource request.',
            ),
            outputByteSize: 0,
            logByteSize: running.logByteSize,
          }, true);
        });
      return;
    }
    if (message.type === 'result') {
      const outputByteSize = hostJsonByteSize(message.output);
      const invalid = outputByteSize === null;
      const overLimit = outputByteSize !== null
        && outputByteSize > active.call.definition.descriptor.limits.outputByteLimit;
      this.#finishExecution(running, invalid || overLimit
        ? {
            status: 'failed',
            failure: failure(
              'user',
              invalid ? 'FUNCTION_OUTPUT_INVALID' : 'FUNCTION_OUTPUT_LIMIT',
              invalid
                ? 'Function output is not JSON serializable.'
                : 'Function output exceeds its byte limit.',
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
          ? failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.')
          : failure('user', 'FUNCTION_HANDLER_FAILED', 'Function handler failed.'),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      });
    }
  }

  #resolvePending(running: TRunning, requestId: string, message: TFunctionWorkerToHostMessage): void {
    const pending = running.pending.get(requestId);
    if (!pending || pending.expected !== message.type) return;
    running.pending.delete(requestId);
    this.#timers.clearTimeout(pending.timer);
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
        const timeout = this.#timers.setTimeout(() => {
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
              this.#timers.clearTimeout(timeout);
              resolve(value);
              return;
            }
            completed = true;
            this.#timers.clearTimeout(timeout);
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
            this.#timers.clearTimeout(timeout);
            reject(timedOut ? deadline.timeoutError() : error);
          },
        );
      });
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = this.#timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(deadline.timeoutError());
      }, timeoutMs);
      task.then(
        (value) => {
          if (settled) return;
          settled = true;
          this.#timers.clearTimeout(timeout);
          if (this.#nowMs() >= deadline.atMs) {
            reject(deadline.timeoutError());
            return;
          }
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          this.#timers.clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }

  #rejectPending(running: TRunning, requestId: string, error: Error): void {
    const pending = running.pending.get(requestId);
    if (!pending) return;
    running.pending.delete(requestId);
    this.#timers.clearTimeout(pending.timer);
    pending.reject(error);
  }

  #addLogBytes(running: TRunning, byteSize: number): void {
    running.logByteSize += Math.max(0, byteSize);
    const active = running.active;
    if (active && running.logByteSize > active.call.definition.descriptor.limits.logByteLimit) {
      this.#finishExecution(running, {
        status: 'failed',
        failure: failure('user', 'FUNCTION_LOG_LIMIT', 'Function logs exceed their byte limit.'),
        outputByteSize: 0,
        logByteSize: active.call.definition.descriptor.limits.logByteLimit,
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
    if (rssBytes > this.#memoryTierBytes[running.definition.descriptor.limits.memoryTier]) {
      running.memoryLimitExceeded = true;
      const error = memoryLimitError();
      for (const pending of running.pending.values()) {
        this.#timers.clearTimeout(pending.timer);
        pending.reject(error);
      }
      running.pending.clear();
      if (active) {
        this.#finishExecution(running, {
          status: 'failed',
          failure: failure('user', 'FUNCTION_MEMORY_LIMIT', 'Function exceeded its memory tier.'),
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
      this.#nowMs() - running.processStartedAtMs,
      0,
    );
    running.metrics = {
      ...running.metrics,
      activeWallMs,
      allocatedMemoryByteMs: this.#memoryTierBytes[running.definition.descriptor.limits.memoryTier] * activeWallMs,
    };
  }

  #publishMetrics(running: TRunning): void {
    try {
      running.observeMetrics(Object.freeze({ ...running.metrics }));
    } catch {
      // The accounting observer must never interrupt process-limit enforcement.
    }
  }

  #assertMemoryWithinLimit(running: TRunning): void {
    if (running.memoryLimitExceeded) throw memoryLimitError();
  }

  #finishExecution(
    running: TRunning,
    result: TFunctionProcessExecutionResult,
    kill = false,
  ): void {
    const active = running.active;
    if (!active || active.settled) return;
    active.settled = true;
    this.#timers.clearTimeout(active.timer);
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
      this.#timers.clearTimeout(pending.timer);
      pending.reject(new Error(`Bun child exited before startup completed (${exitCode}).`));
    }
    running.pending.clear();
    if (running.active) {
      this.#finishExecution(running, {
        status: 'failed',
        failure: failure('platform', 'FUNCTION_PROCESS_CRASHED', 'Function child process exited unexpectedly.'),
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
          'FUNCTION_PROCESS_IPC_FAILED',
          'Function child-process IPC failed while returning a resource result.',
        ),
        outputByteSize: 0,
        logByteSize: running.logByteSize,
      }, true);
    }
  }
}
