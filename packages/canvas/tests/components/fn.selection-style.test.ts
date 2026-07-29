import type {
  TConnectorNode,
  TRectNode,
  TWidgetFrameNode,
} from '@omnidraw/cangine';
import { describe, expect, it } from 'vitest';
import {
  fnApplySelectionStyle,
  fnCanShowSelectionStyleMenu,
  fnCanvasColorToCss,
  fnConnectorRoutingToLineShape,
  fnHexToCanvasColor,
  fnLineShapeToSegmentMode,
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

const WIDGET: TWidgetFrameNode = {
  id: 'widget-1',
  parentId: null,
  orderKey: '2',
  kind: 'widget-frame',
  transform: {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  },
  size: { width: 320, height: 240 },
  title: 'Widget',
  portal: {
    portalId: 'widget-1',
    interactive: true,
    scaleMode: 'world',
    suspendWhenOffscreen: true,
    overscan: 96,
  },
  resizable: true,
};

const CONNECTOR: TConnectorNode = {
  id: 'connector-1',
  parentId: null,
  orderKey: '3',
  kind: 'connector',
  transform: {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  },
  from: { type: 'point', point: { x: 0, y: 0 } },
  to: { type: 'point', point: { x: 100, y: 80 } },
  routing: { type: 'straight' },
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

  it('does not expose selection styles for a widget frame', () => {
    expect(fnCanShowSelectionStyleMenu([WIDGET])).toBe(false);
    expect(fnSelectionStyleState([WIDGET])).toMatchObject({
      showFill: false,
      showStroke: false,
      showStrokeWidth: false,
      showOpacity: false,
    });
  });

  it('projects supported connector routing into product line shapes', () => {
    expect(fnConnectorRoutingToLineShape({ type: 'straight' })).toBe('straight');
    expect(fnConnectorRoutingToLineShape({
      type: 'quadratic',
      control: { x: 50, y: 10 },
    })).toBe('curved');
    expect(fnConnectorRoutingToLineShape({
      type: 'bezier',
      control1: { x: 25, y: 10 },
      control2: { x: 75, y: 70 },
    })).toBe('curved');
    expect(fnConnectorRoutingToLineShape({ type: 'orthogonal' })).toBe('elbow');
    expect(fnConnectorRoutingToLineShape({
      type: 'manual',
      path: { commands: [] },
    })).toBeNull();
    expect(fnLineShapeToSegmentMode('straight')).toBe('straight');
    expect(fnLineShapeToSegmentMode('curved')).toBe('smooth');
    expect(fnLineShapeToSegmentMode('elbow')).toBe('elbow');
  });

  it('shows line shape only for one non-manual connector', () => {
    expect(fnSelectionStyleState([CONNECTOR])).toMatchObject({
      showLine: true,
      lineShape: 'straight',
    });
    expect(fnSelectionStyleState([{
      ...CONNECTOR,
      routing: { type: 'orthogonal' },
    }])).toMatchObject({
      showLine: true,
      lineShape: 'elbow',
    });
    expect(fnSelectionStyleState([{
      ...CONNECTOR,
      routing: {
        type: 'manual',
        path: { commands: [] },
      },
    }])).toMatchObject({
      showLine: false,
      lineShape: null,
    });
    expect(fnSelectionStyleState([CONNECTOR, RECT])).toMatchObject({
      showLine: false,
      lineShape: null,
    });
    expect(fnSelectionStyleState([RECT])).toMatchObject({
      showLine: false,
      lineShape: null,
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
