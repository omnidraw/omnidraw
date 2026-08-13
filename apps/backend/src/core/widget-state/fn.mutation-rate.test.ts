import { describe, expect, test } from 'bun:test';
import {
  fnTransitionWidgetStateMutationRate,
  type TWidgetStateMutationRateLedgerEntry,
} from './fn.mutation-rate';

function transition(
  ledgers: readonly TWidgetStateMutationRateLedgerEntry[],
  scope: string,
  now: number,
  overrides: Readonly<{
    limit?: number;
    windowMs?: number;
    maxLedgers?: number;
  }> = {},
) {
  return fnTransitionWidgetStateMutationRate({
    scope,
    now,
    limit: overrides.limit ?? 2,
    windowMs: overrides.windowMs ?? 1_000,
    maxLedgers: overrides.maxLedgers ?? 2,
    ledgers,
  });
}

describe('widget-state mutation-rate transition', () => {
  test('preserves fixed-window admission and exact retry timing', () => {
    const first = transition([], 'instance-a', 0);
    const second = transition(first.ledgers, 'instance-a', 0);
    const limited = transition(second.ledgers, 'instance-a', 0);
    const finalMillisecond = transition(limited.ledgers, 'instance-a', 999);
    const expired = transition(finalMillisecond.ledgers, 'instance-a', 1_000);

    expect(first.admission).toEqual({ allowed: true });
    expect(second.admission).toEqual({ allowed: true });
    expect(limited.admission).toEqual({ allowed: false, retryAfterMs: 1_000 });
    expect(finalMillisecond.admission).toEqual({ allowed: false, retryAfterMs: 1 });
    expect(expired.admission).toEqual({ allowed: true });
    expect(expired.ledgers).toEqual([[
      'instance-a',
      { lastSeenAt: 1_000, timestamps: [1_000] },
    ]]);
  });

  test('denies at ledger capacity and evicts empty expired ledgers first', () => {
    const first = transition([], 'instance-a', 0, { maxLedgers: 1 });
    const capacity = transition(first.ledgers, 'instance-b', 0, { maxLedgers: 1 });
    const evicted = transition(capacity.ledgers, 'instance-b', 1_000, {
      maxLedgers: 1,
    });

    expect(capacity.admission).toEqual({
      allowed: false,
      retryAfterMs: 1_000,
    });
    expect(capacity.ledgers).toEqual(first.ledgers);
    expect(evicted.admission).toEqual({ allowed: true });
    expect(evicted.ledgers.map(([scope]) => scope)).toEqual(['instance-b']);
  });

  test('uses the earliest occupied ledger when reporting capacity retry', () => {
    const first = transition([], 'instance-a', 100);
    const second = transition(first.ledgers, 'instance-b', 300);
    const capacity = transition(second.ledgers, 'instance-c', 400);

    expect(capacity.admission).toEqual({
      allowed: false,
      retryAfterMs: 700,
    });
  });
});
