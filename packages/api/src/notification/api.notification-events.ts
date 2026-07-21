import { baseNotificationOs } from './orpc';
import { fxNotificationEvents } from './fx.notification-events';

const apiNotificationEvents = baseNotificationOs.events.handler(async function* ({ context }) {
  yield* fxNotificationEvents(context.eventPublisher, {});
});

export { apiNotificationEvents };
