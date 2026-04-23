import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import {
  ELEMENT_DATA_ATTR,
  ELEMENT_STYLE_ATTR,
  VC_CREATED_AT_ATTR,
  VC_UPDATED_AT_ATTR,
} from "../../core/CONSTANTS";
import { fnGetAbsolutePositionFromWorldPosition } from "../../core/fn.world-position";
import { fnGetDiamondPoints } from "../../core/fn.shape2d";

export type TPortalUpdateShape2dNodeFromElement = {
  Rect: typeof Konva.Rect;
  Line: typeof Konva.Line;
  Ellipse: typeof Konva.Ellipse;
  theme: ThemeService;
  setNodeZIndex: (node: Konva.Shape, zIndex: string) => void;
};

export type TArgsUpdateShape2dNodeFromElement = {
  node: Konva.Node;
  element: TElement;
};

function syncShapeFill(
  node: Konva.Shape,
  theme: ThemeService,
  backgroundColor: string | undefined,
) {
  const fill = theme.resolveThemeColor(backgroundColor);
  if (typeof fill === "string") {
    node.fillEnabled(true);
    node.fill(fill);
    return;
  }

  node.fillEnabled(false);
  node.fill(undefined);
}

function syncShapeStroke(
  node: Konva.Shape,
  theme: ThemeService,
  strokeColor: string | undefined,
  strokeWidth: string | undefined,
  strokeStyle: TElement["style"]["strokeStyle"],
) {
  const resolvedStrokeWidth = theme.resolveStrokeWidth(strokeWidth, 0);
  const stroke = theme.resolveThemeColor(strokeColor);
  if (typeof stroke === "string") {
    node.strokeEnabled(true);
    node.stroke(stroke);
    node.strokeWidth(resolvedStrokeWidth);
    node.dash(theme.resolveStrokeDash(strokeStyle, strokeWidth));
    return;
  }

  node.strokeEnabled(false);
  node.stroke(undefined);
  node.strokeWidth(resolvedStrokeWidth);
  node.dash(theme.resolveStrokeDash(strokeStyle, strokeWidth));
}

function syncShape2dNodeMetadata(node: Konva.Shape, element: TElement) {
  node.setAttr(ELEMENT_DATA_ATTR, structuredClone(element.data));
  node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(element.style));
  node.setAttr(VC_CREATED_AT_ATTR, element.createdAt);
  node.setAttr(VC_UPDATED_AT_ATTR, element.updatedAt);
}

export function txUpdateShape2dNodeFromElement(
  portal: TPortalUpdateShape2dNodeFromElement,
  args: TArgsUpdateShape2dNodeFromElement,
) {
  const style = args.element.style;
  const node = args.node;

  if (args.element.data.type === "rect" && node instanceof portal.Rect) {
    const absolutePosition = fnGetAbsolutePositionFromWorldPosition({
      worldPosition: { x: args.element.x, y: args.element.y },
      parentTransform: node.getLayer()?.getAbsoluteTransform() ?? null,
    });

    node.absolutePosition(absolutePosition);
    node.rotation(args.element.rotation);
    node.width(args.element.data.w);
    node.height(args.element.data.h);
    node.cornerRadius(portal.theme.resolveCornerRadius(style.cornerRadius, 0));
    node.scale({ x: args.element.scaleX ?? 1, y: args.element.scaleY ?? 1 });
    node.opacity(style.opacity ?? 1);
    node.draggable(true);
    node.listening(true);
    syncShape2dNodeMetadata(node, args.element);
    syncShapeFill(node, portal.theme, style.backgroundColor);
    syncShapeStroke(node, portal.theme, style.strokeColor, style.strokeWidth, style.strokeStyle);
    portal.setNodeZIndex(node, args.element.zIndex);
    return true;
  }

  if (args.element.data.type === "diamond" && node instanceof portal.Line) {
    const absolutePosition = fnGetAbsolutePositionFromWorldPosition({
      worldPosition: { x: args.element.x, y: args.element.y },
      parentTransform: node.getLayer()?.getAbsoluteTransform() ?? null,
    });

    node.absolutePosition(absolutePosition);
    node.rotation(args.element.rotation);
    node.points(fnGetDiamondPoints({
      width: args.element.data.w,
      height: args.element.data.h,
    }));
    node.closed(true);
    node.scale({ x: args.element.scaleX ?? 1, y: args.element.scaleY ?? 1 });
    node.opacity(style.opacity ?? 1);
    node.draggable(true);
    node.listening(true);
    syncShape2dNodeMetadata(node, args.element);
    syncShapeFill(node, portal.theme, style.backgroundColor);
    syncShapeStroke(node, portal.theme, style.strokeColor, style.strokeWidth, style.strokeStyle);
    portal.setNodeZIndex(node, args.element.zIndex);
    return true;
  }

  if (args.element.data.type === "ellipse" && node instanceof portal.Ellipse) {
    const absolutePosition = fnGetAbsolutePositionFromWorldPosition({
      worldPosition: {
        x: args.element.x + args.element.data.rx,
        y: args.element.y + args.element.data.ry,
      },
      parentTransform: node.getLayer()?.getAbsoluteTransform() ?? null,
    });

    node.absolutePosition(absolutePosition);
    node.rotation(args.element.rotation);
    node.radiusX(args.element.data.rx);
    node.radiusY(args.element.data.ry);
    node.scale({ x: args.element.scaleX ?? 1, y: args.element.scaleY ?? 1 });
    node.opacity(style.opacity ?? 1);
    node.draggable(true);
    node.listening(true);
    syncShape2dNodeMetadata(node, args.element);
    syncShapeFill(node, portal.theme, style.backgroundColor);
    syncShapeStroke(node, portal.theme, style.strokeColor, style.strokeWidth, style.strokeStyle);
    portal.setNodeZIndex(node, args.element.zIndex);
    return true;
  }

  return false;
}
