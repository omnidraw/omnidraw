import type { TRectNode } from '@omnidraw/cangine';
import { describe, expect, it } from 'vitest';
import {
  fnApplySelectionStyle,
  fnCanvasColorToCss,
  fnHexToCanvasColor,
  fnSelectionStyleState,
} from '../../src/components/SelectionStyleMenu/fn.selection-style';

const RECT: TRectNode = {
  id: 'rect-1',
  parentId: null,
  orderKey: '1',
  kind: 'rect',
  transform: {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  },
  size: { width: 100, height: 80 },
  fill: {
    type: 'solid',
    color: { space: 'srgb', r: 1, g: 1, b: 1, a: 1 },
  },
  stroke: {
    paint: {
      type: 'solid',
      color: { space: 'srgb', r: 0, g: 0, b: 0, a: 1 },
    },
    width: 2,
  },
};

describe('selection style functions', () => {
  it('converts hex colors to canonical canvas colors', () => {
    expect(fnHexToCanvasColor('#3b82f6')).toEqual({
      space: 'srgb',
      r: 59 / 255,
      g: 130 / 255,
      b: 246 / 255,
      a: 1,
    });
    expect(fnCanvasColorToCss(fnHexToCanvasColor('#3b82f6'))).toBe('#3b82f6');
  });

  it('derives the visible style state from selected nodes', () => {
    expect(fnSelectionStyleState([RECT])).toMatchObject({
      showFill: true,
      showStroke: true,
      showStrokeWidth: true,
      showOpacity: true,
      fillColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 2,
      opacity: 1,
    });
  });

  it('applies fill, stroke width, and opacity without changing identity', () => {
    const next = fnApplySelectionStyle(RECT, {
      fillColor: '#3b82f6',
      strokeWidth: 7,
      opacity: 0.5,
    });
    expect(next.id).toBe(RECT.id);
    expect(next.opacity).toBe(0.5);
    expect(next.kind === 'rect' && next.stroke?.width).toBe(7);
    expect(
      next.kind === 'rect'
      && next.fill?.type === 'solid'
      && fnCanvasColorToCss(next.fill.color),
    ).toBe('#3b82f6');
  });
});
