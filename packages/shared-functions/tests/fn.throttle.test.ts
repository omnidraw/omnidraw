import { describe, expect, test } from 'bun:test';
import { fnThrottle } from '../src/functional/fn.throttle';

describe('fnThrottle', () => {
  test('calls immediately and ignores calls during the wait window', async () => {
    const calls: string[] = [];
    const throttled = fnThrottle(
      {
        setTimeout: globalThis.setTimeout,
      },
      (value: string) => {
        calls.push(value);
      },
      10,
    );

    throttled('a');
    throttled('b');
    throttled('c');

    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));

    throttled('d');
    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));

    expect(calls).toEqual(['a', 'd']);
  });
});
