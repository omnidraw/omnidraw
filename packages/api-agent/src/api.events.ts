import { baseAgentOs } from './orpc';

const apiAgentEvents = baseAgentOs.events.handler(async function* ({ context }) {
  for await (const event of context.eventPublisher.subscribeAgentEvents()) {
    yield event;
  }
});

export { apiAgentEvents };
