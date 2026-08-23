import { baseAgentOs } from './procedure-builder';

const apiAgentEvents = baseAgentOs.events.handler(async function* ({ context, input }) {
  for await (const record of context.eventPublisher.subscribeAgentEventRecords({
    afterSequence: input.afterSequence,
  })) {
    yield { ...record.event, sequence: record.sequence };
  }
});

export { apiAgentEvents };
