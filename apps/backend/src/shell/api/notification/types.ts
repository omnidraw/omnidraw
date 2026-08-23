import type { TEventSubscriptionOptions, TSequencedEvent } from '#backend/shell/events/types';
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
