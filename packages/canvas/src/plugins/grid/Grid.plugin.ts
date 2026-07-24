import type { IPlugin } from "@vibecanvas/runtime";
import Grid2x2 from "lucide-static/icons/grid-2x2.svg?raw";
import type { SceneService } from "../../services/scene/SceneService";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";

/**
 * Temporary narrow scene seam until grid visibility is part of SceneService's
 * stable product projection API.
 */
export type TGridVisibilityScenePort = SceneService & {
  setGridVisible?(visible: boolean): void;
};

export function createGridPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "grid",
    apply(ctx) {
      const scene = ctx.services.require("scene") as TGridVisibilityScenePort;
      const tool = ctx.services.require("tool");
      let visible = true;

      const syncVisibility = () => {
        scene.setGridVisible?.(visible);
      };
      tool.registerTool({
        id: "grid",
        label: "Grid",
        icon: Grid2x2,
        shortcuts: ["g"],
        priority: 9_000,
        active: visible,
        onSelect: () => {
          ctx.hooks.gridVisible.call(!visible);
        },
        behavior: { type: "action" },
      });
      ctx.hooks.init.tap(syncVisibility);
      ctx.hooks.gridVisible.tap((nextVisible) => {
        visible = nextVisible;
        syncVisibility();
      });
      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool("grid");
      });
    },
  };
}
