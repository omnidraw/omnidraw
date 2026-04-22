import type Konva from "konva";
import type { Node } from "konva/lib/Node";
import type { Shape, ShapeConfig } from "konva/lib/Shape";
import { isKonvaGroup, isKonvaLayer, isKonvaShape } from "../../core/GUARDS";
import type { SceneService } from "../../services/scene/SceneService";

export type TSceneNode = Konva.Group | Shape<ShapeConfig>;

export type TArgsIsSceneNode = {
  scene: SceneService;
  node: Node | null | undefined;
};

export function fnIsSceneNode(args: TArgsIsSceneNode): args is TArgsIsSceneNode & { node: TSceneNode } {
  return Boolean(args.node) && (isKonvaGroup(args.node) || isKonvaShape(args.node));
}

export type TArgsIsSceneParent = {
  scene: SceneService;
  node: Node | null | undefined;
};

export function fnIsSceneParent(args: TArgsIsSceneParent): args is TArgsIsSceneParent & { node: Konva.Layer | Konva.Group } {
  return Boolean(args.node) && (isKonvaLayer(args.node) || isKonvaGroup(args.node));
}

export type TArgsFindSceneNodeById = {
  scene: SceneService;
  id: string;
};

export function fnFindSceneNodeById(args: TArgsFindSceneNodeById) {
  const node = args.scene.staticForegroundLayer.findOne((candidate: Node) => {
    return fnIsSceneNode({ scene: args.scene, node: candidate }) && candidate.id() === args.id;
  });

  return fnIsSceneNode({ scene: args.scene, node }) ? node : null;
}

export type TArgsGetGroupChildren = {
  group: Konva.Group;
  scene: SceneService;
};

export function fnGetGroupChildren(args: TArgsGetGroupChildren) {
  return args.group.getChildren().filter((node): node is TSceneNode => {
    return fnIsSceneNode({ scene: args.scene, node });
  });
}

export type TArgsGetSelectionGroupParent = {
  scene: SceneService;
  selection: TSceneNode[];
};

export function fnGetSelectionGroupParent(args: TArgsGetSelectionGroupParent) {
  const firstParent = args.selection[0]?.getParent();
  if (!fnIsSceneParent({ scene: args.scene, node: firstParent })) {
    return null;
  }

  if (!args.selection.every((node) => node.getParent() === firstParent)) {
    return null;
  }

  return firstParent;
}
