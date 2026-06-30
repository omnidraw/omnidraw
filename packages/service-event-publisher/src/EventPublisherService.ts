import { EventPublisher } from '@orpc/server';
import type { IEventPublisherService, TActorEvent, TDbEvent, TFilesystemEvent, TNotificationEvent } from './IEventPublisherService';

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

  publishActorEvent(event: TActorEvent): void {
    this.#actor.publish('global', event);
  }

  subscribeActorEvents(): AsyncIterable<TActorEvent> {
    return this.#actor.subscribe('global')
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
