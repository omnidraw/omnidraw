import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TThemeDefinition } from "@vibecanvas/service-theme";
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR } from "../../core/CONSTANTS";
import { fnGetAbsolutePositionFromWorldPosition } from "../../core/fn.world-position";
import { DEFAULT_OPACITY, MIN_HIT_STROKE_WIDTH, type TShape1dNode } from "./CONSTANTS";
import { fxGetStrokeColorFromStyle, fxGetStrokeWidthFromStyle, fxIsSupportedElementType, fxToTElement } from "./fx.node";
import { txCreateShapeFromElement } from "./tx.render";

export type TPortalTxUpdateShapeFromElement = {
  theme: { getTheme(): string | TThemeDefinition };
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
  setNodeZIndex: (node: TShape1dNode, zIndex: string) => void;
};
export type TArgsTxUpdateShapeFromElement = { node: TShape1dNode; element: TElement };
export function txUpdateShapeFromElement(portal: TPortalTxUpdateShapeFromElement, args: TArgsTxUpdateShapeFromElement) {
  if (!fxIsSupportedElementType({}, { type: args.element.data.type })) {
    return;
  }

  const strokeWidth = fxGetStrokeWidthFromStyle({}, { style: args.element.style });
  const color = fxGetStrokeColorFromStyle({ theme: portal.theme, resolveThemeColor: portal.resolveThemeColor }, { style: args.element.style });
  args.node.absolutePosition(fnGetAbsolutePositionFromWorldPosition({
    worldPosition: { x: args.element.x, y: args.element.y },
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  }));
  args.node.rotation(args.element.rotation);
  args.node.stroke(color);
  args.node.fill(color);
  args.node.strokeWidth(strokeWidth);
  args.node.dash(args.element.style.strokeStyle === "dashed"
    ? [strokeWidth * 4, strokeWidth * 2]
    : args.element.style.strokeStyle === "dotted"
      ? [strokeWidth, strokeWidth * 1.5]
      : []);
  args.node.hitStrokeWidth(Math.max(MIN_HIT_STROKE_WIDTH, strokeWidth + 8));
  args.node.opacity(args.element.style.opacity ?? DEFAULT_OPACITY);
  args.node.scale({ x: args.element.scaleX ?? 1, y: args.element.scaleY ?? 1 });
  args.node.setAttr(VC_CREATED_AT_ATTR, args.element.createdAt);
  args.node.setAttr(ELEMENT_DATA_ATTR, structuredClone(args.element.data));
  args.node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(args.element.style));
  portal.setNodeZIndex(args.node, args.element.zIndex);
}

export type TPortalTxCreatePreviewClone = {
  createId: () => string;
  now: () => number;
  theme: { getTheme(): string | TThemeDefinition };
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
  createShapeNode: (config?: Record<string, unknown>) => TShape1dNode;
  setNodeZIndex: (node: TShape1dNode, zIndex: string) => void;
};
export type TArgsTxCreatePreviewClone = { node: TShape1dNode };
export function txCreatePreviewClone(portal: TPortalTxCreatePreviewClone, args: TArgsTxCreatePreviewClone) {
  const element = fxToTElement({ now: portal.now }, { node: args.node });
  const timestamp = portal.now();
  const clone = txCreateShapeFromElement({
    createShapeNode: portal.createShapeNode,
    setNodeZIndex: portal.setNodeZIndex,
    theme: portal.theme,
    resolveThemeColor: portal.resolveThemeColor,
  }, {
    element: {
      ...element,
      id: portal.createId(),
      parentGroupId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      data: structuredClone(element.data),
      style: structuredClone(element.style),
      zIndex: "",
    },
  });

  clone.setDraggable(true);
  return clone;
}
