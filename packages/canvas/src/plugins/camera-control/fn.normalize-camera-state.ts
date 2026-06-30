import type { TCameraViewport } from "../../services/camera/CameraService";
import { DEFAULT_CAMERA_VIEWPORT, MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM } from "./CONSTANTS";

export type TArgsNormalizeCameraState = {
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampZoom(zoom: number) {
  return Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, zoom));
}

export function fnNormalizeCameraState(args: TArgsNormalizeCameraState): TCameraViewport {
  if (!isRecord(args.value)) {
    return { ...DEFAULT_CAMERA_VIEWPORT };
  }

  const { x, y, zoom } = args.value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom)) {
    return { ...DEFAULT_CAMERA_VIEWPORT };
  }

  return {
    x,
    y,
    zoom: clampZoom(zoom),
  };
}
