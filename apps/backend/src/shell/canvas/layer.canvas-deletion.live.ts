import {
  CanvasChatLifecycle,
  CanvasDeletionError,
  CanvasDeletionStore,
  type ICanvasChatLifecycle,
  type ICanvasDeletionStore,
} from '#backend/core/canvas/service.canvas-deletion';
import { Effect, Layer } from 'effect';
import { LiveAgent, LiveDatabase } from '../runtime/service.live-mechanics';

function failure(canvasId: string, cause: unknown): CanvasDeletionError {
  if (cause instanceof CanvasDeletionError) return cause;
  return new CanvasDeletionError(
    'CANVAS_DELETE_COORDINATION_FAILED',
    'Canvas deletion could not be completed. No durable Canvas data was removed.',
    { canvasId },
    { cause },
  );
}

export function canvasDeletionStoreFromLive(
  database: typeof LiveDatabase.Service,
): ICanvasDeletionStore {
  return CanvasDeletionStore.of({
    receipt: ({ deletionId, canvasId }) => Effect.try({
      try: () => database.canvasDeletion.receipt({ deletionId, canvasId }),
      catch: (cause) => failure(canvasId, cause),
    }),
    plan: ({ canvasId }) => Effect.tryPromise({
      try: async () => {
        const plan = await database.canvasDeletion.plan({ canvasId });
        if (plan === null) {
          throw new CanvasDeletionError(
            'CANVAS_DELETE_NOT_FOUND',
            'The Canvas no longer exists.',
            { canvasId },
          );
        }
        return plan;
      },
      catch: (cause) => failure(canvasId, cause),
    }),
    commit: (args) => Effect.tryPromise({
      try: async () => {
        const outcome = await database.canvasDeletion.commit(args);
        if (outcome.status === 'not-found') {
          throw new CanvasDeletionError(
            'CANVAS_DELETE_NOT_FOUND',
            'The Canvas no longer exists.',
            { canvasId: args.plan.canvas.id },
          );
        }
        if (outcome.status === 'stale') {
          throw new CanvasDeletionError(
            'CANVAS_DELETE_STALE',
            'The Canvas changed after this confirmation was prepared. Review the updated deletion summary before retrying.',
            {
              canvasId: args.plan.canvas.id,
              expectedRevision: args.plan.canvas.revision,
              actualRevision: outcome.actual.canvas.revision,
            },
          );
        }
        return outcome.result;
      },
      catch: (cause) => failure(args.plan.canvas.id, cause),
    }),
  });
}

export function canvasChatLifecycleFromLive(
  agent: typeof LiveAgent.Service,
): ICanvasChatLifecycle {
  return CanvasChatLifecycle.of({
    disposeCanvas: ({ canvasId }) => Effect.tryPromise({
      try: () => agent.disposeCanvasChats({ canvasId }),
      catch: (cause) => failure(canvasId, cause),
    }),
    resumeCanvas: ({ canvasId }) => Effect.try({
      try: () => agent.resumeCanvasChats({ canvasId }),
      catch: (cause) => failure(canvasId, cause),
    }),
  });
}

export const layerCanvasDeletionLive = Layer.merge(
  Layer.effect(
    CanvasDeletionStore,
    Effect.map(LiveDatabase, canvasDeletionStoreFromLive),
  ),
  Layer.effect(
    CanvasChatLifecycle,
    Effect.map(LiveAgent, canvasChatLifecycleFromLive),
  ),
);
