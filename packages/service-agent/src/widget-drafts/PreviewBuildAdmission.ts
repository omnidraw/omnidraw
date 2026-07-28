export type TPreviewBuildAdmissionScope = Readonly<{
  tenantKey: string;
  draftId: string;
  signal: AbortSignal;
}>;

export interface IPreviewBuildAdmission {
  run<TResult>(
    scope: TPreviewBuildAdmissionScope,
    operation: () => Promise<TResult>,
  ): Promise<TResult>;
}

export type TPreviewBuildAdmissionConfig = Readonly<{
  maxActivePerTenant?: number;
  maxActiveGlobal?: number;
}>;

type TQueuedBuild = {
  readonly tenantKey: string;
  readonly draftKey: string;
  readonly signal: AbortSignal;
  readonly operation: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
};

const DEFAULT_MAX_ACTIVE_PER_TENANT = 2;
const DEFAULT_MAX_ACTIVE_GLOBAL = 4;

function requiredIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

function concurrency(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) {
    throw new TypeError(`${label} must be an integer from 1 to 64.`);
  }
  return value;
}

function abortError(): Error & { code: string } {
  return Object.assign(new Error('Preview build admission was cancelled.'), {
    code: 'WIDGET_PREVIEW_BUILD_SUPERSEDED',
  });
}

/**
 * Process-wide Preview construction admission.
 *
 * Latest-wins ownership remains in PreviewBuildCoordinator. This layer limits
 * expensive guest construction across coordinators while preserving one
 * active operation per tenant/draft. Eligible tenants rotate so one tenant
 * cannot continuously consume every newly available global slot.
 */
export class PreviewBuildAdmission implements IPreviewBuildAdmission {
  readonly #maxActivePerTenant: number;
  readonly #maxActiveGlobal: number;
  readonly #queue: TQueuedBuild[] = [];
  readonly #activeByTenant = new Map<string, number>();
  readonly #activeDrafts = new Set<string>();
  #activeGlobal = 0;
  #lastGrantedTenant: string | null = null;

  constructor(config: TPreviewBuildAdmissionConfig = {}) {
    this.#maxActivePerTenant = concurrency(
      config.maxActivePerTenant ?? DEFAULT_MAX_ACTIVE_PER_TENANT,
      'Preview build tenant concurrency',
    );
    this.#maxActiveGlobal = concurrency(
      config.maxActiveGlobal ?? DEFAULT_MAX_ACTIVE_GLOBAL,
      'Preview build global concurrency',
    );
  }

  run<TResult>(
    scope: TPreviewBuildAdmissionScope,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const tenantKey = requiredIdentity(scope.tenantKey, 'Preview build tenant key');
    const draftId = requiredIdentity(scope.draftId, 'Preview build draft ID');
    if (scope.signal.aborted) return Promise.reject(abortError());
    const draftKey = JSON.stringify([tenantKey, draftId]);

    return new Promise<TResult>((resolve, reject) => {
      const queued: TQueuedBuild = {
        tenantKey,
        draftKey,
        signal: scope.signal,
        operation,
        resolve: (value) => resolve(value as TResult),
        reject,
        onAbort: () => {
          const index = this.#queue.indexOf(queued);
          if (index < 0) return;
          this.#queue.splice(index, 1);
          queued.signal.removeEventListener('abort', queued.onAbort);
          queued.reject(abortError());
          this.#drain();
        },
      };
      scope.signal.addEventListener('abort', queued.onAbort, { once: true });
      this.#queue.push(queued);
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#activeGlobal < this.#maxActiveGlobal) {
      const index = this.#nextEligibleIndex();
      if (index < 0) return;
      const [queued] = this.#queue.splice(index, 1);
      if (!queued) return;
      queued.signal.removeEventListener('abort', queued.onAbort);
      if (queued.signal.aborted) {
        queued.reject(abortError());
        continue;
      }
      this.#admit(queued);
    }
  }

  #nextEligibleIndex(): number {
    let firstEligible = -1;
    for (let index = 0; index < this.#queue.length; index += 1) {
      const queued = this.#queue[index]!;
      if (
        this.#activeDrafts.has(queued.draftKey)
        || (this.#activeByTenant.get(queued.tenantKey) ?? 0)
          >= this.#maxActivePerTenant
      ) continue;
      if (firstEligible < 0) firstEligible = index;
      if (queued.tenantKey !== this.#lastGrantedTenant) return index;
    }
    return firstEligible;
  }

  #admit(queued: TQueuedBuild): void {
    this.#activeGlobal += 1;
    this.#activeByTenant.set(
      queued.tenantKey,
      (this.#activeByTenant.get(queued.tenantKey) ?? 0) + 1,
    );
    this.#activeDrafts.add(queued.draftKey);
    this.#lastGrantedTenant = queued.tenantKey;

    void Promise.resolve()
      .then(queued.operation)
      .then(
        (value) => {
          this.#release(queued);
          queued.resolve(value);
        },
        (error) => {
          this.#release(queued);
          queued.reject(error);
        },
      );
  }

  #release(queued: TQueuedBuild): void {
    this.#activeGlobal -= 1;
    const tenantActive = (this.#activeByTenant.get(queued.tenantKey) ?? 1) - 1;
    if (tenantActive === 0) this.#activeByTenant.delete(queued.tenantKey);
    else this.#activeByTenant.set(queued.tenantKey, tenantActive);
    this.#activeDrafts.delete(queued.draftKey);
    this.#drain();
  }
}
