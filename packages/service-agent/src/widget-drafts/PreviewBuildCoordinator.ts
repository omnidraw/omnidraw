export type TPreviewBuildProgressPhase =
  | 'queued'
  | 'installing'
  | 'building'
  | 'validating'
  | 'ready'
  | 'failed'
  | 'superseded';

export type TPreviewBuildProgress = Readonly<{
  draftId: string;
  buildKey: string;
  sourceDigestSha256: string;
  committedMutationId: string;
  buildSequence: number;
  phase: TPreviewBuildProgressPhase;
}>;

export type TPreviewBuildRunContext = Readonly<{
  buildSequence: number;
  signal: AbortSignal;
  reportProgress(phase: Extract<
    TPreviewBuildProgressPhase,
    'installing' | 'building' | 'validating'
  >): void;
}>;

export type TPreviewBuildRequest<TResult> = Readonly<{
  draftId: string;
  buildKey: string;
  sourceDigestSha256: string;
  committedMutationId: string;
  buildSequence: number;
  force?: boolean;
  build(context: TPreviewBuildRunContext): Promise<TResult>;
}>;

export type TPreviewBuildLastGood<TResult> = Readonly<{
  buildKey: string;
  sourceDigestSha256: string;
  committedMutationId: string;
  buildSequence: number;
  result: TResult;
}>;

export type TPreviewBuildOutcome<TResult> =
  | Readonly<{
      status: 'ready';
      draftId: string;
      buildKey: string;
      sourceDigestSha256: string;
      committedMutationId: string;
      buildSequence: number;
      reused: boolean;
      result: TResult;
    }>
  | Readonly<{
      status: 'failed';
      draftId: string;
      buildKey: string;
      sourceDigestSha256: string;
      committedMutationId: string;
      buildSequence: number;
      error: unknown;
      lastGood: TPreviewBuildLastGood<TResult> | null;
    }>
  | Readonly<{
      status: 'superseded';
      draftId: string;
      buildKey: string;
      sourceDigestSha256: string;
      committedMutationId: string;
      buildSequence: number;
      lastGood: TPreviewBuildLastGood<TResult> | null;
    }>;

type TPendingBuild<TResult> = {
  buildKey: string;
  sourceDigestSha256: string;
  committedMutationId: string;
  buildSequence: number;
  controller: AbortController;
  timer: unknown;
  settled: boolean;
  promise: Promise<TPreviewBuildOutcome<TResult>>;
  resolve(outcome: TPreviewBuildOutcome<TResult>): void;
  build(context: TPreviewBuildRunContext): Promise<TResult>;
};

type TDraftBuildState<TResult> = {
  latestBuildSequence: number;
  sourceDigestSha256: string | null;
  committedMutationId: string | null;
  pending: TPendingBuild<TResult> | null;
  lastGood: TPreviewBuildLastGood<TResult> | null;
};

export type TPreviewBuildCoordinatorConfig = Readonly<{
  debounceMs?: number;
  scheduleTimeout?(callback: () => void, timeoutMs: number): unknown;
  cancelTimeout?(timer: unknown): void;
}>;

const DEFAULT_DEBOUNCE_MS = 250;

function requiredIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

/**
 * Draft-scoped latest-wins build admission.
 *
 * The coordinator deliberately does not own source capture, persistence, or a
 * runner. Those stay at injected service edges. It owns the concurrency
 * invariant: only the newest sequence may report progress or become last-good.
 */
export class PreviewBuildCoordinator<TResult> {
  readonly #debounceMs: number;
  readonly #scheduleTimeout: (callback: () => void, timeoutMs: number) => unknown;
  readonly #cancelTimeout: (timer: unknown) => void;
  readonly #drafts = new Map<string, TDraftBuildState<TResult>>();
  readonly #listeners = new Set<(progress: TPreviewBuildProgress) => void>();
  #closed = false;

