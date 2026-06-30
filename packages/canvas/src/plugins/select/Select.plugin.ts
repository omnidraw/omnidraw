import type { IPlugin } from "@vibecanvas/runtime";
import Konva from "konva";
import type { Node } from "konva/lib/Node";
import type {
  SceneService
} from "../../services";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import { txDeleteSelection } from "./tx.delete-selection";
import { txHandleElementPointerDoubleClick } from "./tx.handle-element-pointer-double-click";
import { txHandleElementPointerDown } from "./tx.handle-element-pointer-down";
import { txHandleStagePointerMove } from "./tx.handle-stage-pointer-move";

function hasSameSelectionOrder(
  currentSelection: Array<{ id(): string }>,
  nextSelection: Array<{ id(): string }>,
) {
  if (currentSelection.length !== nextSelection.length) {
    return false;
  }

  return currentSelection.every((node, index) => node.id() === nextSelection[index]?.id());
}

function getSelectionLayerPointerPosition(render: SceneService) {
  return render.dynamicLayer.getRelativePointerPosition();
}

function isEditableTarget(target: EventTarget | null) {
  if (target instanceof HTMLInputElement) {
    return true;
  }

  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  return false;
}

function txHandleStagePointerDown(args: {
  scene: SceneService;
  selection: SelectionService;
  selectionRectangle: Konva.Rect;
  event: { target: Node };
}) {
  if (args.selection.isSelectionHandlingSuppressed()) {
    return;
  }

  const pointer = getSelectionLayerPointerPosition(args.scene);
  if (!pointer) {
    return;
  }

  if (args.event.target !== args.scene.stage) {
    return;
  }

  args.selectionRectangle.visible(true);
  args.selectionRectangle.position(pointer);
  args.selectionRectangle.size({ width: 0, height: 0 });
  args.selectionRectangle.moveToTop();
  args.selection.clear();
}


/**
 * Owns selection rules for click, drill-down, and marquee selection.
 * Uses SelectionService as the shared runtime state.
 */
export function createSelectPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "select",
    apply(ctx) {
      const element = ctx.services.require("element");
      const group = ctx.services.require("group");
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const renderOrder = ctx.services.require("renderOrder");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      const selectionRectangle = new Konva.Rect({
        visible: false,
        strokeWidth: 1,
        dash: [6, 4],
        listening: false,
      });

      const syncSelectionRectangleTheme = () => {
        const activeTheme = theme.getTheme();
        selectionRectangle.fill(activeTheme.colors.canvasSelectionFill);
        selectionRectangle.stroke(activeTheme.colors.canvasSelectionStroke);
      };

      ctx.hooks.init.tap(() => {
        syncSelectionRectangleTheme();
        scene.dynamicLayer.add(selectionRectangle);
      });

      theme.hooks.change.tap(() => {
        syncSelectionRectangleTheme();
        scene.dynamicLayer.batchDraw();
      });

      contextMenu.registerProvider("delete-selection", ({ scope, activeSelection }) => {
        if (scope === "canvas" || activeSelection.length === 0) {
          return [];
        }

        return [{
          id: "delete-selection",
          label: "Delete",
          priority: 300,
          onSelect: () => {
            selection.setSelection(activeSelection);
            txDeleteSelection({ element, group, crdt, history, scene, renderOrder, selection }, {});
          },
        }];
      });

      ctx.hooks.elementPointerDown.tap((event) => {
        if (selection.mode !== CanvasMode.SELECT) {
          return false;
        }

        if (event.evt.button !== 0) {
          return false;
        }

        if (selection.isSelectionHandlingSuppressed()) {
          return true;
        }

        return txHandleElementPointerDown({ scene, selection, hasSameSelectionOrder }, { event });
      });

      ctx.hooks.elementPointerDoubleClick.tap((event) => {
        if (selection.mode !== CanvasMode.SELECT) {
          return false;
        }

        if (selection.isSelectionHandlingSuppressed()) {
          return true;
        }

        return txHandleElementPointerDoubleClick({ scene, selection, hasSameSelectionOrder }, { event });
      });

      ctx.hooks.pointerDown.tap((event) => {
        if (selection.mode !== CanvasMode.SELECT) {
          return;
        }

        if (event.evt.button !== 0) {
          return;
        }

        if (selection.isSelectionHandlingSuppressed()) {
          return;
        }

        txHandleStagePointerDown({
          scene: scene,
          selection,
          selectionRectangle,
          event,
        });
      });

      ctx.hooks.pointerMove.tap((event) => {
        if (selection.mode !== CanvasMode.SELECT) {
          return;
        }

        if (!selectionRectangle.visible()) {
          return;
        }

        txHandleStagePointerMove(
          {
            Group: Konva.Group,
            Shape: Konva.Shape,
            Util: Konva.Util,
            scene,
            selection,
            selectionRectangle,
            hasSameSelectionOrder,
          },
          { pointer: getSelectionLayerPointerPosition(scene) },
        );
      });

      ctx.hooks.pointerUp.tap(() => {
        if (selection.mode !== CanvasMode.SELECT) {
          return;
        }

        selectionRectangle.visible(false);
      });

      ctx.hooks.keydown.tap((event) => {
        if (selection.mode !== CanvasMode.SELECT) {
          return;
        }

        if (selection.selection.length === 0) {
          return;
        }

        if (event.key !== "Backspace" && event.key !== "Delete") {
          return;
        }

        if (isEditableTarget(event.target)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        txDeleteSelection({ element, group, crdt, history, scene, renderOrder, selection }, {});
      });

      ctx.hooks.destroy.tap(() => {
        contextMenu.unregisterProvider("delete-selection");
      });
    },
  };
}
