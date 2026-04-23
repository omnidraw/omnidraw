import type { IPlugin } from "@vibecanvas/runtime";
import type { ContextMenuService } from "../../services/context-menu/ContextMenuService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { IRuntimeHooks } from "../../types";

function hasSameParent(selection: Parameters<RenderOrderService["bringSelectionToFront"]>[0]) {
  return selection.length <= 1 || selection.every((node) => node.getParent() === selection[0]?.getParent());
}

export function createRenderOrderPlugin(): IPlugin<{
  contextMenu: ContextMenuService;
  renderOrder: RenderOrderService;
}, IRuntimeHooks> {
  return {
    name: "render-order",
    apply(ctx) {
    },
  };
}
