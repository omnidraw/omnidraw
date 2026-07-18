import { describe, expect, test } from 'bun:test';
import { LUCIDE_STATIC_ICON_KEY_SET, RECOMMENDED_LUCIDE_STATIC_ICON_KEYS } from '../src/core/tool-icon';

describe('recommended Lucide icon vocabulary', () => {
  test('contains exactly 100 unique valid installed icon keys', () => {
    expect(RECOMMENDED_LUCIDE_STATIC_ICON_KEYS).toHaveLength(100);
    expect(new Set(RECOMMENDED_LUCIDE_STATIC_ICON_KEYS).size).toBe(100);
    for (const key of RECOMMENDED_LUCIDE_STATIC_ICON_KEYS) expect(LUCIDE_STATIC_ICON_KEY_SET.has(key)).toBe(true);
  });
});
