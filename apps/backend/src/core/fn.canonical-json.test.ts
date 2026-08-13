import { describe, expect, test } from 'bun:test';
import { fnCanonicalJson, fnNormalizeCanonicalJson } from './fn.canonical-json';

describe('canonical JSON', () => {
  test('writes the same canonical form as the normalized projection', () => {
    const value = {
      z: [undefined, -0, { b: true, a: 'quoted\nvalue' }],
      omitted: undefined,
      a: { nested: 'ordinary JSON key' },
    };
    expect(fnCanonicalJson(value)).toBe(JSON.stringify(fnNormalizeCanonicalJson(value)));
    expect(fnCanonicalJson(value)).toBe(
      '{"a":{"nested":"ordinary JSON key"},"z":[null,0,{"a":"quoted\\nvalue","b":true}]}',
    );
  });

  test('retains strict rejection of unsupported values', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1n, Symbol('x'), () => undefined]) {
      expect(() => fnCanonicalJson(value)).toThrow(TypeError);
    }
  });
});
