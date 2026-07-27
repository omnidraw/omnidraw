import type { TPortalGeometry } from "@omnidraw/cangine";
import type { TCanvasPortalViewportState } from "../typed";

type TArgs = Readonly<{
  geometry: TPortalGeometry;
  portalSize: Readonly<{
    width: number;
    height: number;
  }>;
  canvasSize: Readonly<{
    width: number;
    height: number;
  }>;
  visible: boolean;
}>;

function fnFiniteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function fnAxisDistance(
  minimum: number,
  maximum: number,
  viewportMaximum: number,
): number {
  if (maximum < 0) {
    return -maximum;
  }
  if (minimum > viewportMaximum) {
    return minimum - viewportMaximum;
  }
  return 0;
}

function fnIntersectionLength(
  minimum: number,
  maximum: number,
  viewportMaximum: number,
): number {
  return Math.max(
    0,
    Math.min(maximum, viewportMaximum) - Math.max(minimum, 0),
  );
}

export function fnCanvasPortalInitialViewportState(): TCanvasPortalViewportState {
  return Object.freeze({
    width: 0,
    height: 0,
    scale: 1,
    visible: false,
    distance: 0,
    occlusion: 1,
    interactive: false,
  });
}

export function fnCanvasPortalViewportState(
  args: TArgs,
): TCanvasPortalViewportState {
  const bounds = args.geometry.viewportBounds;
  const canvasWidth = fnFiniteNonNegative(args.canvasSize.width);
  const canvasHeight = fnFiniteNonNegative(args.canvasSize.height);
  const distanceX = fnAxisDistance(bounds.minX, bounds.maxX, canvasWidth);
  const distanceY = fnAxisDistance(bounds.minY, bounds.maxY, canvasHeight);
  const boundsWidth = fnFiniteNonNegative(bounds.maxX - bounds.minX);
  const boundsHeight = fnFiniteNonNegative(bounds.maxY - bounds.minY);
  const boundsArea = boundsWidth * boundsHeight;
  const visibleArea = fnIntersectionLength(
    bounds.minX,
    bounds.maxX,
    canvasWidth,
  ) * fnIntersectionLength(
    bounds.minY,
    bounds.maxY,
    canvasHeight,
  );
  const matrix = args.geometry.viewportMatrix;
  const xScale = Math.hypot(matrix[0], matrix[1]);
  const yScale = Math.hypot(matrix[3], matrix[4]);
  const canvasScale = Math.sqrt(xScale * yScale);
  const scale = fnFiniteNonNegative(
    canvasScale * args.geometry.devicePixelRatio,
  );

  return Object.freeze({
    width: fnFiniteNonNegative(args.portalSize.width),
    height: fnFiniteNonNegative(args.portalSize.height),
    scale: scale > 0 ? scale : 1,
    visible: args.visible,
    distance: fnFiniteNonNegative(Math.hypot(distanceX, distanceY)),
    occlusion: args.visible && boundsArea > 0
      ? Math.max(0, Math.min(1, 1 - (visibleArea / boundsArea)))
      : 1,
    interactive: args.visible && args.geometry.interactive,
  });
}
