import type { TWidgetFrameBounds, TWidgetPlacementRef } from "@vibecanvas/orpc-client";
import type { TClientPoint, TWidgetWorldBounds, TWorldPoint, TWorldViewport } from "./types";

export function fnHasWidgetDragThreshold(args: {
  origin: TClientPoint;
  point: TClientPoint;
  threshold: number;
}): boolean {
  const deltaX = args.point.x - args.origin.x;
  const deltaY = args.point.y - args.origin.y;
  return (deltaX * deltaX) + (deltaY * deltaY) >= args.threshold * args.threshold;
}

export function fnWidgetPlacementReferenceIsAvailable(args: {
  reference: TWidgetPlacementRef;
  availableReferences: readonly TWidgetPlacementRef[];
}): boolean {
  return args.availableReferences.some((candidate) => (
    candidate.source === args.reference.source
    && candidate.name === args.reference.name
    && candidate.revision === args.reference.revision
  ));
}

export function fnClientPointToWidgetWorldPoint(args: {
  clientPoint: TClientPoint;
  canvasClientOrigin: TClientPoint;
  camera: TWorldPoint & { zoom: number };
}): TWorldPoint {
  return {
    x: (args.clientPoint.x - args.canvasClientOrigin.x - args.camera.x) / args.camera.zoom,
    y: (args.clientPoint.y - args.canvasClientOrigin.y - args.camera.y) / args.camera.zoom,
  };
}

export function fnWidgetVisibleWorldViewport(args: {
  camera: TWorldPoint & { zoom: number };
  viewportWidth: number;
  viewportHeight: number;
}): TWorldViewport {
  return {
    x: -args.camera.x / args.camera.zoom,
    y: -args.camera.y / args.camera.zoom,
    width: args.viewportWidth / args.camera.zoom,
    height: args.viewportHeight / args.camera.zoom,
  };
}

export function fnClampWidgetFrameToViewport(args: {
  point: TWorldPoint;
  bounds: TWidgetFrameBounds;
  viewport: TWorldViewport;
}): TWidgetWorldBounds {
  const maxX = args.viewport.x + Math.max(0, args.viewport.width - args.bounds.width);
  const maxY = args.viewport.y + Math.max(0, args.viewport.height - args.bounds.height);
  return {
    x: Math.min(maxX, Math.max(args.viewport.x, args.point.x)),
    y: Math.min(maxY, Math.max(args.viewport.y, args.point.y)),
    width: args.bounds.width,
    height: args.bounds.height,
  };
}
