import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { TWidgetSourceSnapshot } from '@vibecanvas/widget-contract';
import {
  WIDGET_TYPESCRIPT_MAX_DIAGNOSTICS,
  WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH,
  WIDGET_TYPESCRIPT_MAX_CONCURRENCY,
  WIDGET_TYPESCRIPT_MAX_FILES,
  WIDGET_TYPESCRIPT_MAX_FILE_BYTES,
  WIDGET_TYPESCRIPT_MAX_TOTAL_BYTES,
  WIDGET_TYPESCRIPT_MEMORY_LIMIT_BYTES,
  WIDGET_TYPESCRIPT_MEMORY_SAMPLE_MS,
  WIDGET_TYPESCRIPT_TIMEOUT_MS,
} from './CONSTANTS';
import type {
  TWidgetTypecheckRequestMessage,
  TWidgetTypecheckWorkerMessage,
} from './widget-typecheck-protocol';

type TWidgetTypeScriptValidatorConfig = Readonly<{
  compiledExecutable?: boolean;
  executable?: string;
  workerPath?: string;
  spawn?: typeof Bun.spawn;
  timeoutMs?: number;
  memoryLimitBytes?: number;
  memorySampleMs?: number;
  maxConcurrentValidations?: number;
  readRssBytes?: (processId: number) => Promise<number>;
  createId?: () => string;
}>;

type TWidgetTypeScriptValidatorDiagnostics = Readonly<{
  activeProcessCount: number;
  activeProcessIds: readonly number[];
  activeValidationCount: number;
  maximumConcurrency: number;
}>;

function boundedWorkerMessage(value: unknown): string {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH)
    || 'Widget TypeScript validation failed.';
}

async function readWidgetTypecheckRssBytes(processId: number): Promise<number> {
  const measurement = Bun.spawn(['ps', '-o', 'rss=', '-p', String(processId)], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: {},
  });
  const text = await new Response(measurement.stdout).text();
  const exit = await measurement.exited;
  if (exit !== 0) return 0;
  const kibibytes = Number.parseInt(text.trim(), 10);
  return Number.isFinite(kibibytes) && kibibytes > 0 ? kibibytes * 1_024 : 0;
}

function validationRequest(
  snapshot: TWidgetSourceSnapshot,
  requestId: string,
  deadlineAtMs: number,
  memoryLimitBytes: number,
): TWidgetTypecheckRequestMessage {
  if (snapshot.files.length > WIDGET_TYPESCRIPT_MAX_FILES) {
    throw new Error('Widget TypeScript validation source file count exceeds its bound.');
  }
  let totalBytes = 0;
  const files = snapshot.files.map((file) => {
    if (file.bytes.byteLength > WIDGET_TYPESCRIPT_MAX_FILE_BYTES) {
      throw new Error('Widget TypeScript validation source file exceeds its byte bound.');
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > WIDGET_TYPESCRIPT_MAX_TOTAL_BYTES) {
      throw new Error('Widget TypeScript validation source snapshot exceeds its byte bound.');
    }
    return Object.freeze({
      path: file.path,
      bytesBase64: Buffer.from(file.bytes).toString('base64'),
    });
  });
  return Object.freeze({
    type: 'validate',
    requestId,
    limits: Object.freeze({ deadlineAtMs, memoryLimitBytes }),
    snapshot: Object.freeze({
      id: snapshot.id,
      digestSha256: snapshot.digestSha256,
      createdAtMs: snapshot.createdAtMs,
      files: Object.freeze(files),
    }),
  });
}

/** Terminable host compiler boundary for untrusted pinned widget source. */
export class WidgetTypeScriptValidator {
  readonly #spawn: typeof Bun.spawn;
  readonly #command: readonly string[];
  readonly #timeoutMs: number;
  readonly #memoryLimitBytes: number;
  readonly #memorySampleMs: number;
  readonly #maximumConcurrency: number;
  readonly #readRssBytes: (processId: number) => Promise<number>;
  readonly #createId: () => string;
  readonly #activeProcessIds = new Set<number>();
  #activeValidationCount = 0;

