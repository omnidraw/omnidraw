/** @file Bounded one-request/one-response function execution orchestration. */

import type { IDirectFunctionInvoker, IFunctionSandboxDriver } from '../interface';
import type {
  TDirectFunctionInvocationRequest,
  TDirectFunctionResult,
  TFunctionDiagnostics,
  TFunctionFailure,
  TFunctionSandboxHandle,
} from '../types';
import type { IFunctionSchemaValidator } from './JsonSchemaFunctionValidator';
import { fnCanonicalJson } from './fn.canonical-json';

const HARD_TIMEOUT_MS = 30_000;
const MAX_INPUT_BYTES = 1_048_576;
const MAX_DIAGNOSTICS_BYTES = 64 * 1_024;

export type TDirectFunctionExecutorConfig = Readonly<{
  driver: IFunctionSandboxDriver;
  schemas: IFunctionSchemaValidator;
  maxConcurrent?: number;
  nowMs: () => number;
  createId: () => string;
}>;

export type TDirectFunctionExecutorDiagnostics = Readonly<{
  activeCalls: number;
  maxConcurrent: number;
}>;

function errorWithCode(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function failure(owner: TFunctionFailure['owner'], code: string, message: string): TFunctionFailure {
  return Object.freeze({ owner, code, message });
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function boundedDiagnostics(
  value: Readonly<{ code: string | null; message: string | null; logByteSize: number }>,
): TFunctionDiagnostics {
  const encoded = new TextEncoder();
  const logByteSize = Number.isSafeInteger(value.logByteSize) && value.logByteSize >= 0
    ? value.logByteSize
    : 0;
  let message = value.message;
  let truncated = logByteSize > MAX_DIAGNOSTICS_BYTES;
  if (message !== null && encoded.encode(message).byteLength > MAX_DIAGNOSTICS_BYTES) {
    const bytes = encoded.encode(message).slice(0, MAX_DIAGNOSTICS_BYTES);
    message = new TextDecoder().decode(bytes);
    truncated = true;
  }
  return Object.freeze({
    code: value.code,
    message,
    logByteSize: Math.min(logByteSize, MAX_DIAGNOSTICS_BYTES),
    truncated,
  });
}

function failedResult(
  status: 'failed' | 'cancelled' | 'timed_out',
  item: TFunctionFailure,
  logByteSize = 0,
): TDirectFunctionResult {
  return Object.freeze({
    status,
    output: null,
    failure: item,
    diagnostics: boundedDiagnostics({
      code: item.code,
      message: item.message,
      logByteSize,
    }),
  });
}

/**
 * Runs each call in one disposable child and retains only the live Promise.
 * Capacity rejection is immediate: there is deliberately no queue.
 */
export class DirectFunctionExecutor implements IDirectFunctionInvoker {
  readonly #driver: IFunctionSandboxDriver;
  readonly #schemas: IFunctionSchemaValidator;
  readonly #maxConcurrent: number;
  readonly #nowMs: () => number;
  readonly #createId: () => string;
  #activeCalls = 0;

  constructor(config: TDirectFunctionExecutorConfig) {
    this.#driver = config.driver;
    this.#schemas = config.schemas;
    this.#maxConcurrent = config.maxConcurrent ?? 4;
    this.#nowMs = config.nowMs;
    this.#createId = config.createId;
    if (!Number.isInteger(this.#maxConcurrent) || this.#maxConcurrent < 1 || this.#maxConcurrent > 64) {
      throw new RangeError('Direct function concurrency must be between 1 and 64.');
    }
  }

  async invoke(request: TDirectFunctionInvocationRequest): Promise<TDirectFunctionResult> {
    const descriptor = request.definition.descriptor;
    if (descriptor.limits.timeoutMs > HARD_TIMEOUT_MS) {
      throw errorWithCode('FUNCTION_REQUEST_INVALID', 'Function timeout exceeds the host maximum.');
    }
    try {
      fnCanonicalJson(request.input, {
        maxBytes: MAX_INPUT_BYTES,
        maxDepth: 64,
        maxNodes: 100_000,
      });
    } catch {
      throw errorWithCode('FUNCTION_INPUT_INVALID', 'Function input must be bounded JSON.');
    }
    if (!this.#schemas.validate(descriptor.inputSchema, request.input).valid) {
      throw errorWithCode('FUNCTION_INPUT_SCHEMA_INVALID', 'Function input does not match its schema.');
    }
    if (request.signal?.aborted === true) {
      return failedResult(
        'cancelled',
        failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.'),
      );
    }
    if (this.#activeCalls >= this.#maxConcurrent) {
      throw errorWithCode('RESOURCE_EXHAUSTED', 'Direct function concurrency is full.');
    }

    this.#activeCalls += 1;
    let handle: TFunctionSandboxHandle | null = null;
    let running = false;
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      if (handle === null) return;
      const operation = running
        ? this.#driver.cancel(handle, 'request cancelled or disconnected')
        : this.#driver.destroy(handle);
      void operation.catch(() => undefined);
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const startedAtMs = this.#nowMs();
      const deadlineAtMs = startedAtMs + Math.min(descriptor.limits.timeoutMs, HARD_TIMEOUT_MS);
      const call = Object.freeze({
        id: this.#createId(),
        subject: request.subject,
        definition: request.definition,
        input: request.input,
        deadlineAtMs,
      });
      handle = await this.#driver.prepare({
        definition: request.definition,
        artifact: request.artifact,
      });
      if (cancelled) {
        await this.#driver.destroy(handle).catch(() => undefined);
        handle = null;
        return failedResult(
          'cancelled',
          failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.'),
        );
      }
      handle = await this.#driver.start(handle, {
        deadlineAtMs,
        observeMetrics: () => undefined,
      });
      running = true;
      if (cancelled) {
        await this.#driver.cancel(handle, 'request cancelled or disconnected').catch(() => undefined);
        return failedResult(
          'cancelled',
          failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.'),
        );
      }
      const resources = await request.createResources(call);
      if (cancelled) {
        return failedResult(
          'cancelled',
          failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.'),
        );
      }
      const result = await this.#driver.execute(handle, call, resources);
      if (!Number.isSafeInteger(result.logByteSize) || result.logByteSize < 0) {
        return failedResult(
          'failed',
          failure('platform', 'FUNCTION_LOG_INTEGRITY', 'Function log byte accounting is invalid.'),
        );
      }
      const logByteSize = result.logByteSize;
      if (result.status === 'failed') {
        const status = result.failure.code === 'FUNCTION_TIMED_OUT'
          ? 'timed_out'
          : result.failure.code === 'FUNCTION_CANCELLED'
            ? 'cancelled'
            : 'failed';
        return failedResult(status, result.failure, logByteSize);
      }
      if (logByteSize > descriptor.limits.logByteLimit) {
        return failedResult(
          'failed',
          failure('user', 'FUNCTION_LOG_LIMIT', 'Function logs exceed their byte limit.'),
          logByteSize,
        );
      }
      let canonicalOutput: string;
      try {
        canonicalOutput = fnCanonicalJson(result.output, {
          maxBytes: descriptor.limits.outputByteLimit,
          maxDepth: 64,
          maxNodes: 100_000,
        });
      } catch {
        return failedResult(
          'failed',
          failure('user', 'FUNCTION_OUTPUT_LIMIT', 'Function output is invalid or exceeds its byte limit.'),
          logByteSize,
        );
      }
      const outputByteSize = new TextEncoder().encode(canonicalOutput).byteLength;
      if (
        !Number.isSafeInteger(result.outputByteSize)
        || result.outputByteSize < 0
        || result.outputByteSize > descriptor.limits.outputByteLimit
        || result.outputByteSize !== outputByteSize
      ) {
        return failedResult(
          'failed',
          failure('platform', 'FUNCTION_OUTPUT_INTEGRITY', 'Function output byte accounting is invalid.'),
          logByteSize,
        );
      }
      if (!this.#schemas.validate(descriptor.outputSchema, result.output).valid) {
        return failedResult(
          'failed',
          failure('user', 'FUNCTION_OUTPUT_SCHEMA_INVALID', 'Function output does not match its schema.'),
          logByteSize,
        );
      }
      return Object.freeze({
        status: 'succeeded' as const,
        output: result.output,
        diagnostics: boundedDiagnostics({
          code: null,
          message: null,
          logByteSize,
        }),
      });
    } catch (error) {
      const code = errorCode(error);
      if (cancelled || code === 'FUNCTION_CANCELLED') {
        return failedResult(
          'cancelled',
          failure('cancelled', 'FUNCTION_CANCELLED', 'Function invocation was cancelled.'),
        );
      }
      if (code === 'FUNCTION_TIMED_OUT') {
        return failedResult(
          'timed_out',
          failure('cancelled', 'FUNCTION_TIMED_OUT', 'Function invocation exceeded its deadline.'),
        );
      }
      return failedResult(
        'failed',
        failure('platform', 'FUNCTION_EXECUTION_FAILED', 'Function execution failed inside the host boundary.'),
      );
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      if (handle !== null) await this.#driver.destroy(handle).catch(() => undefined);
      this.#activeCalls -= 1;
    }
  }

  diagnostics(): TDirectFunctionExecutorDiagnostics {
    return Object.freeze({
      activeCalls: this.#activeCalls,
      maxConcurrent: this.#maxConcurrent,
    });
  }
}
