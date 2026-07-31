import type { IService } from '@omnidraw/runtime';
import type { TTenantContext } from '@omnidraw/tenant-core';
import {
  WIDGET_RUNTIME_LOAD_CANCELLED_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_CAPACITY_ERROR_CODE,
  WIDGET_RUNTIME_LOAD_TIMEOUT_ERROR_CODE,
  type TWidgetRuntimeLoadAdmissionCapability,
  type TWidgetRuntimeLoadCleanupRegistrar,
} from '@omnidraw/api/widget';
import { fnWidgetRuntimeLoadCanAdmit } from './fn.widget-runtime-load-admission';

type TWidgetRuntimeLoadAdmissionOptions = Readonly<{
  maxGlobal?: number;
  maxPerOrganization?: number;
  deadlineMs?: number;
}>;

type TWidgetRuntimeLoadAdmissionDiagnostics = Readonly<{
  activeGlobal: number;
  activeOrganizations: Readonly<Record<string, number>>;
  activeLoadsGlobal: number;
  activeLoadOrganizations: Readonly<Record<string, number>>;
  activeCleanupGlobal: number;
  activeCleanupOrganizations: Readonly<Record<string, number>>;
}>;

const DEFAULT_MAX_GLOBAL_RUNTIME_LOADS = 64;
const DEFAULT_MAX_RUNTIME_LOADS_PER_ORGANIZATION = 32;
const DEFAULT_RUNTIME_LOAD_DEADLINE_MS = 30_000;

function admissionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export class WidgetRuntimeLoadAdmission implements
  IService,
  TWidgetRuntimeLoadAdmissionCapability {
  readonly name = 'widget-runtime-load-admission';
  readonly #maxGlobal: number;
  readonly #maxPerOrganization: number;
  readonly #deadlineMs: number;
  readonly #activeByOrganization = new Map<string, number>();
  readonly #activeLoadsByOrganization = new Map<string, number>();
  readonly #activeCleanupByOrganization = new Map<string, number>();
  #activeGlobal = 0;
  #activeLoadsGlobal = 0;
  #activeCleanupGlobal = 0;

  constructor(options: TWidgetRuntimeLoadAdmissionOptions = {}) {
    this.#maxGlobal = this.#positiveInteger(
      options.maxGlobal ?? DEFAULT_MAX_GLOBAL_RUNTIME_LOADS,
      'global runtime load limit',
      1_024,
    );
    this.#maxPerOrganization = this.#positiveInteger(
      options.maxPerOrganization ?? DEFAULT_MAX_RUNTIME_LOADS_PER_ORGANIZATION,
      'organization runtime load limit',
      this.#maxGlobal,
    );
    this.#deadlineMs = this.#positiveInteger(
      options.deadlineMs ?? DEFAULT_RUNTIME_LOAD_DEADLINE_MS,
      'runtime load deadline',
      300_000,
    );
  }

  async run<TResult>(
    tenant: TTenantContext,
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
    const activeOrganization = this.#activeByOrganization.get(tenant.orgId) ?? 0;
    if (!fnWidgetRuntimeLoadCanAdmit(
      { activeGlobal: this.#activeGlobal, activeOrganization },
      { maxGlobal: this.#maxGlobal, maxPerOrganization: this.#maxPerOrganization },
    )) {
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
    this.#activeByOrganization.set(tenant.orgId, activeOrganization + 1);
    this.#activeLoadsGlobal += 1;
    this.#incrementOrganization(this.#activeLoadsByOrganization, tenant.orgId);

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
      this.#decrementOrganization(this.#activeByOrganization, tenant.orgId);
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
      this.#decrementOrganization(this.#activeLoadsByOrganization, tenant.orgId);
      if (deferredCleanup === null) {
        releaseCapacityLease();
        return;
      }

      this.#activeCleanupGlobal += 1;
      this.#incrementOrganization(this.#activeCleanupByOrganization, tenant.orgId);
      void deferredCleanup.then(() => {
        this.#activeCleanupGlobal -= 1;
        this.#decrementOrganization(this.#activeCleanupByOrganization, tenant.orgId);
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
      activeOrganizations: Object.freeze(Object.fromEntries(this.#activeByOrganization)),
      activeLoadsGlobal: this.#activeLoadsGlobal,
      activeLoadOrganizations: Object.freeze(
        Object.fromEntries(this.#activeLoadsByOrganization),
      ),
      activeCleanupGlobal: this.#activeCleanupGlobal,
      activeCleanupOrganizations: Object.freeze(
        Object.fromEntries(this.#activeCleanupByOrganization),
      ),
    });
  }

  #incrementOrganization(counts: Map<string, number>, orgId: string): void {
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
  }

  #decrementOrganization(counts: Map<string, number>, orgId: string): void {
    const remaining = (counts.get(orgId) ?? 1) - 1;
    if (remaining === 0) counts.delete(orgId);
    else counts.set(orgId, remaining);
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
