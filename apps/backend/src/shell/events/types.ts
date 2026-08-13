import type { TAgentEvent, TDbEvent, TNotificationEvent } from '../../core/events/events';

export interface IEventPublisherService {
  readonly name: string;
  publishDbEvent(canvasId: string, event: TDbEvent): number;
  subscribeDbEvents(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TDbEvent>;
  subscribeDbEventRecords(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TDbEvent>>;
  getDbEventCursor(): number;
  publishAgentEvent(event: TAgentEvent): number;
  subscribeAgentEvents(options?: TEventSubscriptionOptions): AsyncIterable<TAgentEvent>;
  subscribeAgentEventRecords(options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TAgentEvent>>;
  getAgentEventCursor(): number;
  publishNotification(event: TNotificationEvent): number;
  subscribeNotifications(options?: TEventSubscriptionOptions): AsyncIterable<TNotificationEvent>;
  subscribeNotificationRecords(options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TNotificationEvent>>;
  getNotificationEventCursor(): number;
  getLatestNotification(): TNotificationEvent | null;
}

export type TEventSubscriptionOptions = Readonly<{ afterSequence?: number }>;

export type TSequencedEvent<TEvent> = Readonly<{
  event: TEvent;
  sequence: number;
}>;

export type {
  TAgentApprovalEvent,
  TAgentChatEvent,
  TAgentEvent,
  TAgentWidgetCatalogEvent,
  TAgentWidgetUpdateEvent,
  TDbEvent,
  TEventJson,
  TNotificationEvent,
} from '../../core/events/events';
