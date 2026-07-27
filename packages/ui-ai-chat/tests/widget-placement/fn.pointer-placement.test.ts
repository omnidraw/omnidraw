import { describe, expect, test } from 'vitest';
import {
  fnClampWidgetPlacementPosition,
  fnHasWidgetPlacementDragThreshold,
} from '../../src/widget-placement/fn.pointer-placement';

describe('widget pointer placement functions', () => {
  test('starts dragging only after the configured distance', () => {
    expect(fnHasWidgetPlacementDragThreshold({
      origin: { x: 10, y: 10 },
      point: { x: 13, y: 14 },
      threshold: 6,
    })).toBe(false);
    expect(fnHasWidgetPlacementDragThreshold({
      origin: { x: 10, y: 10 },
      point: { x: 16, y: 10 },
      threshold: 6,
    })).toBe(true);
  });

  test('keeps the complete widget frame within the visible viewport', () => {
    expect(fnClampWidgetPlacementPosition({
      point: { x: 480, y: -20 },
      bounds: { width: 120, height: 80 },
      viewport: { minX: 0, minY: 0, maxX: 500, maxY: 400 },
    })).toEqual({ x: 380, y: 0 });
  });
});
