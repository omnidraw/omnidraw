import { baseNotificationOs } from './procedure-builder';
import { streamNotificationEvents } from './stream-notification-events';

const apiNotificationEvents = baseNotificationOs.events.handler(async function* ({ context, input }) {
  yield* streamNotificationEvents(context.eventPublisher, {
    afterSequence: input.afterSequence,
  });
});

export { apiNotificationEvents };
