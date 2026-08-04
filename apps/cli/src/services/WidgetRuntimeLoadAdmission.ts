import type { IService } from '@omnidraw/runtime';
import {
  WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_CAPACITY_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE,
  type TWidgetRuntimeLoadAdmissionCapability,
  type TWidgetRuntimeLoadCleanupRegistrar,
} from '@omnidraw/api/widget';

type TWidgetRuntimeLoadAdmissionOptions = Readonly<{
  maxGlobal?: number;
  deadlineMs?: number;
}>;

type TWidgetRuntimeLoadAdmissionDiagnostics = Readonly<{
  activeGlobal: number;
  activeLoadsGlobal: number;
  activeCleanupGlobal: number;
}>;

const DEFAULT_MAX_GLOBAL_RUNTIME_LOADS = 64;
const DEFAULT_RUNTIME_LOAD_DEADLINE_MS = 30_000;

function admissionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export class WidgetRuntimeLoadAdmission implements
  IService,
  TWidgetRuntimeLoadAdmissionCapability {
  readonly name = 'widget-runtime-load-admission';
  readonly #maxGlobal: number;
  readonly #deadlineMs: number;
  #activeGlobal = 0;
  #activeLoadsGlobal = 0;
  #activeCleanupGlobal = 0;

  constructor(options: TWidgetRuntimeLoadAdmissionOptions = {}) {
    this.#maxGlobal = this.#positiveInteger(
      options.maxGlobal ?? DEFAULT_MAX_GLOBAL_RUNTIME_LOADS,
      'global runtime load limit',
      1_024,
    );
    this.#deadlineMs = this.#positiveInteger(
      options.deadlineMs ?? DEFAULT_RUNTIME_LOAD_DEADLINE_MS,
      'runtime load deadline',
      300_000,
    );
  }

  async run<TResult>(
    requestSignal: AbortSignal | undefined,
    operation: (
      lifetimeSignal: AbortSignal,
      deferCleanup: TWidgetRuntimeLoadCleanupRegistrar,
    ) => Promise<TResult>,
  ): Promise<TResult> {
    if (requestSignal?.aborted) {
      throw admissionError(
        WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
        'Widget runtime load was cancelled.',
      );
    }
    if (this.#activeGlobal >= this.#maxGlobal) {
      throw admissionError(
        WIDGET_RUNTIME_LOAD_CAPACITY_ERROR_CODE,
        'Widget runtime load capacity is exhausted.',
      );
    }

    const lifetime = new AbortController();
    const cancel = () => lifetime.abort(admissionError(
      WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
      'Widget runtime load was cancelled.',
    ));
    requestSignal?.addEventListener('abort', cancel, { once: true });
    if (requestSignal?.aborted) cancel();
    const deadline = setTimeout(() => lifetime.abort(admissionError(
      WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE,
      'Widget runtime load exceeded its host deadline.',
    )), this.#deadlineMs);

    this.#activeGlobal += 1;
    this.#activeLoadsGlobal += 1;

    let operationSettled = false;
    let deferredCleanup: Promise<void> | null = null;
    const deferCleanup: TWidgetRuntimeLoadCleanupRegistrar = (cleanup) => {
      if (operationSettled) {
        throw new Error('Widget runtime cleanup must be registered before load settlement.');
      }
      if (deferredCleanup !== null) {
        throw new Error('Widget runtime load cleanup was already registered.');
      }
      try {
        deferredCleanup = Promise.resolve(cleanup()).then(
          () => undefined,
          () => undefined,
        );
      } catch {
        deferredCleanup = Promise.resolve();
      }
    };
    let rejectAborted: (() => void) | null = null;
    const releaseCapacityLease = () => {
      this.#activeGlobal -= 1;
    };
    const finishOperation = () => {
      if (operationSettled) return;
      operationSettled = true;
      clearTimeout(deadline);
      requestSignal?.removeEventListener('abort', cancel);
      if (rejectAborted !== null) {
        lifetime.signal.removeEventListener('abort', rejectAborted);
      }
      this.#activeLoadsGlobal -= 1;
      if (deferredCleanup === null) {
        releaseCapacityLease();
        return;
      }

      this.#activeCleanupGlobal += 1;
      void deferredCleanup.then(() => {
        this.#activeCleanupGlobal -= 1;
        releaseCapacityLease();
      });
    };
    const operationResult = Promise.resolve()
      .then(() => {
        this.#throwIfAborted(lifetime.signal);
        return operation(lifetime.signal, deferCleanup);
      })
      .then(
        (result) => {
          this.#throwIfAborted(lifetime.signal);
          return result;
        },
        (error: unknown) => {
          if (lifetime.signal.aborted) this.#throwIfAborted(lifetime.signal);
          throw error;
        },
      );
    void operationResult.then(finishOperation, finishOperation);
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = () => {
        try {
          this.#throwIfAborted(lifetime.signal);
        } catch (error) {
          reject(error);
        }
      };
      lifetime.signal.addEventListener('abort', rejectAborted, { once: true });
    });
    return await Promise.race([operationResult, aborted]);
  }

  diagnostics(): TWidgetRuntimeLoadAdmissionDiagnostics {
    return Object.freeze({
      activeGlobal: this.#activeGlobal,
      activeLoadsGlobal: this.#activeLoadsGlobal,
      activeCleanupGlobal: this.#activeCleanupGlobal,
    });
  }

  #throwIfAborted(signal: AbortSignal): void {
    if (!signal.aborted) return;
    throw signal.reason instanceof Error
      ? signal.reason
      : admissionError(
        WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
        'Widget runtime load was cancelled.',
      );
  }

  #positiveInteger(value: number, label: string, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(`${label} must be between 1 and ${maximum}.`);
    }
    return value;
  }
}

export type {
  TWidgetRuntimeLoadAdmissionDiagnostics,
  TWidgetRuntimeLoadAdmissionOptions,
};
