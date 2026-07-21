import type { TEventSubscriptionOptions, TSequencedEvent } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TNotificationEvent } from './contract';

type TNotificationEventCapability = {
  subscribeNotificationRecords(
    tenant: TTenantContext,
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TNotificationEvent>>;
};

type TNotificationApiContext = {
  eventPublisher: TNotificationEventCapability;
  tenant: TTenantContext;
};

export type { TNotificationApiContext, TNotificationEventCapability };
