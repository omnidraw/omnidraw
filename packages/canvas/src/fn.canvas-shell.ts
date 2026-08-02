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
