import type { IPlugin } from "@vibecanvas/runtime";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";

function cameraLine(x: number, y: number, zoom: number): string {
  return `x=${Math.round(x)} y=${Math.round(y)} zoom=${zoom.toFixed(2)}`;
}

/**
 * DOM-only debug readout backed by canvas-owned state and metrics.
 */
export function createVisualDebugPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "visual-debug",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      let element: HTMLPreElement | null = null;
      const disposers: Array<() => unknown> = [];

      const sync = () => {
        if (element === null) {
          return;
        }
        const metrics = scene.metricsSnapshot();
        const targets = selection.selection.map((target) => {
          return `${target.kind}:${target.id}`;
        });
        element.textContent = [
          cameraLine(camera.x, camera.y, camera.zoom),
          `selection [${targets.join(", ")}]`,
          `focused ${
            selection.focused === null
              ? "null"
              : `${selection.focused.kind}:${selection.focused.id}`
          }`,
          `sceneRevision ${metrics.sceneRevision}`,
          `frames ${metrics.frameCount}`,
        ].join("\n");
        element.style.color = theme.getTheme().colors.canvasDebugText;
      };

      ctx.hooks.init.tap(() => {
        element = scene.container.ownerDocument.createElement("pre");
        element.id = "canvas-visual-debug";
        Object.assign(element.style, {
          position: "absolute",
          left: "12px",
          bottom: "12px",
          margin: "0",
          font: "12px/1.4 monospace",
          pointerEvents: "none",
          zIndex: "30",
        });
        scene.container.appendChild(element);
        disposers.push(
          camera.hooks.change.tap(sync),
          selection.hooks.change.tap(sync),
          theme.hooks.change.tap(sync),
          scene.hooks.resize.tap(sync),
          scene.hooks.projection.tap(sync),
          scene.hooks.diagnostic.tap(sync),
        );
        sync();
      });

      ctx.hooks.destroy.tap(() => {
        for (const dispose of disposers.splice(0).reverse()) {
          dispose();
        }
        element?.remove();
        element = null;
      });
    },
  };
}
