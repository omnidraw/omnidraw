import { describe, expect, test } from 'bun:test';
import { fnDebounce } from '../src/functional/fn.debounce';

describe('fnDebounce', () => {
  test('calls only the latest invocation after the wait', async () => {
    const calls: string[] = [];
    const debounced = fnDebounce(
      {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
      (value: string) => {
        calls.push(value);
      },
      10,
    );

    debounced('a');
    debounced('b');
    debounced('c');

    await new Promise((resolve) => globalThis.setTimeout(resolve, 25));

    expect(calls).toEqual(['c']);
  });
});
