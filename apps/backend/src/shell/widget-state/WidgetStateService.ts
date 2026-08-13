import {
  DEFAULT_WIDGET_STATE_MAX_ACTIVE_STREAMS,
  DEFAULT_WIDGET_STATE_MAX_MUTATION_RATE_LEDGERS,
  DEFAULT_WIDGET_STATE_REPLAY_CAPACITY,
  DEFAULT_WIDGET_STATE_SUBSCRIBER_QUEUE_CAPACITY,
  WIDGET_STATE_INITIAL_VERSION,
  WIDGET_STATE_MUTATION_RATE_LIMIT,
  WIDGET_STATE_MUTATION_RATE_WINDOW_MS,
} from '#backend/core/widget-state/CONSTANTS';
import type {
  IWidgetStateService,
  IWidgetStateStore,
  TWidgetStateServiceOptions,
  TWidgetStateSubscribeResult,
} from '#backend/shell/widget-state/IWidgetStateService';
import { WidgetStateVersionStream } from './WidgetStateVersionStream';
import { fnNormalizeWidgetStateJson } from '#backend/core/widget-state/fn.widget-state-json';
import {
  fnPruneWidgetStateMutationRateLedger,
  fnTransitionWidgetStateMutationLedger,
  fnWidgetStateMutationCapacityRetryAfter,
  type TWidgetStateMutationAdmission,
} from '#backend/core/widget-state/fn.mutation-rate';
import {
  fnAssertWidgetStateCursor,
  fnAssertWidgetStateVersion,
  fnCreateWidgetStateSnapshot,
  fnNormalizeWidgetStateIdentity,
} from '#backend/core/widget-state/fn.widget-state-values';
import type {
  TWidgetStateChangeArgs,
  TWidgetStateChangeResult,
  TWidgetStateGetArgs,
  TWidgetStateGetResult,
  TWidgetStateInstanceIdentity,
  TWidgetStateReleaseArgs,
  TWidgetStateServiceMetrics,
  TWidgetStateSnapshot,
  TWidgetStateStoredSnapshot,
  TWidgetStateSubscribeArgs,
} from '#backend/core/widget-state/types';

type TMetricCounters = {
  getAttempts: number;
  changeAttempts: number;
  changes: number;
  conflicts: number;
  unavailable: number;
  rateLimited: number;
  subscriptions: number;
  releases: number;
};

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
}

export class WidgetStateService implements IWidgetStateService {
  readonly name = 'widgetState';

