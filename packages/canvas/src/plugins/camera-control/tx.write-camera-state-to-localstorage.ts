import type { TCameraViewport } from "../../services/camera/CameraService";

export type TPortalWriteCameraState = {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
};

export type TArgsWriteCameraState = {
  canvasId: string;
  storageKey: string;
  viewport: TCameraViewport;
};

type TStoredCameraViewportMap = Record<string, TCameraViewport>;

export function txWriteCameraStateToLocalStorage(portal: TPortalWriteCameraState, args: TArgsWriteCameraState) {
  if (portal.storage === null) {
    return;
  }

  try {
    const rawValue = portal.storage.getItem(args.storageKey);
    const storedViewports = rawValue ? JSON.parse(rawValue) : {};
    const nextStoredViewports = (
      storedViewports && typeof storedViewports === "object" ? storedViewports : {}
    ) as TStoredCameraViewportMap;

    nextStoredViewports[args.canvasId] = args.viewport;
    portal.storage.setItem(args.storageKey, JSON.stringify(nextStoredViewports));
  } catch {
    return;
  }
}
