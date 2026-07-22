/**
 * @file Bounded child-only server descriptor extraction adapter.
 */

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetServerFunctionDescriptorExtractor,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionDescriptorExtractionRequest,
} from '@vibecanvas/widget-contract';
import {
  createBunChildCage,
  defaultBunChildTempRoot,
  readBunChildRssBytes,
  removeBunChildCage,
  terminateBunChild,
  type TBunChildProcessGroupController,
} from './BunChildLifecycle';
import { fnFunctionArtifactAdmission } from './fn.artifact-admission';
import {
  fnParseServerArtifactEnvelope,
  fnServerArtifactEntryOutput,
} from './fn.artifact-envelope';
import { fnBunFunctionWorkerCommand } from './fn.sandbox-command';
import type {
  TFunctionWorkerToHostMessage,
  THostToFunctionWorkerMessage,
} from './worker-types';

export type TBunChildFunctionDescriptorExtractorConfig = Readonly<{
  executable?: string;
  workerPath?: string;
  compiledExecutable?: boolean;
  tempRoot?: string;
  spawn?: typeof Bun.spawn;
  nowMs?: () => number;
  timeoutMs?: number;
  outputByteLimit?: number;
  memoryLimitBytes?: number;
  memorySampleMs?: number;
  readRssBytes?: (pid: number) => Promise<number>;
  createId?: () => string;
  cancelGraceMs?: number;
  processGroups?: TBunChildProcessGroupController;
}>;

