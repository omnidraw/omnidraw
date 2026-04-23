import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import {
  ELEMENT_DATA_ATTR,
  ELEMENT_STYLE_ATTR,
  VC_CREATED_AT_ATTR,
  VC_UPDATED_AT_ATTR,
} from "../../core/CONSTANTS";
import { fnGetDiamondPoints } from "../../core/fn.shape2d";

export type TPortalCreateShape2dNode = {
  Rect: typeof Konva.Rect;
  Line: typeof Konva.Line;
  Ellipse: typeof Konva.Ellipse;
  theme: ThemeService;
  setNodeZIndex: (node: Konva.Shape, zIndex: string) => void;
};

export type TArgsCreateShape2dNode = {
  element: TElement;
};

function fxSyncShape2dNodeMetadata(node: Konva.Shape, element: TElement) {
  node.setAttr(ELEMENT_DATA_ATTR, structuredClone(element.data));
  node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(element.style));
  node.setAttr(VC_CREATED_AT_ATTR, element.createdAt);
  node.setAttr(VC_UPDATED_AT_ATTR, element.updatedAt);
}

export function fxCreateShape2dNode(portal: TPortalCreateShape2dNode, args: TArgsCreateShape2dNode) {
  const style = args.element.style;
  const fill = portal.theme.resolveThemeColor(style.backgroundColor);
  const stroke = portal.theme.resolveThemeColor(style.strokeColor);

  if (args.element.data.type === "rect") {
    const node = new portal.Rect({
      id: args.element.id,
      x: args.element.x,
      y: args.element.y,
      rotation: args.element.rotation,
      width: args.element.data.w,
      height: args.element.data.h,
      fill,
      stroke,
      strokeWidth: portal.theme.resolveStrokeWidth(style.strokeWidth, 0),
      opacity: style.opacity ?? 1,
      dash: portal.theme.resolveStrokeDash(style.strokeStyle, style.strokeWidth),
      cornerRadius: portal.theme.resolveCornerRadius(style.cornerRadius, 0),
      draggable: true,
      listening: true,
      scaleX: args.element.scaleX ?? 1,
      scaleY: args.element.scaleY ?? 1,
    });

    fxSyncShape2dNodeMetadata(node, args.element);
    portal.setNodeZIndex(node, args.element.zIndex);
    return node;
  }

  if (args.element.data.type === "diamond") {
    const node = new portal.Line({
      id: args.element.id,
      x: args.element.x,
      y: args.element.y,
      rotation: args.element.rotation,
      closed: true,
      points: fnGetDiamondPoints({
        width: args.element.data.w,
        height: args.element.data.h,
      }),
      fill,
      stroke,
      strokeWidth: portal.theme.resolveStrokeWidth(style.strokeWidth, 0),
      opacity: style.opacity ?? 1,
      dash: portal.theme.resolveStrokeDash(style.strokeStyle, style.strokeWidth),
      draggable: true,
      listening: true,
      scaleX: args.element.scaleX ?? 1,
      scaleY: args.element.scaleY ?? 1,
    });

    fxSyncShape2dNodeMetadata(node, args.element);
    portal.setNodeZIndex(node, args.element.zIndex);
    return node;
  }

  if (args.element.data.type === "ellipse") {
    const node = new portal.Ellipse({
      id: args.element.id,
      x: args.element.x + args.element.data.rx,
      y: args.element.y + args.element.data.ry,
      rotation: args.element.rotation,
      radiusX: args.element.data.rx,
      radiusY: args.element.data.ry,
      fill,
      stroke,
      strokeWidth: portal.theme.resolveStrokeWidth(style.strokeWidth, 0),
      opacity: style.opacity ?? 1,
      dash: portal.theme.resolveStrokeDash(style.strokeStyle, style.strokeWidth),
      draggable: true,
      listening: true,
      scaleX: args.element.scaleX ?? 1,
      scaleY: args.element.scaleY ?? 1,
    });

    fxSyncShape2dNodeMetadata(node, args.element);
    portal.setNodeZIndex(node, args.element.zIndex);
    return node;
  }

  return null;
}
