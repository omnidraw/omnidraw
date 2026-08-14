import { Effect } from 'effect';
import {
  CanvasDeletionStore,
  type CanvasDeletionError,
  type TCanvasDeletionPlan,
} from './service.canvas-deletion';

export const fxPlanCanvasDeletion = Effect.fn('fxPlanCanvasDeletion')(function*(
  args: Readonly<{ canvasId: string }>,
): Effect.fn.Return<TCanvasDeletionPlan, CanvasDeletionError, CanvasDeletionStore> {
  const store = yield* CanvasDeletionStore;
  return yield* store.plan(args);
});
