import { describe, expect, test } from 'vitest';
import {
  fnCanvasInputGateSwallowsKeys,
  fnCanvasInputGateSwallowsWheel,
  fnCanvasShellFocusTransition,
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

  test('gates keys while maximized or content-focused, and wheel only while maximized (B80)', () => {
    expect(fnCanvasInputGateSwallowsKeys({
      maximizedNodeId: null,
      contentNodeId: null,
    })).toBe(false);
    expect(fnCanvasInputGateSwallowsKeys({
      maximizedNodeId: 'widget-max',
      contentNodeId: null,
    })).toBe(true);
    expect(fnCanvasInputGateSwallowsKeys({
      maximizedNodeId: null,
      contentNodeId: 'widget-content',
    })).toBe(true);

    expect(fnCanvasInputGateSwallowsWheel({
      maximizedNodeId: null,
      contentNodeId: null,
    })).toBe(false);
    expect(fnCanvasInputGateSwallowsWheel({
      maximizedNodeId: null,
      contentNodeId: 'widget-content',
    })).toBe(false);
    expect(fnCanvasInputGateSwallowsWheel({
      maximizedNodeId: 'widget-max',
      contentNodeId: null,
    })).toBe(true);
  });

  test('detects shell transitions across the maximized boundary (B80)', () => {
    const canvas = { kind: 'canvas', widgetId: null } as const;
    const contained = { kind: 'contained-widget', widgetId: 'widget-a' } as const;
    const maximized = { kind: 'maximized-widget', widgetId: 'widget-a' } as const;
    const otherMaximized = { kind: 'maximized-widget', widgetId: 'widget-b' } as const;

    expect(fnCanvasShellFocusTransition(canvas, maximized)).toEqual({
      kind: 'enter-maximized',
      widgetId: 'widget-a',
    });
    expect(fnCanvasShellFocusTransition(contained, maximized)).toEqual({
      kind: 'enter-maximized',
      widgetId: 'widget-a',
    });
    expect(fnCanvasShellFocusTransition(maximized, canvas)).toEqual({
      kind: 'exit-maximized',
      widgetId: 'widget-a',
    });
    expect(fnCanvasShellFocusTransition(maximized, contained)).toEqual({
      kind: 'exit-maximized',
      widgetId: 'widget-a',
    });
    // Direct widget-to-widget re-maximization moves focus straight into
    // the newly maximized widget's portal.
    expect(fnCanvasShellFocusTransition(maximized, otherMaximized)).toEqual({
      kind: 'enter-maximized',
      widgetId: 'widget-b',
    });
    expect(fnCanvasShellFocusTransition(maximized, maximized)).toEqual({ kind: 'none' });
    expect(fnCanvasShellFocusTransition(canvas, contained)).toEqual({ kind: 'none' });
    expect(fnCanvasShellFocusTransition(contained, canvas)).toEqual({ kind: 'none' });
  });
});
