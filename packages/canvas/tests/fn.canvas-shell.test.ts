import { describe, expect, test } from 'vitest';
import {
  fnCanvasShellOwnsOverlay,
  fnCanvasShellProjection,
  fnCanvasWidgetShellAvailable,
} from '../src/fn.canvas-shell';

describe('canvas shell projection', () => {
  test('gives maximization precedence over contained and editor focus', () => {
    expect(fnCanvasShellProjection({
      maximizedNodeId: 'widget-max',
      contentNodeId: 'widget-content',
      frameNodeId: 'widget-frame',
      focusedWidgetNodeId: 'widget-focused',
    })).toEqual({ kind: 'maximized-widget', widgetId: 'widget-max' });

    expect(fnCanvasShellProjection({
      maximizedNodeId: null,
      contentNodeId: null,
      frameNodeId: 'widget-frame',
      focusedWidgetNodeId: null,
    })).toEqual({ kind: 'contained-widget', widgetId: 'widget-frame' });

    expect(fnCanvasShellProjection({
      maximizedNodeId: null,
      contentNodeId: null,
      frameNodeId: null,
      focusedWidgetNodeId: null,
    })).toEqual({ kind: 'canvas', widgetId: null });
  });

  test('suppresses canvas and sibling widget overlays in the maximized shell', () => {
    const shell = { kind: 'maximized-widget', widgetId: 'widget-max' } as const;
    expect(fnCanvasShellOwnsOverlay(shell, { kind: 'canvas-shell' })).toBe(false);
    expect(fnCanvasShellOwnsOverlay(shell, {
      kind: 'widget-shell',
      widgetId: 'widget-sibling',
    })).toBe(false);
    expect(fnCanvasShellOwnsOverlay(shell, {
      kind: 'widget-shell',
      widgetId: 'widget-max',
    })).toBe(true);
    expect(fnCanvasShellOwnsOverlay(
      { kind: 'canvas', widgetId: null },
      { kind: 'canvas-shell' },
    )).toBe(true);
  });

  test('rejects deleted, replaced, collapsed, and hidden maximized nodes', () => {
    expect(fnCanvasWidgetShellAvailable(null)).toBe(false);
    expect(fnCanvasWidgetShellAvailable({ kind: 'rect' })).toBe(false);
    expect(fnCanvasWidgetShellAvailable({ kind: 'widget-frame', collapsed: true })).toBe(false);
    expect(fnCanvasWidgetShellAvailable({ kind: 'widget-frame', visibility: 'hidden' })).toBe(false);
    expect(fnCanvasWidgetShellAvailable({ kind: 'widget-frame', visibility: 'visible' })).toBe(true);
  });
});
