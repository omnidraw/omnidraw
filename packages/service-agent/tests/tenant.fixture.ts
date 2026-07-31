import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@omnidraw/service-db/CONSTANTS';
import { EventPublisherService } from '@omnidraw/service-event-publisher/EventPublisherService';
import type {
  ITenantEventPublisherService,
  TAgentEvent,
  TDbEvent,
  TEventSubscriptionOptions,
  TNotificationEvent,
  TSequencedEvent,
} from '@omnidraw/service-event-publisher/IEventPublisherService';

export const TEST_TENANT = Object.freeze({
  orgId: DEFAULT_OSS_ORGANIZATION_ID,
  accountId: DEFAULT_OSS_ACCOUNT_ID,
  cellId: 'service-agent-test-cell',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['*']),
  requestId: 'service-agent-test-request',
}) satisfies Parameters<EventPublisherService['forTenant']>[0];

export class TestTenantEventPublisher implements ITenantEventPublisherService {
  private readonly delegate = new EventPublisherService().forTenant(TEST_TENANT);

  publishDbEvent(canvasId: string, event: TDbEvent): number {
    return this.delegate.publishDbEvent(canvasId, event);
  }

  subscribeDbEvents(canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TDbEvent> {
    return this.delegate.subscribeDbEvents(canvasId, options);
  }

  subscribeDbEventRecords(
    canvasId: string,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TDbEvent>> {
    return this.delegate.subscribeDbEventRecords(canvasId, options);
  }

  getDbEventCursor(): number {
    return this.delegate.getDbEventCursor();
  }

  publishAgentEvent(event: TAgentEvent): number {
    return this.delegate.publishAgentEvent(event);
  }

  subscribeAgentEvents(options?: TEventSubscriptionOptions): AsyncIterable<TAgentEvent> {
    return this.delegate.subscribeAgentEvents(options);
  }

  getAgentEventCursor(): number {
    return this.delegate.getAgentEventCursor();
  }

  publishNotification(event: TNotificationEvent): number {
    return this.delegate.publishNotification(event);
  }

  subscribeNotifications(options?: TEventSubscriptionOptions): AsyncIterable<TNotificationEvent> {
    return this.delegate.subscribeNotifications(options);
  }

  subscribeNotificationRecords(
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TNotificationEvent>> {
    return this.delegate.subscribeNotificationRecords(options);
  }

  getNotificationEventCursor(): number {
    return this.delegate.getNotificationEventCursor();
  }

  getLatestNotification(): TNotificationEvent | null {
    return this.delegate.getLatestNotification();
  }
}

export function createTestTenantEvents(): ITenantEventPublisherService {
  return new TestTenantEventPublisher();
}
