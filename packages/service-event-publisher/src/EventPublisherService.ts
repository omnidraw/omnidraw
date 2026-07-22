import { fnScopedKey } from '@vibecanvas/tenant-core';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IEventPublisherService,
  ITenantEventPublisherService,
  TActorEvent,
  TAgentEvent,
  TDbEvent,
  TEventSubscriptionOptions,
  TFilesystemEvent,
  TNotificationEvent,
  TSequencedEvent,
} from './IEventPublisherService';
import { EventBus } from './EventBus';

export class EventPublisherService implements IEventPublisherService {
  readonly name = 'eventPublisher';

  readonly #db = new EventBus<TDbEvent>();
  readonly #actor = new EventBus<TActorEvent>();
  readonly #agent = new EventBus<TAgentEvent>();
  readonly #filesystem = new EventBus<TFilesystemEvent>();
  readonly #notification = new EventBus<TNotificationEvent>();
  readonly #latestNotification = new Map<string, TNotificationEvent>();

  forTenant(tenant: TTenantContext): ITenantEventPublisherService {
    return Object.freeze({
      publishDbEvent: (canvasId: string, event: TDbEvent) => this.publishDbEvent(tenant, canvasId, event),
      subscribeDbEvents: (canvasId: string, options?: TEventSubscriptionOptions) => this.subscribeDbEvents(tenant, canvasId, options),
      subscribeDbEventRecords: (canvasId: string, options?: TEventSubscriptionOptions) => (
        this.subscribeDbEventRecords(tenant, canvasId, options)
      ),
      getDbEventCursor: () => this.getDbEventCursor(tenant),
      publishActorEvent: (event: TActorEvent) => this.publishActorEvent(tenant, event),
      subscribeActorEvents: (options?: TEventSubscriptionOptions) => this.subscribeActorEvents(tenant, options),
      getActorEventCursor: () => this.getActorEventCursor(tenant),
      publishAgentEvent: (event: TAgentEvent) => this.publishAgentEvent(tenant, event),
      subscribeAgentEvents: (options?: TEventSubscriptionOptions) => this.subscribeAgentEvents(tenant, options),
      getAgentEventCursor: () => this.getAgentEventCursor(tenant),
      publishFilesystemEvent: (filesystemId: string, path: string, event: TFilesystemEvent) => (
        this.publishFilesystemEvent(tenant, filesystemId, path, event)
      ),
      subscribeFilesystemEvents: (filesystemId: string, path: string, options?: TEventSubscriptionOptions) => (
        this.subscribeFilesystemEvents(tenant, filesystemId, path, options)
      ),
      getFilesystemEventCursor: (filesystemId: string) => this.getFilesystemEventCursor(tenant, filesystemId),
      publishNotification: (event: TNotificationEvent) => this.publishNotification(tenant, event),
      subscribeNotifications: (options?: TEventSubscriptionOptions) => this.subscribeNotifications(tenant, options),
      subscribeNotificationRecords: (options?: TEventSubscriptionOptions) => (
        this.subscribeNotificationRecords(tenant, options)
      ),
      getNotificationEventCursor: () => this.getNotificationEventCursor(tenant),
      getLatestNotification: () => this.getLatestNotification(tenant),
    });
  }

  publishDbEvent(tenant: TTenantContext, canvasId: string, event: TDbEvent): number {
    return this.#db.publish(this.#orgScope(tenant, 'db'), canvasId, event);
  }

  subscribeDbEvents(tenant: TTenantContext, canvasId: string, options?: TEventSubscriptionOptions): AsyncIterable<TDbEvent> {
    return this.#db.subscribe(this.#orgScope(tenant, 'db'), canvasId, options);
  }

  subscribeDbEventRecords(
    tenant: TTenantContext,
    canvasId: string,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TDbEvent>> {
    return this.#db.subscribeRecords(this.#orgScope(tenant, 'db'), canvasId, options);
  }

  getDbEventCursor(tenant: TTenantContext): number {
    return this.#db.cursor(this.#orgScope(tenant, 'db'));
  }

  publishActorEvent(tenant: TTenantContext, event: TActorEvent): number {
    return this.#actor.publish(this.#accountScope(tenant, 'actor'), 'global', event);
  }

  subscribeActorEvents(tenant: TTenantContext, options?: TEventSubscriptionOptions): AsyncIterable<TActorEvent> {
    return this.#actor.subscribe(this.#accountScope(tenant, 'actor'), 'global', options);
  }

  getActorEventCursor(tenant: TTenantContext): number {
    return this.#actor.cursor(this.#accountScope(tenant, 'actor'));
  }

  publishAgentEvent(tenant: TTenantContext, event: TAgentEvent): number {
    return this.#agent.publish(this.#accountScope(tenant, 'agent'), 'global', event);
  }

  subscribeAgentEvents(tenant: TTenantContext, options?: TEventSubscriptionOptions): AsyncIterable<TAgentEvent> {
    return this.#agent.subscribe(this.#accountScope(tenant, 'agent'), 'global', options);
  }

  getAgentEventCursor(tenant: TTenantContext): number {
    return this.#agent.cursor(this.#accountScope(tenant, 'agent'));
  }

  publishFilesystemEvent(tenant: TTenantContext, filesystemId: string, path: string, event: TFilesystemEvent): number {
    return this.#filesystem.publish(this.#filesystemScope(tenant, filesystemId), path, event);
  }

  subscribeFilesystemEvents(tenant: TTenantContext, filesystemId: string, path: string, options?: TEventSubscriptionOptions): AsyncIterable<TFilesystemEvent> {
    return this.#filesystem.subscribe(this.#filesystemScope(tenant, filesystemId), path, options);
  }

  getFilesystemEventCursor(tenant: TTenantContext, filesystemId: string): number {
    return this.#filesystem.cursor(this.#filesystemScope(tenant, filesystemId));
  }

  publishNotification(tenant: TTenantContext, event: TNotificationEvent): number {
    const scope = this.#accountScope(tenant, 'notification');
    this.#latestNotification.set(scope, event);
    return this.#notification.publish(scope, 'global', event);
  }

  subscribeNotifications(tenant: TTenantContext, options?: TEventSubscriptionOptions): AsyncIterable<TNotificationEvent> {
    return this.#notification.subscribe(this.#accountScope(tenant, 'notification'), 'global', options);
  }

  subscribeNotificationRecords(
    tenant: TTenantContext,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TNotificationEvent>> {
    const scope = this.#accountScope(tenant, 'notification');
    const afterSequence = options?.afterSequence ?? Math.max(0, this.#notification.cursor(scope) - 1);
    return this.#notification.subscribeRecords(scope, 'global', { afterSequence });
  }

  getNotificationEventCursor(tenant: TTenantContext): number {
    return this.#notification.cursor(this.#accountScope(tenant, 'notification'));
  }

  getLatestNotification(tenant: TTenantContext): TNotificationEvent | null {
    return this.#latestNotification.get(this.#accountScope(tenant, 'notification')) ?? null;
  }

  #orgScope(tenant: TTenantContext, namespace: string): string {
    return fnScopedKey(namespace, [tenant.orgId]);
  }

  #accountScope(tenant: TTenantContext, namespace: string): string {
    return fnScopedKey(namespace, [tenant.orgId, tenant.accountId]);
  }

  #filesystemScope(tenant: TTenantContext, filesystemId: string): string {
    return fnScopedKey('filesystem', [tenant.orgId, filesystemId]);
  }
}
