import { describe, expect, test } from 'vitest';
import { fnEnqueueLatestLegacyActorSnapshot } from '../../src/widget/fn.legacy-actor-event-queue';

describe('legacy actor event queue', () => {
  test('retains only the latest full snapshot while a guest is not polling', () => {
    let queue = [] as ReturnType<typeof fnEnqueueLatestLegacyActorSnapshot>;
    for (let index = 1; index <= 10_000; index += 1) {
      queue = fnEnqueueLatestLegacyActorSnapshot(queue, {
        type: 'snapshot',
        cursor: String(index),
        snapshot: {
          status: 'running',
          state: 'ready',
          context: { index },
        },
      });
    }

    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual(expect.objectContaining({
      cursor: '10000',
      snapshot: expect.objectContaining({ context: { index: 10_000 } }),
    }));
  });

  test('does not discard a non-snapshot control event', () => {
    const queue = fnEnqueueLatestLegacyActorSnapshot([
      { type: 'noop', cursor: '1' },
    ], {
      type: 'snapshot',
      cursor: '2',
      snapshot: {
        status: 'running',
        state: 'ready',
        context: {},
      },
    });

    expect(queue.map((event) => event.type)).toEqual(['noop', 'snapshot']);
  });
});
