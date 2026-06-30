import type { TCameraViewport } from "../../services/camera/CameraService";

export const CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY = "vibecanvas:camera:viewports";
export const MIN_CAMERA_ZOOM = 0.25;
export const MAX_CAMERA_ZOOM = 4;
export const DEFAULT_CAMERA_VIEWPORT: TCameraViewport = {
  x: 0,
  y: 0,
  zoom: 1,
};