async function drainBounded(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
  byteLimit: number,
  onOverflow: () => void,
): Promise<void> {
  if (!stream || typeof stream === 'number') return;
  const reader = stream.getReader();
  let bytes = 0;
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) return;
      bytes += value.value.byteLength;
      if (bytes > byteLimit) {
        onOverflow();
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class BunChildFunctionDescriptorExtractor implements
  IWidgetServerFunctionDescriptorExtractor {
  readonly #spawn: typeof Bun.spawn;
  readonly #command: readonly string[];
  readonly #tempRoot: string;
  readonly #nowMs: () => number;
  readonly #timeoutMs: number;
  readonly #outputByteLimit: number;
  readonly #memoryLimitBytes: number;
  readonly #memorySampleMs: number;
  readonly #readRssBytes: (pid: number) => Promise<number>;
  readonly #createId: () => string;
  readonly #cancelGraceMs: number;
  readonly #activePids = new Set<number>();
  readonly #teardownFailures = new Map<number, string>();
  readonly #processGroups: TBunChildProcessGroupController | undefined;

  constructor(config: TBunChildFunctionDescriptorExtractorConfig = {}) {
    this.#spawn = config.spawn ?? Bun.spawn;
    this.#command = fnBunFunctionWorkerCommand({
      executable: config.executable ?? process.execPath,
      workerPath: config.workerPath ?? fileURLToPath(new URL('./function-worker.ts', import.meta.url)),
      compiledExecutable: config.compiledExecutable ?? false,
    });
    this.#tempRoot = config.tempRoot ?? defaultBunChildTempRoot();
    this.#nowMs = config.nowMs ?? (() => Date.now());
    this.#timeoutMs = config.timeoutMs ?? 5_000;
    this.#outputByteLimit = config.outputByteLimit ?? 2 * 1_024 * 1_024;
    this.#memoryLimitBytes = config.memoryLimitBytes ?? 128 * 1_024 * 1_024;
    this.#memorySampleMs = config.memorySampleMs ?? 50;
    this.#readRssBytes = config.readRssBytes ?? readBunChildRssBytes;
    this.#createId = config.createId ?? randomUUID;
    this.#cancelGraceMs = config.cancelGraceMs ?? 100;
    this.#processGroups = config.processGroups;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new RangeError('Function descriptor timeout must be positive.');
    }
    if (!Number.isInteger(this.#memoryLimitBytes) || this.#memoryLimitBytes < 1) {
      throw new RangeError('Function descriptor memory limit must be positive.');
    }
    if (!Number.isInteger(this.#memorySampleMs) || this.#memorySampleMs < 1) {
      throw new RangeError('Function descriptor memory sample interval must be positive.');
    }
  }

  async extractServerFunctionDescriptors(
    _tenant: TTenantContext,
    request: TWidgetServerFunctionDescriptorExtractionRequest,
  ): Promise<readonly TWidgetServerFunctionDescriptor[]> {
    const deadlineAtMs = this.#nowMs() + this.#timeoutMs;
    const deadlineError = () => Object.assign(
      new Error('Function descriptor extraction exceeded its deadline.'),
      { code: 'FUNCTION_TIMED_OUT' },
    );
    const assertBeforeDeadline = () => {
      if (this.#nowMs() >= deadlineAtMs) throw deadlineError();
    };
    if (request.serverArtifact.kind !== 'server') throw new Error('Descriptor extraction requires a server artifact.');
    const digest = createHash('sha256').update(request.serverArtifact.bytes).digest('hex');
    if (digest !== request.serverArtifact.digestSha256) throw new Error('Server artifact digest is invalid.');
    const envelope = fnParseServerArtifactEnvelope({
      text: Buffer.from(request.serverArtifact.bytes).toString('utf8'),
      expectedRuntimeAbi: request.runtimeAbi,
    });
    if (envelope.entry !== request.serverEntry) throw new Error('Server artifact entry differs from its manifest.');
    const output = fnServerArtifactEntryOutput(envelope);
    const source = Buffer.from(output.bytesBase64, 'base64');
    if (
      source.toString('base64') !== output.bytesBase64
      || createHash('sha256').update(source).digest('hex') !== output.digestSha256
    ) throw new Error('Server artifact entry point digest is invalid.');
    const admission = fnFunctionArtifactAdmission(source.toString('utf8'));
    if (!admission.allowed) throw new Error(`Server function uses unsupported runtime construct '${admission.token}'.`);

    const requestId = this.#createId();
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    let resolveDescriptors!: (value: readonly TWidgetServerFunctionDescriptor[]) => void;
    let rejectDescriptors!: (error: Error) => void;
    const descriptors = new Promise<readonly TWidgetServerFunctionDescriptor[]>((resolve, reject) => {
      resolveDescriptors = resolve;
      rejectDescriptors = reject;
    });
    // Child exit can reject either phase before the sequential orchestration
    // reaches its await. Mark both promises handled immediately while keeping
    // their original rejection available to the later awaits.
    void ready.catch(() => undefined);
    void descriptors.catch(() => undefined);
    assertBeforeDeadline();
    const cage = await this.#awaitBeforeDeadline(
      createBunChildCage(this.#tempRoot),
      deadlineAtMs,
      deadlineError,
      (lateCage) => removeBunChildCage(lateCage),
    );
    let child: Bun.Subprocess;
    try {
      assertBeforeDeadline();
      child = this.#spawn([...this.#command], {
        cwd: cage.path,
        detached: true,
        env: {},
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        ipc: (raw) => {
          const message = raw as TFunctionWorkerToHostMessage;
          if (this.#nowMs() >= deadlineAtMs) {
            const error = deadlineError();
            rejectReady(error);
            rejectDescriptors(error);
            try { child.kill(); } catch { /* teardown verifies the process group */ }
            return;
          }
          if (message.type === 'ready') resolveReady();
          if (message.type === 'inspected' && message.requestId === requestId) {
            let bytes = Number.POSITIVE_INFINITY;
            try { bytes = Buffer.byteLength(JSON.stringify(message.descriptors)); } catch { /* rejected below */ }
            if (bytes > this.#outputByteLimit || message.descriptors.length > 128) {
              rejectDescriptors(new Error('Function descriptor extraction output exceeds its bound.'));
            } else {
              resolveDescriptors(Object.freeze(message.descriptors.map((value) => Object.freeze(value))));
            }
          }
          if (message.type === 'load_error' && message.requestId === requestId) {
            rejectDescriptors(new Error(message.failure.message));
          }
        },
      });
    } catch (error) {
      try {
        await removeBunChildCage(cage);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Function descriptor child failed to spawn and cage cleanup also failed.',
        );
      }
      throw error;
    }
    this.#activePids.add(child.pid);
    const failDeadline = () => {
      const error = deadlineError();
      rejectReady(error);
      rejectDescriptors(error);
      try { child.kill(); } catch { /* teardown verifies the process group */ }
    };
    let memoryExceeded = false;
    let memorySampleRunning: Promise<void> | null = null;
    const sampleMemory = async () => {
      if (memoryExceeded) return;
      if (memorySampleRunning !== null) return memorySampleRunning;
      const sample = (async () => {
        try {
          const rssBytes = await this.#readRssBytes(child.pid);
          if (rssBytes <= this.#memoryLimitBytes) return;
          memoryExceeded = true;
          const error = Object.assign(
            new Error('Function descriptor child exceeded its memory limit.'),
            { code: 'FUNCTION_MEMORY_LIMIT' },
          );
          rejectReady(error);
          rejectDescriptors(error);
          try { child.kill(); } catch { /* teardown verifies the process group */ }
        } catch {
          // A transient host probe failure is retried by the next sample.
        }
      })();
      memorySampleRunning = sample;
      try {
        await sample;
      } finally {
        if (memorySampleRunning === sample) memorySampleRunning = null;
      }
    };
    const memoryTimer = setInterval(() => { void sampleMemory(); }, this.#memorySampleMs);
    (memoryTimer as unknown as { unref?: () => void }).unref?.();
    const overflow = () => {
      rejectDescriptors(new Error('Function descriptor child output exceeds its bound.'));
      try { child.kill(); } catch { /* already exited */ }
    };
    const streams = [
      drainBounded(child.stdout, 65_536, overflow),
      drainBounded(child.stderr, 65_536, overflow),
    ];
    const timeout = setTimeout(failDeadline, Math.max(0, deadlineAtMs - this.#nowMs()));
    void child.exited.then((exitCode) => {
      const error = new Error(`Function descriptor child exited before completion (${exitCode}).`);
      rejectReady(error);
      rejectDescriptors(error);
    });
    try {
      assertBeforeDeadline();
      await this.#awaitBeforeDeadline(sampleMemory(), deadlineAtMs, deadlineError);
      assertBeforeDeadline();
      if (memoryExceeded) throw Object.assign(
        new Error('Function descriptor child exceeded its memory limit.'),
        { code: 'FUNCTION_MEMORY_LIMIT' },
      );
      await ready;
      assertBeforeDeadline();
      const message: THostToFunctionWorkerMessage = {
        type: 'inspect',
        requestId,
        sourceBase64: output.bytesBase64,
        sourceDigestSha256: output.digestSha256,
      };
      assertBeforeDeadline();
      child.send(message);
      const result = await descriptors;
      assertBeforeDeadline();
      await this.#awaitBeforeDeadline(sampleMemory(), deadlineAtMs, deadlineError);
      assertBeforeDeadline();
      if (memoryExceeded) throw Object.assign(
        new Error('Function descriptor child exceeded its memory limit.'),
        { code: 'FUNCTION_MEMORY_LIMIT' },
      );
      return result;
    } finally {
      clearTimeout(timeout);
      clearInterval(memoryTimer);
      try {
        await terminateBunChild(
          child,
          cage,
          this.#cancelGraceMs,
          this.#processGroups,
        );
        this.#teardownFailures.delete(child.pid);
        this.#activePids.delete(child.pid);
      } catch (error) {
        this.#teardownFailures.set(
          child.pid,
          error instanceof Error ? error.message : 'Function descriptor child teardown failed.',
        );
        throw error;
      } finally {
        await Promise.allSettled(streams);
      }
    }
  }

  #awaitBeforeDeadline<T>(
    task: Promise<T>,
    deadlineAtMs: number,
    deadlineError: () => Error,
    cleanupLateValue?: (value: T) => Promise<void>,
  ): Promise<T> {
    const remainingMs = deadlineAtMs - this.#nowMs();
    if (remainingMs <= 0) return Promise.reject(deadlineError());
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(deadlineError());
      }, remainingMs);
      task.then(
        (value) => {
          if (settled) {
            if (cleanupLateValue) void cleanupLateValue(value).catch(() => undefined);
            return;
          }
          settled = true;
          clearTimeout(timeout);
          if (this.#nowMs() >= deadlineAtMs) {
            if (cleanupLateValue) void cleanupLateValue(value).catch(() => undefined);
            reject(deadlineError());
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

  diagnostics(): Readonly<{
    activeGuestCount: number;
    activeGuestPids: readonly number[];
    activeGuestProcessGroupIds: readonly number[];
    teardownFailures: readonly Readonly<{ processGroupId: number; message: string }>[];
  }> {
    return Object.freeze({
      activeGuestCount: this.#activePids.size,
      activeGuestPids: Object.freeze([...this.#activePids]),
      activeGuestProcessGroupIds: Object.freeze([...this.#activePids]),
      teardownFailures: Object.freeze([...this.#teardownFailures].map(([processGroupId, message]) => ({
        processGroupId,
        message,
      }))),
    });
  }
}
