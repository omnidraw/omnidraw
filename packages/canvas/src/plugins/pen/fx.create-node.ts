import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService, TThemeDefinition } from "@vibecanvas/service-theme";
import type Konva from "konva";
import type { StrokeOptions } from "perfect-freehand";
import { DEFAULT_FILL, DEFAULT_OPACITY } from "./CONSTANTS";
import { fnGetStrokePathFromPenData } from "./fn.math";
import { fnGetPenStrokeWidthFromStyle } from "./fn.style";

const ELEMENT_DATA_ATTR = "vcElementData";
const ELEMENT_STYLE_ATTR = "vcElementStyle";
const PEN_STROKE_WIDTH_ATTR = "vcPenStrokeWidth";
const ELEMENT_CREATED_AT_ATTR = "vcElementCreatedAt";
const VC_Z_INDEX_ATTR = "vcZIndex";

type TGetStroke = (
  points: [number, number, number][],
  options: StrokeOptions,
) => number[][];

export type TPortalFxCreatePenNode = {
  Path: typeof Konva.Path;
  theme: ThemeService;
  getStroke: TGetStroke;
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
};

export type TArgsFxCreatePenNode = {
  element: TElement;
};

function getPenFillFromStyle(portal: TPortalFxCreatePenNode, element: TElement) {
  const rawFill = element.style.backgroundColor ?? element.style.strokeColor ?? undefined;
  return portal.resolveThemeColor(portal.theme.getTheme(), rawFill, DEFAULT_FILL) ?? DEFAULT_FILL;
}

export function fxCreatePenNode(portal: TPortalFxCreatePenNode, args: TArgsFxCreatePenNode) {
  if (args.element.data.type !== "pen") {
    return null;
  }

  const strokeWidth = fnGetPenStrokeWidthFromStyle({ style: args.element.style });
  const node = new portal.Path({
    id: args.element.id,
    x: args.element.x,
    y: args.element.y,
    rotation: args.element.rotation,
    data: fnGetStrokePathFromPenData({
      element: args.element,
      options: { size: strokeWidth },
      getStroke: portal.getStroke,
    }),
    fill: getPenFillFromStyle(portal, args.element),
    opacity: args.element.style.opacity ?? DEFAULT_OPACITY,
    scaleX: args.element.scaleX ?? 1,
    scaleY: args.element.scaleY ?? 1,
    listening: true,
    draggable: true,
    visible: true,
  });

  node.setAttr(ELEMENT_DATA_ATTR, structuredClone(args.element.data));
  node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(args.element.style));
  node.setAttr(PEN_STROKE_WIDTH_ATTR, strokeWidth);
  node.setAttr(ELEMENT_CREATED_AT_ATTR, args.element.createdAt);
  node.setAttr(VC_Z_INDEX_ATTR, args.element.zIndex);
  return node;
}
