import type { TNotificationEvent } from './contract';

type TNotificationEventCapability = {
  getLatestNotification(): TNotificationEvent | null;
  subscribeNotifications(): AsyncIterable<TNotificationEvent>;
};

type TNotificationApiContext = {
  eventPublisher: TNotificationEventCapability;
};

export type { TNotificationApiContext, TNotificationEventCapability };
