import { describe, expect, test } from 'bun:test';
import { fnCurry } from '../src/functional/fn.curry';

describe('fnCurry', () => {
  test('calls function immediately when enough args are provided', () => {
    const sum = fnCurry((a: number, b: number, c: number) => a + b + c);

    expect(sum(1, 2, 3)).toBe(6);
  });

  test('supports partial application across multiple calls', () => {
    const sum = fnCurry((a: number, b: number, c: number) => a + b + c);

    expect(sum(1)(2)(3)).toBe(6);
    expect(sum(1, 2)(3)).toBe(6);
    expect(sum(1)(2, 3)).toBe(6);
  });

  test('preserves this binding across curried calls', () => {
    const context = {
      base: 10,
      add(this: { base: number }, a: number, b: number) {
        return this.base + a + b;
      },
    };

    const curried = fnCurry(context.add);

    expect(curried.call(context, 1, 2)).toBe(13);
    expect(curried.call(context, 1).call(context, 2)).toBe(13);
  });
});
