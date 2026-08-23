import type { TWidgetFrameBounds } from '@omnidraw/sdk';

export type TWidgetPlacementPoint = Readonly<{ x: number; y: number }>;

export function fnHasWidgetPlacementDragThreshold(args: Readonly<{
  origin: TWidgetPlacementPoint;
  point: TWidgetPlacementPoint;
  threshold: number;
}>): boolean {
  const deltaX = args.point.x - args.origin.x;
  const deltaY = args.point.y - args.origin.y;
  return (deltaX * deltaX) + (deltaY * deltaY)
    >= args.threshold * args.threshold;
}

export function fnClampWidgetPlacementPosition(args: Readonly<{
  point: TWidgetPlacementPoint;
  bounds: TWidgetFrameBounds;
  viewport: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
}>): TWidgetPlacementPoint {
  const maxX = Math.max(args.viewport.minX, args.viewport.maxX - args.bounds.width);
  const maxY = Math.max(args.viewport.minY, args.viewport.maxY - args.bounds.height);
  return {
    x: Math.min(maxX, Math.max(args.viewport.minX, args.point.x)),
    y: Math.min(maxY, Math.max(args.viewport.minY, args.point.y)),
  };
}
