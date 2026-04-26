import Konva from 'konva';
import { fnGetCanvasNodeKind } from './fn.canvas-node-semantics';
import { TCanvasNode } from './types';

export function isKonvaLayer(node: unknown): node is Konva.Layer {
  return node instanceof Konva.Layer;
}

export function isKonvaCircle(node: unknown): node is Konva.Circle {
  return node instanceof Konva.Circle;
}

export function isKonvaGroup(node: unknown): node is Konva.Group {
  return node instanceof Konva.Group;
}

export function isKonvaShape(node: unknown): node is Konva.Shape {
  return node instanceof Konva.Shape;
}

export function isKonvaNode(node: unknown): node is Konva.Node {
  return node instanceof Konva.Node;
}

export function isKonvaText(node: unknown): node is Konva.Text {
  return node instanceof Konva.Text;
}

export function isKonvaImage(node: unknown): node is Konva.Image {
  return node instanceof Konva.Image;
}

export function isKonvaPath(node: unknown): node is Konva.Path {
  return node instanceof Konva.Path;
}

export function isKonvaRect(node: unknown): node is Konva.Rect {
  return node instanceof Konva.Rect;
}

export function isKonvaEllipse(node: unknown): node is Konva.Ellipse {
  return node instanceof Konva.Ellipse;
}

export function isCanvasNode(
  node: Konva.Node,
): node is TCanvasNode {
  return fnGetCanvasNodeKind(node) !== null;
}

export function isCanvasGroupNode( node: Konva.Node ): node is Konva.Group {
  return fnGetCanvasNodeKind(node) === "group";
}

export function isCanvasElementNode( node: Konva.Node, ): node is TCanvasNode {
  return fnGetCanvasNodeKind(node) === "element";
}