  constructor(config: TPreviewBuildCoordinatorConfig = {}) {
    const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    if (!Number.isSafeInteger(debounceMs) || debounceMs < 0 || debounceMs > 5_000) {
      throw new TypeError('Preview build debounce must be an integer from 0 to 5000 ms.');
    }
    this.#debounceMs = debounceMs;
    this.#scheduleTimeout = config.scheduleTimeout ?? ((callback, timeoutMs) => (
      setTimeout(callback, timeoutMs)
    ));
    this.#cancelTimeout = config.cancelTimeout ?? ((timer) => {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    });
  }

  request(request: TPreviewBuildRequest<TResult>): Promise<TPreviewBuildOutcome<TResult>> {
    if (this.#closed) {
      return Promise.reject(new Error('Preview build coordinator is closed.'));
    }
    const draftId = requiredIdentity(request.draftId, 'Preview draft ID');
    const buildKey = requiredIdentity(request.buildKey, 'Preview build key');
    const sourceDigestSha256 = requiredIdentity(
      request.sourceDigestSha256,
      'Preview source digest',
    );
    const committedMutationId = requiredIdentity(
      request.committedMutationId,
      'Preview committed mutation ID',
    );
    const buildSequence = request.buildSequence;
    if (!Number.isSafeInteger(buildSequence) || buildSequence < 1) {
      throw new TypeError('Preview build sequence must be a positive safe integer.');
    }
    const state = this.#state(draftId);
    if (buildSequence < state.latestBuildSequence) {
      throw new TypeError('Preview build sequence cannot move backwards.');
    }
    if (
      buildSequence === state.latestBuildSequence
      && state.sourceDigestSha256 !== null
      && (
        state.sourceDigestSha256 !== sourceDigestSha256
        || state.committedMutationId !== committedMutationId
      )
    ) {
      throw new TypeError(
        'Preview build sequence cannot identify multiple source mutation fences.',
      );
    }

    if (
      !request.force
      && state.pending?.buildKey === buildKey
      && state.pending.sourceDigestSha256 === sourceDigestSha256
      && state.pending.committedMutationId === committedMutationId
      && state.pending.buildSequence === buildSequence
    ) {
      return state.pending.promise;
    }
    if (
      !request.force
      && state.pending === null
      && state.lastGood?.buildKey === buildKey
      && state.lastGood.sourceDigestSha256 === sourceDigestSha256
      && state.lastGood.committedMutationId === committedMutationId
      && state.lastGood.buildSequence === buildSequence
    ) {
      return Promise.resolve({
        status: 'ready',
        draftId,
        buildKey,
        sourceDigestSha256: state.lastGood.sourceDigestSha256,
        committedMutationId: state.lastGood.committedMutationId,
        buildSequence: state.lastGood.buildSequence,
        reused: true,
        result: state.lastGood.result,
      });
    }

    this.#supersede(draftId, state);
    state.latestBuildSequence = buildSequence;
    state.sourceDigestSha256 = sourceDigestSha256;
    state.committedMutationId = committedMutationId;

    let resolveOutcome!: (outcome: TPreviewBuildOutcome<TResult>) => void;
    const promise = new Promise<TPreviewBuildOutcome<TResult>>((resolve) => {
      resolveOutcome = resolve;
    });
    const pending: TPendingBuild<TResult> = {
      buildKey,
      sourceDigestSha256,
      committedMutationId,
      buildSequence,
      controller: new AbortController(),
      timer: undefined,
      settled: false,
      promise,
      resolve: resolveOutcome,
      build: request.build,
    };
    state.pending = pending;
    this.#publish({
      draftId,
      buildKey,
      sourceDigestSha256,
      committedMutationId,
      buildSequence,
      phase: 'queued',
    });
    pending.timer = this.#scheduleTimeout(() => {
      void this.#run(draftId, state, pending);
    }, this.#debounceMs);
    return promise;
  }

  lastGood(draftId: string): TPreviewBuildLastGood<TResult> | null {
    return this.#drafts.get(draftId)?.lastGood ?? null;
  }

  subscribe(listener: (progress: TPreviewBuildProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  cancel(draftId: string, expectedBuildSequence?: number): boolean {
    const state = this.#drafts.get(draftId);
    if (!state?.pending) return false;
    if (
      expectedBuildSequence !== undefined
      && state.pending.buildSequence !== expectedBuildSequence
    ) return false;
    this.#supersede(draftId, state);
    return true;
  }

  clear(draftId: string): boolean {
    const state = this.#drafts.get(draftId);
    if (!state) return false;
    this.#supersede(draftId, state);
    this.#drafts.delete(draftId);
    return true;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [draftId, state] of this.#drafts) {
      this.#supersede(draftId, state);
    }
    this.#drafts.clear();
    this.#listeners.clear();
  }

  async #run(
    draftId: string,
    state: TDraftBuildState<TResult>,
    pending: TPendingBuild<TResult>,
  ): Promise<void> {
    pending.timer = undefined;
    if (!this.#isCurrent(state, pending)) return;
    this.#publish({
      draftId,
      buildKey: pending.buildKey,
      sourceDigestSha256: pending.sourceDigestSha256,
      committedMutationId: pending.committedMutationId,
      buildSequence: pending.buildSequence,
      phase: 'building',
    });

    try {
      const result = await pending.build({
        buildSequence: pending.buildSequence,
        signal: pending.controller.signal,
        reportProgress: (phase) => {
          if (!this.#isCurrent(state, pending)) return;
          this.#publish({
            draftId,
            buildKey: pending.buildKey,
            sourceDigestSha256: pending.sourceDigestSha256,
            committedMutationId: pending.committedMutationId,
            buildSequence: pending.buildSequence,
            phase,
          });
        },
      });
      if (!this.#isCurrent(state, pending)) return;
      const lastGood = Object.freeze({
        buildKey: pending.buildKey,
        sourceDigestSha256: pending.sourceDigestSha256,
        committedMutationId: pending.committedMutationId,
        buildSequence: pending.buildSequence,
        result,
      });
      state.lastGood = lastGood;
      state.pending = null;
      this.#publish({
        draftId,
        buildKey: pending.buildKey,
        sourceDigestSha256: pending.sourceDigestSha256,
        committedMutationId: pending.committedMutationId,
        buildSequence: pending.buildSequence,
        phase: 'ready',
      });
      this.#settle(pending, {
        status: 'ready',
        draftId,
        buildKey: pending.buildKey,
        sourceDigestSha256: pending.sourceDigestSha256,
        committedMutationId: pending.committedMutationId,
        buildSequence: pending.buildSequence,
        reused: false,
        result,
      });
    } catch (error) {
      if (!this.#isCurrent(state, pending)) return;
      state.pending = null;
      this.#publish({
        draftId,
        buildKey: pending.buildKey,
        sourceDigestSha256: pending.sourceDigestSha256,
        committedMutationId: pending.committedMutationId,
        buildSequence: pending.buildSequence,
        phase: 'failed',
      });
      this.#settle(pending, {
        status: 'failed',
        draftId,
        buildKey: pending.buildKey,
        sourceDigestSha256: pending.sourceDigestSha256,
        committedMutationId: pending.committedMutationId,
        buildSequence: pending.buildSequence,
        error,
        lastGood: state.lastGood,
      });
    }
  }

  #state(draftId: string): TDraftBuildState<TResult> {
    const existing = this.#drafts.get(draftId);
    if (existing) return existing;
    const created: TDraftBuildState<TResult> = {
      latestBuildSequence: 0,
      sourceDigestSha256: null,
      committedMutationId: null,
      pending: null,
      lastGood: null,
    };
    this.#drafts.set(draftId, created);
    return created;
  }

  #isCurrent(
    state: TDraftBuildState<TResult>,
    pending: TPendingBuild<TResult>,
  ): boolean {
    return !pending.settled
      && !pending.controller.signal.aborted
      && state.pending === pending;
  }

  #supersede(draftId: string, state: TDraftBuildState<TResult>): void {
    const pending = state.pending;
    if (!pending) return;
    state.pending = null;
    if (pending.timer !== undefined) {
      this.#cancelTimeout(pending.timer);
      pending.timer = undefined;
    }
    pending.controller.abort();
    this.#publish({
      draftId,
      buildKey: pending.buildKey,
      sourceDigestSha256: pending.sourceDigestSha256,
      committedMutationId: pending.committedMutationId,
      buildSequence: pending.buildSequence,
      phase: 'superseded',
    });
    this.#settle(pending, {
      status: 'superseded',
      draftId,
      buildKey: pending.buildKey,
      sourceDigestSha256: pending.sourceDigestSha256,
      committedMutationId: pending.committedMutationId,
      buildSequence: pending.buildSequence,
      lastGood: state.lastGood,
    });
  }

  #settle(
    pending: TPendingBuild<TResult>,
    outcome: TPreviewBuildOutcome<TResult>,
  ): void {
    if (pending.settled) return;
    pending.settled = true;
    pending.resolve(Object.freeze(outcome));
  }

  #publish(progress: TPreviewBuildProgress): void {
    const frozen = Object.freeze(progress);
    for (const listener of this.#listeners) {
      try {
        listener(frozen);
      } catch {
        // One observer cannot break build admission or another observer.
      }
    }
  }
}
