import { Effect } from 'effect';
import { CanvasAuthority } from './service.canvas-authority';
import {
  CanvasChatLifecycle,
  CanvasDeletionError,
  CanvasDeletionStore,
  type TCanvasDeletionPlan,
  type TCanvasDeletionResult,
} from './service.canvas-deletion';

function coordinationFailure(canvasId: string, cause: unknown): CanvasDeletionError {
  return new CanvasDeletionError(
    'CANVAS_DELETE_COORDINATION_FAILED',
    'Canvas deletion could not coordinate every runtime. The Canvas was retained and can be retried.',
    { canvasId },
    { cause },
  );
}

export const txDeleteCanvas = Effect.fn('txDeleteCanvas')(function*(args: Readonly<{
  deletionId: string;
  plan: TCanvasDeletionPlan;
}>): Effect.fn.Return<
  TCanvasDeletionResult,
  CanvasDeletionError,
  CanvasAuthority | CanvasDeletionStore | CanvasChatLifecycle
> {
  const canvas = yield* CanvasAuthority;
  const chats = yield* CanvasChatLifecycle;
  const store = yield* CanvasDeletionStore;
  const canvasId = args.plan.canvas.id;

  const receipt = yield* store.receipt({ deletionId: args.deletionId, canvasId });
  if (receipt !== null) return receipt;

  yield* canvas.beginDeletion({ canvasId }).pipe(
    Effect.mapError((error) => new CanvasDeletionError(
      error.code === 'NOT_FOUND'
        ? 'CANVAS_DELETE_NOT_FOUND'
        : error.code === 'CONFLICT' || error.code === 'STORE_CONFLICT'
          ? 'CANVAS_DELETE_BUSY'
          : 'CANVAS_DELETE_COORDINATION_FAILED',
      error.code === 'NOT_FOUND'
        ? 'The Canvas no longer exists.'
        : error.code === 'CONFLICT' || error.code === 'STORE_CONFLICT'
          ? 'Canvas deletion is already in progress.'
          : 'Canvas deletion could not claim the Canvas lifecycle.',
      { canvasId },
      { cause: error },
    )),
  );

  const result = yield* chats.disposeCanvas({ canvasId }).pipe(
    Effect.flatMap(() => store.commit(args)),
    Effect.catch((error) => chats.resumeCanvas({ canvasId }).pipe(
      Effect.catch(() => Effect.void),
      Effect.andThen(canvas.abortDeletion({ canvasId }).pipe(Effect.catch(() => Effect.void))),
      Effect.andThen(Effect.fail(
        error instanceof CanvasDeletionError ? error : coordinationFailure(canvasId, error),
      )),
    )),
  );

  // Durable deletion has committed. Runtime release is idempotent and cannot
  // turn that success into a misleading retryable failure.
  yield* canvas.commitDeletion({ canvasId }).pipe(Effect.catch(() => Effect.void));
  return result;
});
