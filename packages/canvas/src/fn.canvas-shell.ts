/** @file Pure canvas-shell projection and overlay ownership checks. */

export type TCanvasShellState =
  | Readonly<{ kind: 'canvas'; widgetId: null }>
  | Readonly<{ kind: 'contained-widget'; widgetId: string }>
  | Readonly<{ kind: 'maximized-widget'; widgetId: string }>;

export type TCanvasOverlayOwnership =
  | Readonly<{ kind: 'canvas-shell' }>
  | Readonly<{ kind: 'widget-shell'; widgetId: string }>;

export type TCanvasWidgetShellNode = Readonly<{
  kind: string;
  collapsed?: boolean;
  visibility?: 'visible' | 'hidden' | 'inherited';
}>;

export type TArgsCanvasShellProjection = Readonly<{
  maximizedNodeId: string | null;
  contentNodeId: string | null;
  frameNodeId: string | null;
  focusedWidgetNodeId: string | null;
}>;

export function fnCanvasShellProjection(
  args: TArgsCanvasShellProjection,
): TCanvasShellState {
  if (args.maximizedNodeId !== null) {
    return Object.freeze({
      kind: 'maximized-widget' as const,
      widgetId: args.maximizedNodeId,
    });
  }
  const widgetId = args.contentNodeId
    ?? args.frameNodeId
    ?? args.focusedWidgetNodeId;
  return widgetId === null
    ? Object.freeze({ kind: 'canvas' as const, widgetId: null })
    : Object.freeze({ kind: 'contained-widget' as const, widgetId });
}

export function fnCanvasShellOwnsOverlay(
  shell: TCanvasShellState,
  ownership: TCanvasOverlayOwnership,
): boolean {
  if (shell.kind !== 'maximized-widget') return true;
  return ownership.kind === 'widget-shell'
    && ownership.widgetId === shell.widgetId;
}

export function fnCanvasWidgetShellAvailable(
  node: TCanvasWidgetShellNode | null | undefined,
): boolean {
  return node?.kind === 'widget-frame'
    && node.collapsed !== true
    && node.visibility !== 'hidden';
}

export type TArgsCanvasInputGate = Readonly<{
  maximizedNodeId: string | null;
  contentNodeId: string | null;
}>;

/**
 * Maximized and content-focused widgets own every key while the widget
 * DOM has it; the runtime input gate swallows normalized key events before
 * the editor/standard-tools path can turn them into canvas commands.
 */
export function fnCanvasInputGateSwallowsKeys(
  args: TArgsCanvasInputGate,
): boolean {
  return args.maximizedNodeId !== null || args.contentNodeId !== null;
}

/**
 * A maximized widget covers the whole shell, so any wheel event reaching
 * the engine while maximized must not pan/zoom the hidden canvas camera.
 * Content-focused wheel handling stays with the engine's own per-hit guard.
 */
export function fnCanvasInputGateSwallowsWheel(
  args: TArgsCanvasInputGate,
): boolean {
  return args.maximizedNodeId !== null;
}

export type TCanvasShellFocusTransition =
  | Readonly<{ kind: 'enter-maximized'; widgetId: string }>
  | Readonly<{ kind: 'exit-maximized'; widgetId: string }>
  | Readonly<{ kind: 'none' }>;

/**
 * Detects shell transitions across the maximized boundary so the runtime
 * can move DOM focus into the widget on entry and back to the canvas on
 * exit, without the widget or canvas having to coordinate it themselves.
 */
export function fnCanvasShellFocusTransition(
  previous: TCanvasShellState,
  next: TCanvasShellState,
): TCanvasShellFocusTransition {
  if (next.kind === 'maximized-widget') {
    if (previous.kind === 'maximized-widget' && previous.widgetId === next.widgetId) {
      return Object.freeze({ kind: 'none' });
    }
    // Covers a direct widget-to-widget re-maximize too: focus moves
    // straight into the newly maximized widget's portal.
    return Object.freeze({ kind: 'enter-maximized', widgetId: next.widgetId });
  }
  if (previous.kind === 'maximized-widget') {
    return Object.freeze({ kind: 'exit-maximized', widgetId: previous.widgetId });
  }
  return Object.freeze({ kind: 'none' });
}
