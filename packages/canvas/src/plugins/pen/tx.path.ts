import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { StrokeOptions } from "perfect-freehand";
import type { ThemeService, TThemeDefinition } from "@vibecanvas/service-theme";
import type Konva from "konva";
import type { SceneService } from "../../services/scene/SceneService";
import { fnGetStrokePathFromPenData } from "./fn.math";
import { fxGetPenAbsolutePosition } from "./fx.path";
import { fnGetPenStrokeWidthFromStyle } from "./fn.style";
import { DEFAULT_FILL, DEFAULT_OPACITY } from "./CONSTANTS";

const ELEMENT_DATA_ATTR = "vcElementData";
const ELEMENT_STYLE_ATTR = "vcElementStyle";
const PEN_STROKE_WIDTH_ATTR = "vcPenStrokeWidth";
const ELEMENT_CREATED_AT_ATTR = "vcElementCreatedAt";
const VC_Z_INDEX_ATTR = "vcZIndex";

type TGetStroke = (
  points: [number, number, number][],
  options: StrokeOptions,
) => number[][];

export type TPortalTxCreatePenPathFromElement = {
  Path: typeof Konva.Path;
  render: SceneService;
  theme: ThemeService;
  getStroke: TGetStroke;
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
};
export type TArgsTxCreatePenPathFromElement = {
  element: TElement;
};

function getPenFillFromStyle(portal: TPortalTxCreatePenPathFromElement, element: TElement) {
  const rawFill = element.style.backgroundColor ?? element.style.strokeColor ?? undefined;
  return portal.resolveThemeColor(portal.theme.getTheme(), rawFill, DEFAULT_FILL) ?? DEFAULT_FILL;
}

function syncPenMetadata(node: Konva.Path, element: TElement) {
  node.setAttr(ELEMENT_DATA_ATTR, structuredClone(element.data));
  node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(element.style));
  node.setAttr(PEN_STROKE_WIDTH_ATTR, fnGetPenStrokeWidthFromStyle({ style: element.style }));
  node.setAttr(ELEMENT_CREATED_AT_ATTR, element.createdAt);
}

export function txCreatePenPathFromElement(portal: TPortalTxCreatePenPathFromElement, args: TArgsTxCreatePenPathFromElement) {
  if (args.element.data.type !== "pen") {
    throw new Error("Unsupported element type for txCreatePenPathFromElement");
  }

  const node = new portal.Path({
    id: args.element.id,
    x: args.element.x,
    y: args.element.y,
    rotation: args.element.rotation,
    data: fnGetStrokePathFromPenData({
      element: args.element,
      options: { size: fnGetPenStrokeWidthFromStyle({ style: args.element.style }) },
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

  syncPenMetadata(node, args.element);
  node.setAttr(VC_Z_INDEX_ATTR, args.element.zIndex);
  return node;
}

export type TPortalTxUpdatePenPathFromElement = TPortalTxCreatePenPathFromElement;
export type TArgsTxUpdatePenPathFromElement = {
  node: Konva.Path;
  element: TElement;
};

export function txUpdatePenPathFromElement(portal: TPortalTxUpdatePenPathFromElement, args: TArgsTxUpdatePenPathFromElement) {
  if (args.element.data.type !== "pen") {
    return false;
  }

  args.node.id(args.element.id);
  args.node.absolutePosition(fxGetPenAbsolutePosition({}, { node: args.node, element: args.element }));
  args.node.rotation(args.element.rotation);
  args.node.data(fnGetStrokePathFromPenData({
    element: args.element,
    options: { size: fnGetPenStrokeWidthFromStyle({ style: args.element.style }) },
    getStroke: portal.getStroke,
  }));
  args.node.fill(getPenFillFromStyle(portal, args.element));
  args.node.opacity(args.element.style.opacity ?? DEFAULT_OPACITY);
  args.node.scale({ x: args.element.scaleX ?? 1, y: args.element.scaleY ?? 1 });
  syncPenMetadata(args.node, args.element);
  args.node.setAttr(VC_Z_INDEX_ATTR, args.element.zIndex);
  return true;
}