  constructor(config: TWidgetTypeScriptValidatorConfig = {}) {
    this.#spawn = config.spawn ?? Bun.spawn;
    const executable = config.executable ?? process.execPath;
    this.#command = config.compiledExecutable
      ? Object.freeze([executable, '--widget-typecheck-worker'])
      : Object.freeze([
          executable,
          config.workerPath ?? fileURLToPath(new URL('./widget-typecheck-worker.ts', import.meta.url)),
          '--widget-typecheck-worker',
        ]);
    this.#timeoutMs = config.timeoutMs ?? WIDGET_TYPESCRIPT_TIMEOUT_MS;
    this.#memoryLimitBytes = config.memoryLimitBytes ?? WIDGET_TYPESCRIPT_MEMORY_LIMIT_BYTES;
    this.#memorySampleMs = config.memorySampleMs ?? WIDGET_TYPESCRIPT_MEMORY_SAMPLE_MS;
    this.#maximumConcurrency = config.maxConcurrentValidations
      ?? WIDGET_TYPESCRIPT_MAX_CONCURRENCY;
    this.#readRssBytes = config.readRssBytes ?? readWidgetTypecheckRssBytes;
    this.#createId = config.createId ?? randomUUID;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new RangeError('Widget TypeScript timeout must be positive.');
    }
    if (!Number.isInteger(this.#memoryLimitBytes) || this.#memoryLimitBytes < 1) {
      throw new RangeError('Widget TypeScript memory limit must be positive.');
    }
    if (!Number.isInteger(this.#memorySampleMs) || this.#memorySampleMs < 1) {
      throw new RangeError('Widget TypeScript memory sample interval must be positive.');
    }
    if (!Number.isInteger(this.#maximumConcurrency) || this.#maximumConcurrency < 1) {
      throw new RangeError('Widget TypeScript maximum concurrency must be positive.');
    }
  }

  diagnostics(): TWidgetTypeScriptValidatorDiagnostics {
    const activeProcessIds = [...this.#activeProcessIds].sort((left, right) => left - right);
    return Object.freeze({
      activeProcessCount: activeProcessIds.length,
      activeProcessIds: Object.freeze(activeProcessIds),
      activeValidationCount: this.#activeValidationCount,
      maximumConcurrency: this.#maximumConcurrency,
    });
  }

  async validate(snapshot: TWidgetSourceSnapshot): Promise<readonly string[]> {
    if (this.#activeValidationCount >= this.#maximumConcurrency) {
      throw Object.assign(
        new Error('Widget TypeScript validation is at its concurrency limit.'),
        { code: 'WIDGET_TYPESCRIPT_OVERLOADED' },
      );
    }
    this.#activeValidationCount += 1;
    try {
      return await this.#validate(snapshot);
    } finally {
      this.#activeValidationCount -= 1;
    }
  }

  async #validate(snapshot: TWidgetSourceSnapshot): Promise<readonly string[]> {
    const requestId = this.#createId();
    const request = validationRequest(
      snapshot,
      requestId,
      Date.now() + this.#timeoutMs,
      this.#memoryLimitBytes,
    );
    let resolveResult!: (diagnostics: readonly string[]) => void;
    let rejectResult!: (error: Error) => void;
    let settled = false;
    const result = new Promise<readonly string[]>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const succeed = (diagnostics: readonly string[]) => {
      if (settled) return;
      settled = true;
      resolveResult(diagnostics);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectResult(error);
    };

    let requestSent = false;
    let child!: Bun.Subprocess;
    child = this.#spawn([...this.#command], {
      env: {},
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      ipc: (raw: unknown) => {
        if (settled || raw === null || typeof raw !== 'object' || !('type' in raw)) return;
        const message = raw as TWidgetTypecheckWorkerMessage;
        if (message.type === 'ready') {
          if (requestSent) return;
          requestSent = true;
          try {
            child.send(request);
          } catch (error) {
            fail(new Error(`Widget TypeScript worker request failed: ${boundedWorkerMessage(error)}`));
          }
          return;
        }
        if (message.requestId !== requestId) return;
        if (message.type === 'failure') {
          fail(new Error(boundedWorkerMessage(message.message)));
          return;
        }
        if (
          !Array.isArray(message.diagnostics)
          || message.diagnostics.length > WIDGET_TYPESCRIPT_MAX_DIAGNOSTICS
          || message.diagnostics.some((diagnostic) => (
            typeof diagnostic !== 'string'
            || diagnostic.length > WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH
          ))
        ) {
          fail(new Error('Widget TypeScript worker returned invalid diagnostics.'));
          return;
        }
        succeed(Object.freeze([...message.diagnostics]));
      },
    });
    this.#activeProcessIds.add(child.pid);
    void child.exited.then((exitCode) => {
      fail(new Error(`Widget TypeScript worker exited before completion (${exitCode}).`));
    }, (error) => {
      fail(new Error(`Widget TypeScript worker exit failed: ${boundedWorkerMessage(error)}`));
    });

    const timeout = setTimeout(() => {
      fail(Object.assign(
        new Error('Widget TypeScript validation exceeded its deadline.'),
        { code: 'WIDGET_TYPESCRIPT_TIMEOUT' },
      ));
    }, this.#timeoutMs);
    let memorySamplePending = false;
    const memoryTimer = setInterval(() => {
      if (settled || memorySamplePending) return;
      memorySamplePending = true;
      void this.#readRssBytes(child.pid).then((rssBytes) => {
        if (rssBytes > this.#memoryLimitBytes) {
          fail(Object.assign(
            new Error('Widget TypeScript validation exceeded its memory limit.'),
            { code: 'WIDGET_TYPESCRIPT_MEMORY_LIMIT' },
          ));
        }
      }).catch((error) => {
        // The child also checks its own RSS through the compiler cancellation
        // token. A transient host probe failure is retried on the next sample.
        void error;
      }).finally(() => {
        memorySamplePending = false;
      });
    }, this.#memorySampleMs);
    (memoryTimer as unknown as { unref?: () => void }).unref?.();

    try {
      return await result;
    } finally {
      clearTimeout(timeout);
      clearInterval(memoryTimer);
      await this.#terminate(child);
      this.#activeProcessIds.delete(child.pid);
    }
  }

  async #terminate(child: Bun.Subprocess): Promise<void> {
    try { child.kill('SIGKILL'); } catch { /* the one-purpose child may already have exited */ }
    const exited = await Promise.race([
      child.exited.then(() => true, () => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 1_000);
      }),
    ]);
    if (!exited) {
      throw new Error(`Widget TypeScript worker ${child.pid} survived SIGKILL.`);
    }
  }
}

export type {
  TWidgetTypeScriptValidatorConfig,
  TWidgetTypeScriptValidatorDiagnostics,
};
