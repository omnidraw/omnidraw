import { describe, expect, test } from 'vitest';
import { fnIsWidgetPortalVisible } from '../../src/widget/fn.widget-portal-visibility';

describe('fnIsWidgetPortalVisible', () => {
  test('accepts intersecting, rotated, and preloaded portal bounds', () => {
    expect(fnIsWidgetPortalVisible({
      matrix: [1, 0, 0, 1, 10, 20],
      width: 200,
      height: 100,
      viewportWidth: 800,
      viewportHeight: 600,
      preloadMargin: 100,
    })).toBe(true);
    expect(fnIsWidgetPortalVisible({
      matrix: [0, 1, -1, 0, 850, 100],
      width: 100,
      height: 100,
      viewportWidth: 800,
      viewportHeight: 600,
      preloadMargin: 100,
    })).toBe(true);
  });

  test('rejects portals outside the preload margin and malformed transforms', () => {
    expect(fnIsWidgetPortalVisible({
      matrix: [1, 0, 0, 1, 1_001, 20],
      width: 100,
      height: 100,
      viewportWidth: 800,
      viewportHeight: 600,
      preloadMargin: 100,
    })).toBe(false);
    expect(fnIsWidgetPortalVisible({
      matrix: [1, 0, 0, Number.NaN, 0, 0],
      width: 100,
      height: 100,
      viewportWidth: 800,
      viewportHeight: 600,
      preloadMargin: 100,
    })).toBe(false);
  });

  test('keeps rendering when a DOM harness cannot report viewport dimensions', () => {
    expect(fnIsWidgetPortalVisible({
      matrix: [1, 0, 0, 1, 100_000, 100_000],
      width: 100,
      height: 100,
      viewportWidth: 0,
      viewportHeight: 0,
      preloadMargin: 100,
    })).toBe(true);
  });
});
