import { baseDbOs } from './orpc';
import { fxDbEvents } from './fx.db-events';

const apiDbEvents = baseDbOs.events.handler(async function* ({ input, context }) {
  yield* fxDbEvents({
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
