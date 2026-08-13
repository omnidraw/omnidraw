import { baseDbOs } from './procedure-builder';
import { streamDbEvents } from './stream-db-events';

const apiDbEvents = baseDbOs.events.handler(async function* ({ input, context }) {
  yield* streamDbEvents({
    findCanvasById: (args) => context.db.canvas.findById(args),
    subscribeDbEventRecords: (canvasId, options) => (
      context.eventPublisher.subscribeDbEventRecords(canvasId, options)
    ),
  }, {
    afterSequence: input.afterSequence,
    canvasId: input.canvasId,
  });
});

export { apiDbEvents };
