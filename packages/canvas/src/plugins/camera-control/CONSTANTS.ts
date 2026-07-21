import type { TCameraViewport } from "../../services/camera/CameraService";
import { LOCAL_BROWSER_TENANT_SCOPE } from "../../CONSTANTS";
import { fnBrowserTenantStorageKeys } from "../../fn.browser-tenant-scope";

export const CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY = fnBrowserTenantStorageKeys(
  LOCAL_BROWSER_TENANT_SCOPE,
).cameraViewports;
export const MIN_CAMERA_ZOOM = 0.1;
export const MAX_CAMERA_ZOOM = 6;
export const DEFAULT_CAMERA_VIEWPORT: TCameraViewport = {
  x: 0,
  y: 0,
  zoom: 1,
};
