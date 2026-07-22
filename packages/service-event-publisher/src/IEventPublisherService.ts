/**
 * @file Event publication capability consumed by services and transport adapters.
 */

import type { IService } from '@vibecanvas/runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TActorEvent,
  TAgentEvent,
  TDbEvent,
  TNotificationEvent,
} from './events';

export type {
  TActorEvent,
  TActorStatus,
  TAgentApprovalEvent,
  TAgentChatEvent,
  TAgentDraftActorEvent,
  TAgentDraftActorRuntimeEvent,
  TAgentDraftActorSnapshot,
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
  forTenant(tenant: TTenantContext): ITenantEventPublisherService;

  publishDbEvent(tenant: TTenantContext, canvasId: string, event: TDbEvent): number;
  subscribeDbEvents(tenant: TTenantContext, canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TDbEvent>;
  subscribeDbEventRecords(tenant: TTenantContext, canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TDbEvent>>;
  getDbEventCursor(tenant: TTenantContext): number;

  publishActorEvent(tenant: TTenantContext, event: TActorEvent): number;
  subscribeActorEvents(tenant: TTenantContext, options?: TEventSubscriptionOptions): AsyncIterable<TActorEvent>;
  getActorEventCursor(tenant: TTenantContext): number;

  publishAgentEvent(tenant: TTenantContext, event: TAgentEvent): number;
  subscribeAgentEvents(tenant: TTenantContext, options?: TEventSubscriptionOptions): AsyncIterable<TAgentEvent>;
  getAgentEventCursor(tenant: TTenantContext): number;

  publishNotification(tenant: TTenantContext, event: TNotificationEvent): number;
  subscribeNotifications(tenant: TTenantContext, options?: TEventSubscriptionOptions): AsyncIterable<TNotificationEvent>;
  subscribeNotificationRecords(tenant: TTenantContext, options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TNotificationEvent>>;
  getNotificationEventCursor(tenant: TTenantContext): number;
  getLatestNotification(tenant: TTenantContext): TNotificationEvent | null;
}

export type TEventSubscriptionOptions = Readonly<{ afterSequence?: number }>;

export type TSequencedEvent<TEvent> = Readonly<{
  event: TEvent;
  sequence: number;
}>;

export interface ITenantEventPublisherService {
  publishDbEvent(canvasId: string, event: TDbEvent): number;
  subscribeDbEvents(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TDbEvent>;
  subscribeDbEventRecords(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TDbEvent>>;
  getDbEventCursor(): number;
  publishActorEvent(event: TActorEvent): number;
  subscribeActorEvents(options?: TEventSubscriptionOptions): AsyncIterable<TActorEvent>;
  getActorEventCursor(): number;
  publishAgentEvent(event: TAgentEvent): number;
  subscribeAgentEvents(options?: TEventSubscriptionOptions): AsyncIterable<TAgentEvent>;
  getAgentEventCursor(): number;
  publishNotification(event: TNotificationEvent): number;
  subscribeNotifications(options?: TEventSubscriptionOptions): AsyncIterable<TNotificationEvent>;
  subscribeNotificationRecords(options?: TEventSubscriptionOptions): AsyncIterable<TSequencedEvent<TNotificationEvent>>;
  getNotificationEventCursor(): number;
  getLatestNotification(): TNotificationEvent | null;
}
