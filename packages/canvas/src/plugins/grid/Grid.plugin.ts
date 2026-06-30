import type { IPlugin } from "@vibecanvas/runtime";
import Konva from "konva";
import Grid2x2 from "lucide-static/icons/grid-2x2.svg?raw";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import { txDrawGrid } from "./tx.draw";

export function createGridPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  let visible = true;

  return {
    name: "grid",
    apply(ctx) {
      const tool = ctx.services.require("tool");
      const scene = ctx.services.require("scene");
      const camera = ctx.services.require("camera");
      const theme = ctx.services.require("theme");

      ctx.hooks.init.tap(() => {
        const gridShape = new Konva.Shape({
          listening: false,
          sceneFunc: (shapeContext: Konva.Context) => {
            if (!visible) return;

            const width = scene.stage.width();
            const height = scene.stage.height();
            if (width <= 0 || height <= 0) return;

            const activeTheme = theme.getTheme();

            txDrawGrid({ shapeContext }, {
              width,
              height,
              zoom: camera.zoom,
              x: camera.x,
              y: camera.y,
              minorGridColor: activeTheme.colors.canvasGridMinor,
              majorGridColor: activeTheme.colors.canvasGridMajor,
            });
          },
        });

        tool.registerTool({
          id: "grid",
          label: "Grid",
          icon: Grid2x2,
          shortcuts: ["g"],
          priority: 9000,
          active: visible,
          onSelect: () => {
            ctx.hooks.gridVisible.call(!visible);
          },
          behavior: { type: "action" },
        });

        scene.staticBackgroundLayer.add(gridShape);
        scene.staticBackgroundLayer.batchDraw();
      });

      camera.hooks.change.tap(() => {
        scene.staticBackgroundLayer.batchDraw();
      });

      theme.hooks.change.tap(() => {
        scene.staticBackgroundLayer.batchDraw();
      });

      scene.hooks.resize.tap(() => {
        scene.staticBackgroundLayer.batchDraw();
      });

      ctx.hooks.gridVisible.tap((value) => {
        visible = value;
        scene.staticBackgroundLayer.batchDraw();
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool("grid");
      });
    },
  };
}
