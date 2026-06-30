import type { TCameraViewport } from "../../services/camera/CameraService";
import { CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY } from "./CONSTANTS";

export type TPortalWriteCameraState = {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
};

export type TArgsWriteCameraState = {
  canvasId: string;
  viewport: TCameraViewport;
};

type TStoredCameraViewportMap = Record<string, TCameraViewport>;

export function txWriteCameraStateToLocalStorage(portal: TPortalWriteCameraState, args: TArgsWriteCameraState) {
  if (portal.storage === null) {
    return;
  }

  try {
    const rawValue = portal.storage.getItem(CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY);
    const storedViewports = rawValue ? JSON.parse(rawValue) : {};
    const nextStoredViewports = (
      storedViewports && typeof storedViewports === "object" ? storedViewports : {}
    ) as TStoredCameraViewportMap;

    nextStoredViewports[args.canvasId] = args.viewport;
    portal.storage.setItem(CAMERA_VIEWPORTS_LOCAL_STORAGE_KEY, JSON.stringify(nextStoredViewports));
  } catch {
    return;
  }
}
