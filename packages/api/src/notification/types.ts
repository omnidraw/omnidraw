import type { TEventSubscriptionOptions, TSequencedEvent } from '@omnidraw/service-event-publisher/IEventPublisherService';
import type { TNotificationEvent } from './contract';

type TNotificationEventCapability = {
  subscribeNotificationRecords(
    options?: TEventSubscriptionOptions,
  ): AsyncIterable<TSequencedEvent<TNotificationEvent>>;
};

type TNotificationApiContext = {
  eventPublisher: TNotificationEventCapability;
};

export type { TNotificationApiContext, TNotificationEventCapability };
