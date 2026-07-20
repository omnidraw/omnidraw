import { WIDGET_FRAME_FALLBACK } from './CONSTANTS';

export type TWidgetFrameBounds = {
  width: number;
  height: number;
};

export type TWidgetPlacementRef =
  | { source: 'published'; name: string; revision: string }
  | { source: 'draft'; name: string; revision: string }
  | { source: 'preview'; name: string; revision: string };

export function fnNormalizeWidgetFrame(frame?: TWidgetFrameBounds): TWidgetFrameBounds {
  if (!frame) return { ...WIDGET_FRAME_FALLBACK };
  return { width: frame.width, height: frame.height };
}

export function fnWidgetPlacementRefKey(reference: TWidgetPlacementRef): string {
  return `${reference.source}:${encodeURIComponent(reference.name)}:${encodeURIComponent(reference.revision)}`;
}

export function fnWidgetPlacementToolId(reference: Pick<TWidgetPlacementRef, 'source' | 'name'>): string {
  return `widget-placement:${reference.source}:${encodeURIComponent(reference.name)}`;
}
