import { describe, expect, test } from 'vitest';
import { fnActorEventSnapshot, type TActorSnapshot } from '../../src/widget/fn.actor-event-snapshot';

const INITIAL: TActorSnapshot = {
  status: 'error',
  state: 'error',
  context: { failed: true },
  error: {
    phase: 'sandbox-runtime',
    code: 'FAILED',
    message: 'failed',
    retryable: true,
  },
};

describe('fnActorEventSnapshot', () => {
  test('uses successful runtime snapshots as authoritative state/context and recovers UI health', () => {
    const result = fnActorEventSnapshot({
      snapshot: INITIAL,
      event: {
        kind: 'system',
        actorId: 'actor-1',
        type: 'snapshot',
        revision: 3,
        state: 'busy.counting',
        data: { ticks: 2 },
        cause: 'activity',
      },
    });

    expect(result).toEqual({
      recovered: true,
      snapshot: {
        status: 'running',
        state: 'busy.counting',
        context: { ticks: 2 },
        error: null,
      },
    });
  });

  test('preserves the preceding runtime error when the final snapshot cause is error', () => {
    const result = fnActorEventSnapshot({
      snapshot: INITIAL,
      event: {
        kind: 'system',
        actorId: 'actor-1',
        type: 'snapshot',
        revision: 4,
        state: 'error',
        data: { partial: true },
        cause: 'error',
      },
    });

    expect(result).toEqual({
      recovered: false,
      snapshot: {
        status: 'error',
        state: 'error',
        context: { partial: true },
        error: INITIAL.error,
      },
    });
  });
});
