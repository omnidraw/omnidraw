import { describe, expect, test } from 'bun:test';
import { fnMemoize } from '../src/functional/fn.memoize';

describe('fnMemoize', () => {
  test('caches repeated calls for the same arguments', () => {
    let callCount = 0;

    const add = fnMemoize((a: number, b: number) => {
      callCount += 1;
      return a + b;
    });

    expect(add(1, 2)).toBe(3);
    expect(add(1, 2)).toBe(3);
    expect(add(2, 3)).toBe(5);
    expect(add(2, 3)).toBe(5);
    expect(callCount).toBe(2);
  });
});
