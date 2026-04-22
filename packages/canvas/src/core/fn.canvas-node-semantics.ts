import type Konva from "konva";
import type { Shape, ShapeConfig } from "konva/lib/Shape";
import { VC_NODE_KIND_ATTR } from "./CONSTANTS";
import { isKonvaGroup } from "./GUARDS";

export type TCanvasNode = Konva.Group | Shape<ShapeConfig>;
export type TCanvasNodeKind = "group" | "element";

export function fnGetCanvasNodeKind(node: Konva.Node): TCanvasNodeKind | null {
  if (!node) {
    return null;
  }
  const kind = node.getAttr(VC_NODE_KIND_ATTR);
  if (!kind) {
    return null;
  }
  return kind as TCanvasNodeKind;
}

export function fnIsCanvasNode(
  node: Konva.Node,
): node is TCanvasNode {
  return fnGetCanvasNodeKind(node) !== null;
}

export function fnIsCanvasGroupNode( node: Konva.Node ): node is Konva.Group {
  return fnGetCanvasNodeKind(node) === "group";
}

export function fnIsCanvasElementHostNode( node: Konva.Node, ): node is TCanvasNode {
  return fnGetCanvasNodeKind(node) === "element";
}

export function fnGetCanvasParentGroupId(node: Konva.Node | null | undefined) {
  const parent = node?.getParent();
  if (!parent)  return null;
  if (!fnIsCanvasGroupNode(parent)) return null;

  return parent.id();
}

export function fnGetCanvasAncestorGroups(node: Konva.Node) {
  const groups: Konva.Group[] = [];
  let current = node.getParent() ?? null;

  while (current) {
    if (isKonvaGroup(current) && fnIsCanvasGroupNode(current)) {
      groups.push(current);
    }

    current = current.getParent();
  }

  return groups;
}
