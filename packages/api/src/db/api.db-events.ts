import { baseDbOs } from './orpc';

const apiDbEvents = baseDbOs.events.handler(async function* ({ input, context }) {
  for await (const event of context.eventPublisher.subscribeDbEvents(input.canvasId)) {
    yield event;
  }
});

export { apiDbEvents };