  readonly #store: IWidgetStateStore;
  readonly #now: () => number;
  readonly #initialSnapshot: TWidgetStateStoredSnapshot;
  readonly #replayCapacity: number;
  readonly #subscriberQueueCapacity: number;
  readonly #maxActiveStreams: number;
  readonly #mutationRateLimit: number;
  readonly #mutationRateWindowMs: number;
  readonly #maxMutationRateLedgers: number;
  readonly #mutationRateLedgers = new Map<string, {
    lastSeenAt: number;
    timestamps: number[];
  }>();
  readonly #streams = new Map<string, WidgetStateVersionStream>();
  readonly #metrics: TMetricCounters = {
    getAttempts: 0,
    changeAttempts: 0,
    changes: 0,
    conflicts: 0,
    unavailable: 0,
    rateLimited: 0,
    subscriptions: 0,
    releases: 0,
  };
  #disposed = false;

  constructor(
    store: IWidgetStateStore,
    options: TWidgetStateServiceOptions,
  ) {
    const initialVersion = options.initialVersion ?? WIDGET_STATE_INITIAL_VERSION;
    const replayCapacity = options.replayCapacity
      ?? DEFAULT_WIDGET_STATE_REPLAY_CAPACITY;
    const subscriberQueueCapacity = options.subscriberQueueCapacity
      ?? DEFAULT_WIDGET_STATE_SUBSCRIBER_QUEUE_CAPACITY;
    const maxActiveStreams = options.maxActiveStreams
      ?? DEFAULT_WIDGET_STATE_MAX_ACTIVE_STREAMS;
    const mutationRateLimit = options.mutationRateLimit
      ?? WIDGET_STATE_MUTATION_RATE_LIMIT;
    const mutationRateWindowMs = options.mutationRateWindowMs
      ?? WIDGET_STATE_MUTATION_RATE_WINDOW_MS;
    const maxMutationRateLedgers = options.maxMutationRateLedgers
      ?? DEFAULT_WIDGET_STATE_MAX_MUTATION_RATE_LEDGERS;

    fnAssertWidgetStateVersion(initialVersion);
    assertPositiveInteger(replayCapacity, 'Widget state replay capacity');
    assertPositiveInteger(
      subscriberQueueCapacity,
      'Widget state subscriber queue capacity',
    );
    assertPositiveInteger(maxActiveStreams, 'Widget state active stream limit');
    assertPositiveInteger(mutationRateLimit, 'Widget state mutation rate limit');
    assertPositiveInteger(
      mutationRateWindowMs,
      'Widget state mutation rate window',
    );
    assertPositiveInteger(
      maxMutationRateLedgers,
      'Widget state mutation rate ledger limit',
    );

    this.#store = store;
    this.#now = options.now;
    this.#initialSnapshot = Object.freeze({
      version: initialVersion,
      state: fnNormalizeWidgetStateJson(options.initialState ?? null),
    });
    this.#replayCapacity = replayCapacity;
    this.#subscriberQueueCapacity = subscriberQueueCapacity;
    this.#maxActiveStreams = maxActiveStreams;
    this.#mutationRateLimit = mutationRateLimit;
    this.#mutationRateWindowMs = mutationRateWindowMs;
    this.#maxMutationRateLedgers = maxMutationRateLedgers;
  }

  async get(args: TWidgetStateGetArgs): Promise<TWidgetStateGetResult> {
    this.#assertAvailable();
    this.#metrics.getAttempts += 1;
    const identity = fnNormalizeWidgetStateIdentity(args.identity);

    const result = await this.#store.getAuthorizedExactInstance({
      identity,
      initialSnapshot: this.#initialSnapshot,
    });
    if (result.status === 'unavailable') return this.#unavailable();

    const snapshot = fnCreateWidgetStateSnapshot(identity, result.snapshot);
    this.#streams.get(this.#streamScope(identity))?.observe(snapshot);
    return Object.freeze({ status: 'found', snapshot });
  }

  async change(args: TWidgetStateChangeArgs): Promise<TWidgetStateChangeResult> {
    this.#assertAvailable();
    this.#metrics.changeAttempts += 1;
    const identity = fnNormalizeWidgetStateIdentity(args.identity);
    fnAssertWidgetStateVersion(args.expectedVersion);
    const state = fnNormalizeWidgetStateJson(args.state);

    const admission = this.#admitMutation(identity);
    if (!admission.allowed) {
      this.#metrics.rateLimited += 1;
      return Object.freeze({
        status: 'rate-limited',
        retryAfterMs: admission.retryAfterMs,
      });
    }

    const result = await this.#store.compareAndSwapAuthorizedExactInstance({
      identity,
      expectedVersion: args.expectedVersion,
      state,
      initialSnapshot: this.#initialSnapshot,
    });
    if (result.status === 'unavailable') return this.#unavailable();

    const snapshot = fnCreateWidgetStateSnapshot(identity, result.snapshot);
    if (result.status === 'changed') {
      if (snapshot.version !== args.expectedVersion + 1) {
        throw new Error('Widget state store violated the compare-and-swap version contract.');
      }
      this.#metrics.changes += 1;
      this.#streamForPublish(identity)?.publishChanged(snapshot);
      return Object.freeze({ status: 'changed', snapshot });
    }

    if (snapshot.version === args.expectedVersion) {
      throw new Error('Widget state store reported a conflict without a newer durable version.');
    }
    this.#metrics.conflicts += 1;
    this.#streams.get(this.#streamScope(identity))?.observe(snapshot);
    return Object.freeze({ status: 'conflict', snapshot });
  }

  async subscribe(args: TWidgetStateSubscribeArgs): Promise<TWidgetStateSubscribeResult> {
    this.#assertAvailable();
    const identity = fnNormalizeWidgetStateIdentity(args.identity);
    if (args.afterVersion !== undefined) {
      fnAssertWidgetStateCursor(args.afterVersion);
    }
    const result = await this.#store.getAuthorizedExactInstance({
      identity,
      initialSnapshot: this.#initialSnapshot,
    });
    if (result.status === 'unavailable') return this.#unavailable();
    this.#assertAvailable();

    const snapshot = fnCreateWidgetStateSnapshot(identity, result.snapshot);
    const stream = this.#streamForSubscription(identity);
    if (stream === null) {
      return Object.freeze({ status: 'capacity-unavailable' });
    }
    stream.observe(snapshot);
    this.#metrics.subscriptions += 1;
    return Object.freeze({
      status: 'subscribed',
      events: stream.subscribe(args.afterVersion),
    });
  }

  release(args: TWidgetStateReleaseArgs): void {
    const identity = fnNormalizeWidgetStateIdentity(args.identity);
    const stream = this.#streams.get(this.#streamScope(identity));
    stream?.close();
    this.#streams.delete(this.#streamScope(identity));
    this.#mutationRateLedgers.delete(this.#mutationRateScope(identity));
    this.#metrics.releases += 1;
  }

  stop(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const stream of this.#streams.values()) stream.close();
    this.#streams.clear();
    this.#mutationRateLedgers.clear();
  }

  getMetrics(): TWidgetStateServiceMetrics {
    let activeSubscribers = 0;
    let replayEvents = 0;
    for (const stream of this.#streams.values()) {
      activeSubscribers += stream.subscriberCount;
      replayEvents += stream.replayEventCount;
    }
    return Object.freeze({
      disposed: this.#disposed,
      activeStreams: this.#streams.size,
      activeSubscribers,
      replayEvents,
      mutationRateLedgers: this.#mutationRateLedgers.size,
      ...this.#metrics,
    });
  }

  #assertAvailable(): void {
    if (this.#disposed) throw new Error('WidgetStateService is disposed.');
  }

  #readClock(): number {
    const now = this.#now();
    if (!Number.isFinite(now)) {
      throw new TypeError('Widget state service clock must return a finite number.');
    }
    return now;
  }

  #admitMutation(
    identity: TWidgetStateInstanceIdentity,
  ): TWidgetStateMutationAdmission {
    const scope = this.#mutationRateScope(identity);
    const now = this.#readClock();
    let ledger = this.#mutationRateLedgers.get(scope);
    if (ledger === undefined && this.#mutationRateLedgers.size >= this.#maxMutationRateLedgers) {
      for (const [candidateScope, candidate] of this.#mutationRateLedgers) {
        const retained = fnPruneWidgetStateMutationRateLedger(
          candidate,
          now,
          this.#mutationRateWindowMs,
        );
        if (retained === null) this.#mutationRateLedgers.delete(candidateScope);
        else if (retained !== candidate) {
          this.#mutationRateLedgers.set(candidateScope, {
            lastSeenAt: retained.lastSeenAt,
            timestamps: [...retained.timestamps],
          });
        }
      }
      ledger = this.#mutationRateLedgers.get(scope);
    }
    if (ledger === undefined && this.#mutationRateLedgers.size >= this.#maxMutationRateLedgers) {
      return Object.freeze({
        allowed: false,
        retryAfterMs: fnWidgetStateMutationCapacityRetryAfter(
          [...this.#mutationRateLedgers.entries()],
          now,
          this.#mutationRateWindowMs,
        ),
      });
    }
    const transition = fnTransitionWidgetStateMutationLedger({
      ledger,
      now,
      limit: this.#mutationRateLimit,
      windowMs: this.#mutationRateWindowMs,
    });
    const next = ledger ?? { lastSeenAt: transition.lastSeenAt, timestamps: [] };
    if (transition.firstRetained > 0) {
      next.timestamps.splice(0, transition.firstRetained);
    }
    next.lastSeenAt = transition.lastSeenAt;
    if (transition.appendTimestamp !== undefined) {
      next.timestamps.push(transition.appendTimestamp);
    }
    this.#mutationRateLedgers.set(scope, next);
    return transition.admission;
  }

  #unavailable(): TWidgetStateGetResult & TWidgetStateChangeResult {
    this.#metrics.unavailable += 1;
    return Object.freeze({ status: 'unavailable' });
  }

  #streamForPublish(
    identity: TWidgetStateInstanceIdentity,
  ): WidgetStateVersionStream | null {
    const scope = this.#streamScope(identity);
    const existing = this.#streams.get(scope);
    if (existing !== undefined) {
      this.#touchStream(scope, existing);
      return existing;
    }
    this.#evictInactiveStreamIfNeeded();
    if (this.#streams.size >= this.#maxActiveStreams) return null;
    const stream = this.#createStream();
    this.#streams.set(scope, stream);
    return stream;
  }

  #streamForSubscription(
    identity: TWidgetStateInstanceIdentity,
  ): WidgetStateVersionStream | null {
    return this.#streamForPublish(identity);
  }

  #createStream(): WidgetStateVersionStream {
    return new WidgetStateVersionStream(
      this.#replayCapacity,
      this.#subscriberQueueCapacity,
    );
  }

  #touchStream(scope: string, stream: WidgetStateVersionStream): void {
    this.#streams.delete(scope);
    this.#streams.set(scope, stream);
  }

  #evictInactiveStreamIfNeeded(): void {
    if (this.#streams.size < this.#maxActiveStreams) return;
    for (const [scope, stream] of this.#streams) {
      if (stream.subscriberCount > 0) continue;
      stream.close();
      this.#streams.delete(scope);
      return;
    }
  }

  #streamScope(identity: TWidgetStateInstanceIdentity): string {
    return JSON.stringify([
      identity.canvasId,
      identity.elementId,
      identity.widgetInstanceId,
    ]);
  }

  #mutationRateScope(identity: TWidgetStateInstanceIdentity): string {
    return JSON.stringify([
      identity.widgetInstanceId,
    ]);
  }
}
