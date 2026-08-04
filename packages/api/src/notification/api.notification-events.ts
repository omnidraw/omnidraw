import { baseNotificationOs } from './orpc';
import { fxNotificationEvents } from './fx.notification-events';

const apiNotificationEvents = baseNotificationOs.events.handler(async function* ({ context, input }) {
  yield* fxNotificationEvents(context.eventPublisher, {
    afterSequence: input.afterSequence,
  });
});

export { apiNotificationEvents };
