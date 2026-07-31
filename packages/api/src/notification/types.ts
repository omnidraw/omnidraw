import type { TEventSubscriptionOptions, TSequencedEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
import type { TTenantContext } from '@omnidraw/tenant-core';
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
