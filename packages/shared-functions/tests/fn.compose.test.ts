import { describe, expect, test } from 'bun:test';
import { fnCompose } from '../src/functional/fn.compose';

describe('fnCompose', () => {
  test('returns identity function when no functions are provided', () => {
    const composed = fnCompose();

    expect(composed(5)).toBe(5);
  });

  test('applies functions from right to left', () => {
    const composed = fnCompose(
      (value: string) => `${value}!`,
      (value: string) => value.toUpperCase(),
      (value: string) => value.trim(),
    );

    expect(composed('  hello  ')).toBe('HELLO!');
  });
});
