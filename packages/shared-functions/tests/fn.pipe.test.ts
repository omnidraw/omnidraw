import { describe, expect, test } from 'bun:test';
import { fnPipe } from '../src/functional/fn.pipe';

describe('fnPipe', () => {
  test('returns the original value when no functions are provided', () => {
    expect(fnPipe(5)).toBe(5);
  });

  test('applies functions from left to right', () => {
    const result = fnPipe(
      '  hello  ',
      (value) => value.trim(),
      (value) => value.toUpperCase(),
      (value) => `${value}!`,
    );

    expect(result).toBe('HELLO!');
  });
});
