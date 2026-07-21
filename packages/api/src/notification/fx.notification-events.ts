import type { TNotificationEvent } from './contract';

type TPortal = {
  getLatestNotification: () => TNotificationEvent | null;
  subscribeNotifications: () => AsyncIterable<TNotificationEvent>;
};

type TArgs = Record<string, never>;

export async function* fxNotificationEvents(portal: TPortal, args: TArgs): AsyncGenerator<TNotificationEvent> {
  void args;
  const latest = portal.getLatestNotification();
  if (latest) yield latest;

  for await (const event of portal.subscribeNotifications()) {
    yield event;
  }
}
