import { fnWidgetStateSnapshotsMatch } from '#backend/core/widget-state/fn.widget-state-values';
import type {
  TWidgetStateSnapshot,
  TWidgetStateSubscriptionEvent,
} from '#backend/core/widget-state/types';

type TSubscriber = {
  closed: boolean;
  coalescing: boolean;
  pending: Array<
    (result: IteratorResult<TWidgetStateSubscriptionEvent>) => void
  >;
  queue: TWidgetStateSubscriptionEvent[];
};

class WidgetStateVersionStream {
  readonly #replayCapacity: number;
  readonly #subscriberQueueCapacity: number;
  readonly #records: TWidgetStateSubscriptionEvent[] = [];
  readonly #subscribers = new Set<TSubscriber>();
  #latest: TWidgetStateSnapshot | null = null;
  #closed = false;

  constructor(replayCapacity: number, subscriberQueueCapacity: number) {
    this.#replayCapacity = replayCapacity;
    this.#subscriberQueueCapacity = subscriberQueueCapacity;
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  get replayEventCount(): number {
    return this.#records.length;
  }

  observe(snapshot: TWidgetStateSnapshot): void {
    if (this.#closed) return;
    if (this.#latest === null) {
      this.#latest = snapshot;
      return;
    }
    if (snapshot.version < this.#latest.version) return;
    if (snapshot.version === this.#latest.version) {
      if (!fnWidgetStateSnapshotsMatch(snapshot, this.#latest)) {
        throw new Error('Widget state store returned different state for one durable version.');
      }
      return;
    }
    this.#latest = snapshot;
    this.#records.splice(0);
    this.#pushToAll(Object.freeze({
      type: 'snapshot',
      reason: 'resync',
      snapshot,
    }));
  }

  publishChanged(snapshot: TWidgetStateSnapshot): void {
    if (this.#closed) return;
    if (this.#latest !== null) {
      if (snapshot.version < this.#latest.version) return;
      if (snapshot.version === this.#latest.version) {
        if (!fnWidgetStateSnapshotsMatch(snapshot, this.#latest)) {
          throw new Error('Widget state store returned different state for one durable version.');
        }
        return;
      }
    }

    const isContiguous = this.#latest === null
      || snapshot.version === this.#latest.version + 1;
    this.#latest = snapshot;
    if (!isContiguous) {
      this.#records.splice(0);
      this.#pushToAll(Object.freeze({
        type: 'snapshot',
        reason: 'resync',
        snapshot,
      }));
      return;
    }

    const event = Object.freeze({
      type: 'changed',
      snapshot,
    }) satisfies TWidgetStateSubscriptionEvent;
    this.#records.push(event);
    if (this.#records.length > this.#replayCapacity) {
      this.#records.splice(0, this.#records.length - this.#replayCapacity);
    }
    this.#pushToAll(event);
  }

  subscribe(afterVersion: number | undefined): AsyncIterable<TWidgetStateSubscriptionEvent> {
    if (this.#closed || this.#latest === null) {
      throw new Error('Widget state stream is unavailable.');
    }
    const subscriber: TSubscriber = {
      closed: false,
      coalescing: false,
      pending: [],
      queue: this.#initialEvents(afterVersion),
    };
    this.#subscribers.add(subscriber);

    const close = (): void => {
      if (subscriber.closed) return;
      subscriber.closed = true;
      subscriber.queue.splice(0);
      for (const resolve of subscriber.pending.splice(0)) {
        resolve({ done: true, value: undefined });
      }
      this.#subscribers.delete(subscriber);
    };

    return {
      [Symbol.asyncIterator]: (): AsyncIterableIterator<TWidgetStateSubscriptionEvent> => ({
        next: async (): Promise<IteratorResult<TWidgetStateSubscriptionEvent>> => {
          const queued = subscriber.queue.shift();
          if (queued !== undefined) {
            if (subscriber.queue.length === 0) subscriber.coalescing = false;
            return { done: false, value: queued };
          }
          if (subscriber.closed) return { done: true, value: undefined };
          if (subscriber.pending.length >= this.#subscriberQueueCapacity) {
            throw new Error('Widget state subscription has too many pending reads.');
          }
          return await new Promise<IteratorResult<TWidgetStateSubscriptionEvent>>((resolve) => {
            subscriber.pending.push(resolve);
          });
        },
        return: async (): Promise<IteratorResult<TWidgetStateSubscriptionEvent>> => {
          close();
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator](): AsyncIterableIterator<TWidgetStateSubscriptionEvent> {
          return this;
        },
      }),
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#records.splice(0);
    this.#latest = null;
    for (const subscriber of [...this.#subscribers]) {
      subscriber.closed = true;
      subscriber.queue.splice(0);
      for (const resolve of subscriber.pending.splice(0)) {
        resolve({ done: true, value: undefined });
      }
      this.#subscribers.delete(subscriber);
    }
  }

  #initialEvents(
    afterVersion: number | undefined,
  ): TWidgetStateSubscriptionEvent[] {
    const latest = this.#latest!;
    if (afterVersion === undefined) {
      return [Object.freeze({
        type: 'snapshot',
        reason: 'initial',
        snapshot: latest,
      })];
    }
    if (afterVersion === latest.version) return [];
    if (afterVersion < latest.version) {
      const replay = this.#records.filter(
        (event) => event.type === 'changed'
          && event.snapshot.version > afterVersion,
      );
      if (
        replay.length > 0
        && replay.length <= this.#subscriberQueueCapacity
        && replay[0]!.snapshot.version === afterVersion + 1
        && replay[replay.length - 1]!.snapshot.version === latest.version
        && replay.every((event, index) => (
          index === 0
          || event.snapshot.version === replay[index - 1]!.snapshot.version + 1
        ))
      ) {
        return [...replay];
      }
    }
    return [Object.freeze({
      type: 'snapshot',
      reason: 'resync',
      snapshot: latest,
    })];
  }

  #pushToAll(event: TWidgetStateSubscriptionEvent): void {
    for (const subscriber of this.#subscribers) this.#push(subscriber, event);
  }

  #push(subscriber: TSubscriber, event: TWidgetStateSubscriptionEvent): void {
    if (subscriber.closed) return;
    const pending = subscriber.pending.shift();
    if (pending !== undefined) {
      pending({ done: false, value: event });
      return;
    }
    if (subscriber.coalescing) {
      subscriber.queue.splice(0, subscriber.queue.length, Object.freeze({
        type: 'snapshot',
        reason: 'resync',
        snapshot: event.snapshot,
      }));
      return;
    }
    if (subscriber.queue.length >= this.#subscriberQueueCapacity) {
      subscriber.coalescing = true;
      subscriber.queue.splice(0, subscriber.queue.length, Object.freeze({
        type: 'snapshot',
        reason: 'resync',
        snapshot: event.snapshot,
      }));
      return;
    }
    subscriber.queue.push(event);
  }
}

export { WidgetStateVersionStream };
