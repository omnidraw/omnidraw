import type { IPlugin } from "@vibecanvas/runtime";
import { fnBrowserTenantStorageKeys } from "../../fn.browser-tenant-scope";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";
import { fxReadCameraStateFromLocalStorage } from "./fx.read-camera-state-from-localstorage";
import { txWriteCameraStateToLocalStorage } from "./tx.write-camera-state-to-localstorage";

const ZOOM_STEP = 1.03;
const POINTER_OWNER = "camera-control:hand";

function readStorage(container: HTMLDivElement): Storage | null {
  try {
    return container.ownerDocument.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Normalized input owner for hand pan, wheel pan/zoom, and persistence.
 */
export function createCameraControlPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "camera-control",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const scene = ctx.services.require("scene");
      const tool = ctx.services.require("tool");
      const storage = readStorage(scene.container);
      const storageKey = fnBrowserTenantStorageKeys(
        ctx.config.tenant,
      ).cameraViewports;
      const restoredViewport = fxReadCameraStateFromLocalStorage(
        { storage },
        {
          canvasId: ctx.config.canvasId,
          storageKey,
        },
      );
      let activeTool = tool.activeToolId;
      let activePointerId: number | null = null;

      const releasePointer = () => {
        if (activePointerId === null) {
          return;
        }
        scene.input.releasePointer(activePointerId, POINTER_OWNER);
        activePointerId = null;
      };

      const offCameraChange = camera.hooks.change.tap(() => {
        txWriteCameraStateToLocalStorage(
          { storage },
          {
            canvasId: ctx.config.canvasId,
            storageKey,
            viewport: {
              x: camera.x,
              y: camera.y,
              zoom: camera.zoom,
            },
          },
        );
      });

      ctx.hooks.init.tap(() => {
        if (restoredViewport !== null) {
          camera.setViewport(restoredViewport, { emitChange: false });
        }
      });

      ctx.hooks.toolSelect.tap((toolId) => {
        activeTool = toolId;
        if (toolId !== "hand") {
          releasePointer();
        }
      });

      ctx.hooks.pointerDown.tap((event) => {
        if (
          activeTool !== "hand"
          || event.button !== 0
          || activePointerId !== null
        ) {
          return;
        }
        activePointerId = event.pointerId;
        scene.input.capturePointer(event.pointerId, POINTER_OWNER);
      });

      ctx.hooks.pointerMove.tap((event) => {
        if (
          activeTool !== "hand"
          || event.pointerId !== activePointerId
        ) {
          return;
        }
        camera.pan(
          -event.deltaViewport.x,
          -event.deltaViewport.y,
        );
      });

      const finishPointer = (pointerId: number) => {
        if (pointerId === activePointerId) {
          releasePointer();
        }
      };
      ctx.hooks.pointerUp.tap((event) => {
        finishPointer(event.pointerId);
      });
      ctx.hooks.pointerCancel.tap((event) => {
        finishPointer(event.pointerId);
      });

      ctx.hooks.pointerWheel.tap((event) => {
        if (event.modifiers.control) {
          const direction = event.delta.y > 0
            ? 1 / ZOOM_STEP
            : ZOOM_STEP;
          camera.zoomAtScreenPoint(
            camera.zoom * direction,
            event.viewport,
          );
          return;
        }
        camera.pan(event.delta.x, event.delta.y);
      });

      ctx.hooks.destroy.tap(() => {
        releasePointer();
        offCameraChange();
      });
    },
  };
}
