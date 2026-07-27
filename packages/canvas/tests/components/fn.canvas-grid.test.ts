import { describe, expect, test } from 'vitest';
import { fnCanvasGridStyle } from '../../src/components/fn.canvas-grid';

describe('fnCanvasGridStyle', () => {
  test('anchors a bounded screen grid to the projected world origin', () => {
    const style = fnCanvasGridStyle({
      origin: { x: 17, y: -9 },
      visible: true,
      zoom: 0.1,
    });

    expect(style.display).toBe('block');
    expect(style.backgroundPosition).toBe('17px -9px');
    expect(Number.parseFloat(style.backgroundSize)).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(style.backgroundSize)).toBeLessThanOrEqual(96);
  });

  test('removes the grid when hidden or the camera zoom is invalid', () => {
    expect(fnCanvasGridStyle({
      origin: { x: 0, y: 0 },
      visible: false,
      zoom: 1,
    }).display).toBe('none');

    expect(fnCanvasGridStyle({
      origin: { x: 0, y: 0 },
      visible: true,
      zoom: 0,
    }).display).toBe('none');
  });
});
