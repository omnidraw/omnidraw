/**
 * @file Event publication capability consumed by services and transport adapters.
 */

import type { IService } from '@omnidraw/runtime';
import type {
  TAgentEvent,
  TDbEvent,
  TNotificationEvent,
} from './events';

export type {
  TAgentApprovalEvent,
  TAgentChatEvent,
  TAgentEvent,
  TAgentWidgetCatalogEvent,
  TAgentWidgetDraftEvent,
  TAgentWidgetPreviewEvent,
  TAgentWidgetPublishedEvent,
  TAgentWidgetUpdateEvent,
  TDbEvent,
  TEventJson,
  TNotificationEvent,
} from './events';

export interface IEventPublisherService extends IService {
  publishDbEvent(canvasId: string, event: TDbEvent): number;
  subscribeDbEvents(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TDbEvent>;
  subscribeDbEventRecords(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TDbEvent>>;
  getDbEventCursor(): number;

  publishAgentEvent(event: TAgentEvent): number;
  subscribeAgentEvents(options?: TEventSubscriptionOptions): AsyncIterable<TAgentEvent>;
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
