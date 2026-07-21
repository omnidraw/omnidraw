import type { IPlugin } from "@vibecanvas/runtime";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import { fnGetHandLayerStyle } from "./fn.get-hand-layer-style";
import { fnGetPointerDelta } from "./fn.get-pointer-delta";
import { fxReadCameraStateFromLocalStorage } from "./fx.read-camera-state-from-localstorage";
import { txSyncHandLayer } from "./tx.sync-hand-layer";
import { txWriteCameraStateToLocalStorage } from "./tx.write-camera-state-to-localstorage";
import { fnBrowserTenantStorageKeys } from "../../fn.browser-tenant-scope";

const ZOOM_STEP = 1.03;

function getDefaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Owns camera pan and zoom input behavior.
 * Keeps hand-drag overlay local to camera control behavior.
 */
export function createCameraControlPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  let handLayer: HTMLDivElement | null = null;
  let isHandDragging = false;
  let activePointerId: number | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let activeTool = "select";
  let offCameraChange: (() => boolean) | null = null;

  function isHandTool() {
    return activeTool === "hand";
  }

  function resetHandState() {
    isHandDragging = false;
    activePointerId = null;
    lastPointer = null;

    if (handLayer) {
      const style = fnGetHandLayerStyle({
        isHandTool: isHandTool(),
        isHandDragging,
      });
      txSyncHandLayer({ handLayer }, style);
    }
  }

  function syncHandLayer() {
    if (!handLayer) {
      return;
    }

    const handMode = isHandTool();
    if (!handMode) {
      if (
        activePointerId !== null
        && typeof handLayer.hasPointerCapture === "function"
        && typeof handLayer.releasePointerCapture === "function"
        && handLayer.hasPointerCapture(activePointerId)
      ) {
        handLayer.releasePointerCapture(activePointerId);
      }
      resetHandState();
    }

    const style = fnGetHandLayerStyle({
      isHandTool: handMode,
      isHandDragging,
    });
    txSyncHandLayer({ handLayer }, style);
  }

  return {
    name: "camera-control",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const render = ctx.services.require("scene");
      const storage = getDefaultStorage();
      const storageKey = fnBrowserTenantStorageKeys(ctx.config.tenant).cameraViewports;
      const restoredViewport = fxReadCameraStateFromLocalStorage({ storage }, {
        canvasId: ctx.config.canvasId,
        storageKey,
      });

      if (restoredViewport) {
        camera.setViewport(restoredViewport, { emitChange: false });
      }

      offCameraChange = camera.hooks.change.tap(() => {
        txWriteCameraStateToLocalStorage({ storage }, {
          canvasId: ctx.config.canvasId,
          storageKey,
          viewport: {
            x: camera.x,
            y: camera.y,
            zoom: camera.zoom,
          },
        });
      });

      ctx.hooks.init.tap(() => {
        handLayer = document.createElement("div");
        handLayer.id = "hand-layer";
        Object.assign(handLayer.style, {
          position: "absolute",
          inset: 0,
          display: "none",
          pointerEvents: "none",
          background: "transparent",
          zIndex: "20",
          cursor: "grab",
          touchAction: "none",
        });

        const onHandPointerDown = (event: PointerEvent) => {
          if (!isHandTool()) return;

          event.preventDefault();
          isHandDragging = true;
          activePointerId = event.pointerId;
          lastPointer = { x: event.clientX, y: event.clientY };
          if (handLayer && typeof handLayer.setPointerCapture === "function") {
            handLayer.setPointerCapture(event.pointerId);
          }

          if (handLayer) {
            handLayer.style.cursor = "grabbing";
          }
        };

        const onHandPointerMove = (event: PointerEvent) => {
          if (!isHandDragging) return;
          if (activePointerId !== event.pointerId) return;
          if (!lastPointer) return;

          event.preventDefault();

          const nextPointer = { x: event.clientX, y: event.clientY };
          const { deltaX, deltaY } = fnGetPointerDelta({
            lastPointer,
            nextPointer,
          });
          lastPointer = nextPointer;

          camera.pan(-deltaX, -deltaY);
        };

        const onHandPointerUp = (event: PointerEvent) => {
          if (activePointerId !== event.pointerId) return;

          event.preventDefault();
          resetHandState();
        };

        const onHandLostPointerCapture = () => {
          resetHandState();
        };

        render.stage.container().appendChild(handLayer);
        handLayer.addEventListener("pointerdown", onHandPointerDown);
        handLayer.addEventListener("pointermove", onHandPointerMove);
        handLayer.addEventListener("pointerup", onHandPointerUp);
        handLayer.addEventListener("pointercancel", onHandPointerUp);
        handLayer.addEventListener("lostpointercapture", onHandLostPointerCapture);
        syncHandLayer();

        ctx.hooks.destroy.tap(() => {
          if (
            handLayer
            && activePointerId !== null
            && typeof handLayer.hasPointerCapture === "function"
            && typeof handLayer.releasePointerCapture === "function"
            && handLayer.hasPointerCapture(activePointerId)
          ) {
            handLayer.releasePointerCapture(activePointerId);
          }

          resetHandState();
          handLayer?.removeEventListener("pointerdown", onHandPointerDown);
          handLayer?.removeEventListener("pointermove", onHandPointerMove);
          handLayer?.removeEventListener("pointerup", onHandPointerUp);
          handLayer?.removeEventListener("pointercancel", onHandPointerUp);
          handLayer?.removeEventListener("lostpointercapture", onHandLostPointerCapture);
          handLayer?.remove();
          handLayer = null;
        });
      });

      ctx.hooks.toolSelect.tap((tool) => {
        activeTool = tool;
        syncHandLayer();
      });

      ctx.hooks.pointerWheel.tap((event) => {
        if (event.evt.ctrlKey) {
          const pointer = render.stage.getPointerPosition();
          if (!pointer) return;

          event.evt.preventDefault();

          const direction = event.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
          camera.zoomAtScreenPoint(camera.zoom * direction, pointer);
          return;
        }

        event.evt.preventDefault();
        camera.pan(event.evt.deltaX, event.evt.deltaY);
      });

      ctx.hooks.destroy.tap(() => {
        offCameraChange?.();
        offCameraChange = null;
      });
    },
  };
}
