import type { TCanvasToolId } from './FloatingCanvasToolbar/toolbar.types';

const TOOL_SHORTCUTS: Readonly<Record<string, TCanvasToolId>> = Object.freeze({
  '1': 'select',
  '2': 'rect',
  '3': 'ellipse',
  '4': 'text',
  '5': 'connector',
  '6': 'arrow',
  '7': 'pen',
  '8': 'eraser',
  a: 'arrow',
  e: 'eraser',
  h: 'hand',
  l: 'connector',
  o: 'ellipse',
  p: 'pen',
  r: 'rect',
  t: 'text',
});

export function fnCanvasToolShortcut(key: string): TCanvasToolId | null {
  return TOOL_SHORTCUTS[key.toLowerCase()] ?? null;
}
