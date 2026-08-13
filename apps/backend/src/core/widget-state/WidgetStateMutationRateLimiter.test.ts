import { describe, expect, test } from 'bun:test';
import { WidgetStateMutationRateLimiter } from './WidgetStateMutationRateLimiter';

describe('WidgetStateMutationRateLimiter decisions', () => {
  test('admits through the limit and derives retry-after from the oldest retained mutation', () => {
    const limiter = new WidgetStateMutationRateLimiter(2, 1_000, 4);

    expect(limiter.admit('widget-a', 100)).toEqual({ allowed: true });
    expect(limiter.admit('widget-a', 400)).toEqual({ allowed: true });
    expect(limiter.admit('widget-a', 750)).toEqual({
      allowed: false,
      retryAfterMs: 350,
    });
  });

  test('rejects a new scope at capacity and selects the earliest ledger expiry', () => {
    const limiter = new WidgetStateMutationRateLimiter(2, 1_000, 2);
    expect(limiter.admit('widget-a', 100)).toEqual({ allowed: true });
    expect(limiter.admit('widget-b', 350)).toEqual({ allowed: true });

    expect(limiter.admit('widget-c', 700)).toEqual({
      allowed: false,
      retryAfterMs: 400,
    });
    expect(limiter.size).toBe(2);
  });

  test('prunes an expired ledger at the exact window boundary before admission', () => {
    const limiter = new WidgetStateMutationRateLimiter(1, 1_000, 1);
    expect(limiter.admit('widget-a', 100)).toEqual({ allowed: true });
    expect(limiter.admit('widget-b', 1_099)).toEqual({
      allowed: false,
      retryAfterMs: 1,
    });

    expect(limiter.admit('widget-b', 1_100)).toEqual({ allowed: true });
    expect(limiter.size).toBe(1);
  });

  test('release frees only the selected scope immediately', () => {
    const limiter = new WidgetStateMutationRateLimiter(1, 1_000, 2);
    expect(limiter.admit('widget-a', 0)).toEqual({ allowed: true });
    expect(limiter.admit('widget-b', 0)).toEqual({ allowed: true });

    limiter.release('widget-a');
    limiter.release('widget-a');
    expect(limiter.admit('widget-c', 1)).toEqual({ allowed: true });
    expect(limiter.admit('widget-b', 1)).toEqual({
      allowed: false,
      retryAfterMs: 999,
    });
  });
});
