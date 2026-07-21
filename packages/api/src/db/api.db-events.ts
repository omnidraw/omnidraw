import { baseDbOs } from './orpc';
import { fxDbEvents } from './fx.db-events';

const apiDbEvents = baseDbOs.events.handler(async function* ({ input, context }) {
  yield* fxDbEvents({
    findCanvasById: (tenant, args) => context.db.canvas.findById(tenant, args),
    subscribeDbEventRecords: (tenant, canvasId, options) => (
      context.eventPublisher.subscribeDbEventRecords(tenant, canvasId, options)
    ),
  }, {
    afterSequence: input.afterSequence,
    canvasId: input.canvasId,
    tenant: context.tenant,
  });
});

export { apiDbEvents };
