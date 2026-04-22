import type { Group } from "konva/lib/Group";
import type { Node } from "konva/lib/Node";
import type { Shape, ShapeConfig } from "konva/lib/Shape";
import { fnIsCanvasNode } from "../../core/fn.canvas-node-semantics";
import type { SceneService } from "../../services/scene/SceneService";

export type TArgsGetSelectionPath = {
  scene: SceneService;
  node: Group | Shape<ShapeConfig>;
};

export function fnGetSelectionPath(args: TArgsGetSelectionPath) {
  const path: Array<Group | Shape<ShapeConfig>> = [];
  let current: Node | null = args.node;

  while (current && current !== args.scene.staticForegroundLayer) {
    if (fnIsCanvasNode(current)) {
      path.push(current as Group | Shape<ShapeConfig>);
    }

    current = current.getParent();
  }

  return path.reverse();
}
