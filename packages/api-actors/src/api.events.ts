import { baseActorsOs } from './orpc';

const apiNotificationEvents = baseActorsOs.definitions.events.handler(async function* ({ context }) {

  for await (const event of context.eventPublisher.subscribeActorEvents()) {
    yield event;
  }
});

export { apiNotificationEvents };
