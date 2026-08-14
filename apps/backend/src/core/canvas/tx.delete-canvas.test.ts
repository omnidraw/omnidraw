import { describe, expect, test } from 'bun:test';
import { Effect, Stream } from 'effect';
import { CanvasAuthority } from './service.canvas-authority';
import {
  CanvasChatLifecycle,
  CanvasDeletionError,
  CanvasDeletionStore,
  type TCanvasDeletionPlan,
} from './service.canvas-deletion';
import { txDeleteCanvas } from './tx.delete-canvas';

const plan: TCanvasDeletionPlan = Object.freeze({
  canvas: Object.freeze({
    id: 'canvas-a',
    name: 'Canvas A',
    revision: 2,
    createdAtSec: '2026-08-14 10:00:00',
    updatedAtSec: '2026-08-14 10:01:00',
  }),
  itemCount: 3,
  mediaCount: 1,
  retainedChatCount: 2,
});

function run(args: Readonly<{
  calls: string[];
  commit?: () => Effect.Effect<never, CanvasDeletionError>;
  receipt?: boolean;
}>) {
  const canvas = CanvasAuthority.of({
    getSnapshot: () => Effect.die('unused'),
    queryItems: () => Effect.die('unused'),
    execute: () => Effect.die('unused'),
    events: () => Effect.succeed(Stream.empty),
    release: () => Effect.void,
    beginDeletion: () => Effect.sync(() => { args.calls.push('claim'); }),
    abortDeletion: () => Effect.sync(() => { args.calls.push('abort'); }),
    commitDeletion: () => Effect.sync(() => { args.calls.push('release'); }),
  });
  const chats = CanvasChatLifecycle.of({
    disposeCanvas: () => Effect.sync(() => { args.calls.push('dispose-chats'); }),
    resumeCanvas: () => Effect.sync(() => { args.calls.push('resume-chats'); }),
  });
  const store = CanvasDeletionStore.of({
    receipt: () => args.receipt
      ? Effect.succeed({
          canvas: plan.canvas,
          cleanup: {
            itemCount: plan.itemCount,
            mediaCount: plan.mediaCount,
            retainedChatCount: plan.retainedChatCount,
          },
        })
      : Effect.succeed(null),
    plan: () => Effect.succeed(plan),
    commit: () => args.commit?.() ?? Effect.sync(() => {
      args.calls.push('commit-database');
      return {
        canvas: plan.canvas,
        cleanup: {
          itemCount: plan.itemCount,
          mediaCount: plan.mediaCount,
          retainedChatCount: plan.retainedChatCount,
        },
      };
    }),
  });
  return Effect.runPromise(txDeleteCanvas({ deletionId: 'delete-a', plan }).pipe(
    Effect.provideService(CanvasAuthority, canvas),
    Effect.provideService(CanvasChatLifecycle, chats),
    Effect.provideService(CanvasDeletionStore, store),
  ));
}

describe('txDeleteCanvas', () => {
  test('disposes chat runtime before the durable transaction and releases after commit', async () => {
    const calls: string[] = [];
    await expect(run({ calls })).resolves.toMatchObject({
      canvas: { id: 'canvas-a' },
      cleanup: { retainedChatCount: 2 },
    });
    expect(calls).toEqual(['claim', 'dispose-chats', 'commit-database', 'release']);
  });

  test('resumes chat and Canvas admission after a failed database transaction', async () => {
    const calls: string[] = [];
    await expect(run({
      calls,
      commit: () => Effect.fail(new CanvasDeletionError(
        'CANVAS_DELETE_STALE',
        'Review the changed Canvas.',
      )),
    })).rejects.toMatchObject({ code: 'CANVAS_DELETE_STALE' });
    expect(calls).toEqual(['claim', 'dispose-chats', 'resume-chats', 'abort']);
  });

  test('returns a committed lost-ack receipt without reclaiming runtime state', async () => {
    const calls: string[] = [];
    await expect(run({ calls, receipt: true })).resolves.toMatchObject({ canvas: { id: 'canvas-a' } });
    expect(calls).toEqual([]);
  });
});
