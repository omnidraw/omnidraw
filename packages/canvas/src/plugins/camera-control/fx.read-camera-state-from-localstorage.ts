import type { TCameraViewport } from "../../services/camera/CameraService";
import { fnNormalizeCameraState } from "./fn.normalize-camera-state";

export type TPortalReadCameraState = {
  storage: Pick<Storage, "getItem"> | null;
};

export type TArgsReadCameraState = {
  canvasId: string;
  storageKey: string;
};

type TStoredCameraViewportMap = Record<string, unknown>;

export function fxReadCameraStateFromLocalStorage(portal: TPortalReadCameraState, args: TArgsReadCameraState): TCameraViewport | null {
  if (portal.storage === null) {
    return null;
  }

  try {
    const rawValue = portal.storage.getItem(args.storageKey);
    if (rawValue === null) {
      return null;
    }

    const storedViewports = JSON.parse(rawValue) as TStoredCameraViewportMap | null;
    if (!storedViewports || typeof storedViewports !== "object") {
      return fnNormalizeCameraState({ value: null });
    }

    if (!(args.canvasId in storedViewports)) {
      return null;
    }

    return fnNormalizeCameraState({ value: storedViewports[args.canvasId] });
  } catch {
    return fnNormalizeCameraState({ value: null });
  }
}
