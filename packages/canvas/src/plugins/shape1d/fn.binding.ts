import type { TBinding } from "@vibecanvas/service-automerge/types/canvas-doc.types";

type TPoint = {
  x: number;
  y: number;
};

type TBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function fnClampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function fnShape1dBinding(args: {
  targetId: string;
  worldPoint: TPoint;
  worldBounds: TBounds;
}): TBinding | null {
  const width = args.worldBounds.maxX - args.worldBounds.minX;
  const height = args.worldBounds.maxY - args.worldBounds.minY;
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  return {
    targetId: args.targetId,
    anchor: {
      x: fnClampUnit(
        (args.worldPoint.x - args.worldBounds.minX) / width,
      ),
      y: fnClampUnit(
        (args.worldPoint.y - args.worldBounds.minY) / height,
      ),
    },
  };
}

export function fnShape1dBindingWorldPoint(args: {
  binding: TBinding;
  worldBounds: TBounds;
}): TPoint {
  return {
    x: args.worldBounds.minX
      + (args.worldBounds.maxX - args.worldBounds.minX)
      * fnClampUnit(args.binding.anchor.x),
    y: args.worldBounds.minY
      + (args.worldBounds.maxY - args.worldBounds.minY)
      * fnClampUnit(args.binding.anchor.y),
  };
}
