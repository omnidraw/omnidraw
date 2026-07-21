import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import type {
  ITenantEventPublisherService,
  TActorEvent,
  TAgentEvent,
  TDbEvent,
  TEventSubscriptionOptions,
  TFilesystemEvent,
  TNotificationEvent,
  TSequencedEvent,
} from '@vibecanvas/service-event-publisher/IEventPublisherService';

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

  publishActorEvent(event: TActorEvent): number {
    return this.delegate.publishActorEvent(event);
  }

  subscribeActorEvents(options?: TEventSubscriptionOptions): AsyncIterable<TActorEvent> {
    return this.delegate.subscribeActorEvents(options);
  }

  getActorEventCursor(): number {
    return this.delegate.getActorEventCursor();
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

  publishFilesystemEvent(filesystemId: string, path: string, event: TFilesystemEvent): number {
    return this.delegate.publishFilesystemEvent(filesystemId, path, event);
  }

  subscribeFilesystemEvents(
    filesystemId: string,
    path: string,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TFilesystemEvent> {
    return this.delegate.subscribeFilesystemEvents(filesystemId, path, options);
  }

  getFilesystemEventCursor(filesystemId: string): number {
    return this.delegate.getFilesystemEventCursor(filesystemId);
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
