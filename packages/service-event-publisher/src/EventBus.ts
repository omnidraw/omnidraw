import type { TSequencedEvent } from './IEventPublisherService';

type TEventRecord<TEvent> = Readonly<{
  event: TEvent;
  sequence: number;
  topic: string;
}>;

type TSubscriber<TEvent> = {
  closed: boolean;
  pending: ((result: IteratorResult<TEventRecord<TEvent>>) => void) | null;
  queue: TEventRecord<TEvent>[];
};

type TSubscribeArgs = Readonly<{
  afterSequence?: number;
}>;

class EventBus<TEvent> {
  readonly #maxReplayEvents: number;
  readonly #records: TEventRecord<TEvent>[] = [];
  readonly #subscribers = new Map<string, Set<TSubscriber<TEvent>>>();
  #sequence = 0;

  constructor(maxReplayEvents = 256) {
    this.#maxReplayEvents = Math.max(1, maxReplayEvents);
  }

  cursor(): number {
    return this.#sequence;
  }

  publish(topic: string, event: TEvent): number {
    const sequence = this.#sequence + 1;
    this.#sequence = sequence;

    const record = { event, sequence, topic };
    this.#records.push(record);
    if (this.#records.length > this.#maxReplayEvents) {
      this.#records.splice(0, this.#records.length - this.#maxReplayEvents);
    }

    this.#push(topic, record);
    if (topic !== '*') this.#push('*', record);
    return sequence;
  }

  subscribe(topic: string, args: TSubscribeArgs = {}): AsyncIterable<TEvent> {
    const records = this.subscribeRecords(topic, args);
    return {
      [Symbol.asyncIterator](): AsyncIterator<TEvent> {
        const iterator = records[Symbol.asyncIterator]();
        return {
          next: async () => {
            const result = await iterator.next();
            if (result.done) return { done: true, value: undefined };
            return { done: false, value: result.value.event };
          },
          return: async () => {
            await iterator.return?.();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  subscribeRecords(topic: string, args: TSubscribeArgs = {}): AsyncIterable<TSequencedEvent<TEvent>> {
    const afterSequence = args.afterSequence ?? this.cursor();
    const subscriber: TSubscriber<TEvent> = {
      closed: false,
      pending: null,
      queue: this.#records
        .filter((record) => record.sequence > afterSequence && (topic === '*' || record.topic === topic)),
    };
    const subscriberKey = topic;
    const subscribers = this.#subscribers.get(subscriberKey) ?? new Set<TSubscriber<TEvent>>();
    subscribers.add(subscriber);
    this.#subscribers.set(subscriberKey, subscribers);

    const close = () => {
      if (subscriber.closed) return;
      subscriber.closed = true;
      subscriber.pending?.({ done: true, value: undefined });
      subscriber.pending = null;
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.#subscribers.delete(subscriberKey);
    };

    return {
      [Symbol.asyncIterator](): AsyncIterator<TSequencedEvent<TEvent>> {
        return {
          next: async () => {
            const queued = subscriber.queue.shift();
            if (queued !== undefined) {
              return { done: false, value: { event: queued.event, sequence: queued.sequence } };
            }
            if (subscriber.closed) return { done: true, value: undefined };
            const result = await new Promise<IteratorResult<TEventRecord<TEvent>>>((resolve) => {
              subscriber.pending = resolve;
            });
            if (result.done) return { done: true, value: undefined };
            return { done: false, value: { event: result.value.event, sequence: result.value.sequence } };
          },
          return: async () => {
            close();
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  #push(topic: string, record: TEventRecord<TEvent>): void {
    const subscriberKey = topic;
    for (const subscriber of this.#subscribers.get(subscriberKey) ?? []) {
      if (subscriber.closed) continue;
      if (subscriber.pending) {
        const pending = subscriber.pending;
        subscriber.pending = null;
        pending({ done: false, value: record });
      } else {
        subscriber.queue.push(record);
      }
    }
  }
}

export { EventBus };
export type { TSubscribeArgs };
