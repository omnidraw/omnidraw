import type Konva from "konva";
import { isKonvaGroup, isKonvaShape } from "../../core/GUARDS";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import { fnIsSceneNode } from "./fn.scene-node";

export type TPortalSyncDraggability = {
  scene: SceneService;
  selection: SelectionService;
};

export type TArgsSyncDraggability = Record<string, never>;

export function txSyncDraggability(
  portal: TPortalSyncDraggability,
  args: TArgsSyncDraggability,
) {
  const allSceneNodes = portal.scene.staticForegroundLayer.find((node: Konva.Node) => {
    return fnIsSceneNode({ render: portal.scene, node });
  });

  allSceneNodes.forEach((node) => {
    if (isKonvaGroup(node.getParent())) {
      node.draggable(false);
    }
  });

  portal.scene.staticForegroundLayer.getChildren().forEach((node) => {
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
