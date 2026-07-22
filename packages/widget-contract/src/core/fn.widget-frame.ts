import { WIDGET_FRAME_FALLBACK } from '../CONSTANTS'
import type { TWidgetFrameBounds, TWidgetPlacementRef } from '../types'

export function fnNormalizeWidgetFrame(frame?: TWidgetFrameBounds): TWidgetFrameBounds {
  if (!frame) return { ...WIDGET_FRAME_FALLBACK }
  return { width: frame.width, height: frame.height }
}

export function fnWidgetPlacementRefKey(reference: TWidgetPlacementRef): string {
  return `${reference.source}:${encodeURIComponent(reference.name)}:${encodeURIComponent(reference.revision)}`
}

export function fnWidgetPlacementToolId(
  reference: Pick<TWidgetPlacementRef, 'source' | 'name'>,
): string {
  return `widget-placement:${reference.source}:${encodeURIComponent(reference.name)}`
}
