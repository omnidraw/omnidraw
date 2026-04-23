import type Konva from "konva";
import type { CanvasRegistryService } from "../../services/canvas-registry/CanvasRegistryService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import { isKonvaGroup, isKonvaShape } from "../../core/GUARDS";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import { fnIsSceneNode } from "./fn.scene-node";

export type TPortalSyncDraggability = {
  Konva: typeof Konva;
  canvasRegistry: CanvasRegistryService;
  render: SceneService;
  selection: SelectionService;
};

export type TArgsSyncDraggability = Record<string, never>;

export function txSyncDraggability(
  portal: TPortalSyncDraggability,
  args: TArgsSyncDraggability,
) {
  const allSceneNodes = portal.render.staticForegroundLayer.find((node: Konva.Node) => {
    return fnIsSceneNode({ render: portal.render, node });
  });

  allSceneNodes.forEach((node) => {
    if (isKonvaGroup(node.getParent())) {
      node.draggable(false);
    }
  });

  portal.render.staticForegroundLayer.getChildren().forEach((node) => {
    if (isKonvaGroup(node) || isKonvaShape(node)) {
      node.draggable(true);
    }
  });

  const activeNodes = fnFilterSelection({
    selection: portal.selection.selection,
  });

  activeNodes.forEach((node) => {
    node.draggable(true);
  });

  void args;
}
