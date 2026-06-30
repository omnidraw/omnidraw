import type Konva from "konva";
import { fnGetShape2dNodeType } from "./fn.node";

export type TShapeTextHostBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type TArgsGetShapeTextHostBounds = {
  Rect: typeof Konva.Rect;
  Ellipse: typeof Konva.Ellipse;
  Line: typeof Konva.Line;
  node: Konva.Shape;
};

function getDiamondSize(node: Konva.Line) {
  const points = node.points();
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);

  return {
    width: Math.max(...xs, 0) - Math.min(...xs, 0),
    height: Math.max(...ys, 0) - Math.min(...ys, 0),
  };
}

export function fnGetShapeTextHostBounds(args: TArgsGetShapeTextHostBounds) {
  const scaleX = Math.abs(args.node.scaleX());
  const scaleY = Math.abs(args.node.scaleY());

  if (args.node instanceof args.Rect) {
    return {
      x: args.node.x(),
      y: args.node.y(),
      width: args.node.width() * scaleX,
      height: args.node.height() * scaleY,
      rotation: args.node.rotation(),
    } satisfies TShapeTextHostBounds;
  }

  if (args.node instanceof args.Ellipse) {
    const width = args.node.radiusX() * 2 * scaleX;
    const height = args.node.radiusY() * 2 * scaleY;
    return {
      x: args.node.x() - width / 2,
      y: args.node.y() - height / 2,
      width,
      height,
      rotation: args.node.rotation(),
    } satisfies TShapeTextHostBounds;
  }

  if (
    args.node instanceof args.Line
    && fnGetShape2dNodeType({
      Rect: args.Rect,
      Line: args.Line,
      Ellipse: args.Ellipse,
      node: args.node,
    }) === "diamond"
  ) {
    const size = getDiamondSize(args.node);
    return {
      x: args.node.x(),
      y: args.node.y(),
      width: size.width * scaleX,
      height: size.height * scaleY,
      rotation: args.node.rotation(),
    } satisfies TShapeTextHostBounds;
  }

  return null;
}
