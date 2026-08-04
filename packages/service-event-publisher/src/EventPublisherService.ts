import type {
  IEventPublisherService,
  TAgentEvent,
  TDbEvent,
  TEventSubscriptionOptions,
  TNotificationEvent,
  TSequencedEvent,
} from './IEventPublisherService';
import { EventBus } from './EventBus';

export class EventPublisherService implements IEventPublisherService {
  readonly name = 'eventPublisher';

  readonly #db = new EventBus<TDbEvent>();
  readonly #agent = new EventBus<TAgentEvent>();
  readonly #notification = new EventBus<TNotificationEvent>();
  #latestNotification: TNotificationEvent | null = null;

  publishDbEvent(canvasId: string, event: TDbEvent): number {
    return this.#db.publish(canvasId, event);
  }

  subscribeDbEvents(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TDbEvent> {
    return this.#db.subscribe(canvasId, options);
  }

  subscribeDbEventRecords(
    canvasId: string,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TDbEvent>> {
    return this.#db.subscribeRecords(canvasId, options);
  }

  getDbEventCursor(): number {
    return this.#db.cursor();
  }

  publishAgentEvent(event: TAgentEvent): number {
    return this.#agent.publish('global', event);
  }

  subscribeAgentEvents(options?: TEventSubscriptionOptions): AsyncIterable<TAgentEvent> {
    return this.#agent.subscribe('global', options);
  }

  getAgentEventCursor(): number {
    return this.#agent.cursor();
  }

  publishNotification(event: TNotificationEvent): number {
    this.#latestNotification = event;
    return this.#notification.publish('global', event);
  }

  subscribeNotifications(options?: TEventSubscriptionOptions): AsyncIterable<TNotificationEvent> {
    return this.#notification.subscribe('global', options);
  }

  subscribeNotificationRecords(
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TNotificationEvent>> {
    const afterSequence = options?.afterSequence ?? Math.max(0, this.#notification.cursor() - 1);
    return this.#notification.subscribeRecords('global', { afterSequence });
  }

  getNotificationEventCursor(): number {
    return this.#notification.cursor();
  }

  getLatestNotification(): TNotificationEvent | null {
    return this.#latestNotification;
  }

}
