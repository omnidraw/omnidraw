import { baseActorsOs } from './orpc';

const apiNotificationEvents = baseActorsOs.events.handler(async function* ({ context }) {

  for await (const event of context.eventPublisher.subscribeActorEvents()) {
    yield event;
  }
});

export { apiNotificationEvents };
