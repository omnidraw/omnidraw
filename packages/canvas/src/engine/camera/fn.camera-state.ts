import type {
  TCamera2DState,
  TSize2,
  TVec2,
} from "@omnidraw/cangine";
import {
  CANVAS_CAMERA_DEFAULT_ROTATION_DEGREES,
  CANVAS_CAMERA_MAX_ZOOM,
  CANVAS_CAMERA_MIN_ZOOM,
} from "./CONSTANTS";
import type {
  TCanvasCameraZoomConstraints,
  TCanvasLegacyCameraViewport,
} from "./typed";

type TArgsAngleDegrees = {
  degrees: number;
};

type TArgsAngleRadians = {
  radians: number;
};

type TArgsClampZoom = TCanvasCameraZoomConstraints & {
  zoom: number;
};

type TArgsLegacyViewportToEngineCamera = TCanvasCameraZoomConstraints & {
  viewport: TCanvasLegacyCameraViewport;
  viewportSize: TSize2;
  rotationDegrees?: number;
};

type TArgsEngineCameraToLegacyViewport = TCanvasCameraZoomConstraints & {
  state: TCamera2DState;
  viewportSize: TSize2;
};

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
}

function assertFinitePoint(point: TVec2, label: string): void {
  assertFinite(point.x, `${label}.x`);
  assertFinite(point.y, `${label}.y`);
}

function assertViewportSize(viewportSize: TSize2): void {
  assertFinite(viewportSize.width, "viewportSize.width");
  assertFinite(viewportSize.height, "viewportSize.height");
  if (viewportSize.width < 0 || viewportSize.height < 0) {
    throw new RangeError("Viewport dimensions must be non-negative.");
  }
}

function constraints(args: TCanvasCameraZoomConstraints): {
  minZoom: number;
  maxZoom: number;
} {
  const minZoom = args.minZoom ?? CANVAS_CAMERA_MIN_ZOOM;
  const maxZoom = args.maxZoom ?? CANVAS_CAMERA_MAX_ZOOM;
  assertFinite(minZoom, "minZoom");
  assertFinite(maxZoom, "maxZoom");
  if (minZoom <= 0 || maxZoom < minZoom) {
    throw new RangeError("Camera zoom constraints must satisfy 0 < minZoom <= maxZoom.");
  }
  return { minZoom, maxZoom };
}

function rotateClockwise(point: TVec2, radians: number): TVec2 {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const result = {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  };
  assertFinitePoint(result, "rotated camera point");
  return result;
}

export function fnCanvasCameraDegreesToRadians(
  args: TArgsAngleDegrees,
): number {
  assertFinite(args.degrees, "rotationDegrees");
  const radians = args.degrees * Math.PI / 180;
  assertFinite(radians, "camera rotation");
  return radians;
}

export function fnCanvasCameraRadiansToDegrees(
  args: TArgsAngleRadians,
): number {
  assertFinite(args.radians, "camera rotation");
  const degrees = args.radians * 180 / Math.PI;
  assertFinite(degrees, "rotationDegrees");
  return degrees;
}

export function fnClampCanvasCameraZoom(args: TArgsClampZoom): number {
  assertFinite(args.zoom, "camera zoom");
  const { minZoom, maxZoom } = constraints(args);
  return Math.min(maxZoom, Math.max(minZoom, args.zoom));
}

/**
 * Legacy x/y are the viewport-space position of world origin. Engine camera
 * center is the world point placed at viewport center.
 */
export function fnLegacyViewportToEngineCamera(
  args: TArgsLegacyViewportToEngineCamera,
): TCamera2DState {
  assertFinite(args.viewport.x, "legacy viewport x");
  assertFinite(args.viewport.y, "legacy viewport y");
  assertViewportSize(args.viewportSize);
  const zoom = fnClampCanvasCameraZoom({
    zoom: args.viewport.zoom,
    ...(args.minZoom === undefined ? {} : { minZoom: args.minZoom }),
    ...(args.maxZoom === undefined ? {} : { maxZoom: args.maxZoom }),
  });
  const rotation = fnCanvasCameraDegreesToRadians({
    degrees: args.rotationDegrees ?? CANVAS_CAMERA_DEFAULT_ROTATION_DEGREES,
  });
  const unrotatedCenter = {
    x: (args.viewportSize.width / 2 - args.viewport.x) / zoom,
    y: (args.viewportSize.height / 2 - args.viewport.y) / zoom,
  };
  assertFinitePoint(unrotatedCenter, "unrotated camera center");
  const center = rotateClockwise(unrotatedCenter, rotation);
  return {
    center,
    zoom,
    rotation,
  };
}

export function fnEngineCameraToLegacyViewport(
  args: TArgsEngineCameraToLegacyViewport,
): TCanvasLegacyCameraViewport {
  assertFinitePoint(args.state.center, "camera center");
  assertViewportSize(args.viewportSize);
  assertFinite(args.state.rotation, "camera rotation");
  const zoom = fnClampCanvasCameraZoom({
    zoom: args.state.zoom,
    ...(args.minZoom === undefined ? {} : { minZoom: args.minZoom }),
    ...(args.maxZoom === undefined ? {} : { maxZoom: args.maxZoom }),
  });
  const unrotatedCenter = rotateClockwise(
    args.state.center,
    -args.state.rotation,
  );
  const viewport = {
    x: args.viewportSize.width / 2 - zoom * unrotatedCenter.x,
    y: args.viewportSize.height / 2 - zoom * unrotatedCenter.y,
    zoom,
  };
  assertFinite(viewport.x, "legacy viewport x");
  assertFinite(viewport.y, "legacy viewport y");
  return viewport;
}
