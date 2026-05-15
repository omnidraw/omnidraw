import { EventPublisher } from '@orpc/server';
import type { IEventPublisherService, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from './IEventPublisherService';

async function* mergeAsyncIterables<T>(iterables: AsyncIterable<T>[]): AsyncIterable<T> {
  const iterators = iterables.map((iterable) => iterable[Symbol.asyncIterator]());
  const never = new Promise<{ index: number; result: IteratorResult<T> }>(() => {});
  const next = (index: number) => iterators[index]!.next().then((result) => ({ index, result }));
  const pending = iterators.map((_, index) => next(index));

  while (pending.some((promise) => promise !== never)) {
    const { index, result } = await Promise.race(pending);
    if (result.done) {
      pending[index] = never;
      continue;
    }

    pending[index] = next(index);
    yield result.value;
  }
}

export class EventPublisherService implements IEventPublisherService {
  readonly name = 'eventPublisher';

  #db = new EventPublisher<Record<string, TDbEvent>>();
  #actor = new EventPublisher<Record<string, TActorEvent>>();
  #filesystem = new EventPublisher<Record<string, TFilesystemEvent>>();
  #notification = new EventPublisher<Record<string, TNotificationEvent>>();
  #latestNotification: TNotificationEvent | null = null;

  publishDbEvent(canvasId: string, event: TDbEvent): void {
    this.#db.publish(canvasId, event);
  }

  subscribeDbEvents(canvasId: string): AsyncIterable<TDbEvent> {
    return this.#db.subscribe(canvasId);
  }

  publishActorEvent(canvasId: string, event: TActorEvent): void {
    this.#actor.publish(canvasId, event);
  }

  subscribeActorEvents(canvasId: string): AsyncIterable<TActorEvent> {
    return mergeAsyncIterables([
      this.#actor.subscribe(canvasId),
      this.#actor.subscribe('global'),
    ]);
  }

  publishFilesystemEvent(path: string, event: TFilesystemEvent): void {
    this.#filesystem.publish(path, event);
  }

  subscribeFilesystemEvents(path: string): AsyncIterable<TFilesystemEvent> {
    return this.#filesystem.subscribe(path);
  }

  publishNotification(event: TNotificationEvent): void {
    this.#latestNotification = event;
    this.#notification.publish('global', event);
  }

  subscribeNotifications(): AsyncIterable<TNotificationEvent> {
    return this.#notification.subscribe('global');
  }

  getLatestNotification(): TNotificationEvent | null {
    return this.#latestNotification;
  }
}
