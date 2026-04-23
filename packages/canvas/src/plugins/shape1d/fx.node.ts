import type { TElement, TElementStyle } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TThemeDefinition } from "@vibecanvas/service-theme";
import type Konva from "konva";
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR } from "../../core/CONSTANTS";
import { fnGetCanvasParentGroupId } from "../../core/fn.canvas-node-semantics";
import { fnGetWorldPosition } from "../../core/fn.world-position";
import { isKonvaShape } from "../../core/GUARDS";
import type { SceneService } from "../../services/scene/SceneService";
import {
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  STROKE_WIDTH_VALUE_BY_TOKEN,
  type TShape1dData,
  type TShape1dNode,
} from "./CONSTANTS";

export type TPortalFxIsSupportedTool = {};
export type TArgsFxIsSupportedTool = { tool: string };
export function fxIsSupportedTool(portal: TPortalFxIsSupportedTool, args: TArgsFxIsSupportedTool): args is TArgsFxIsSupportedTool & { tool: "line" | "arrow" } {
  void portal;
  return args.tool === "line" || args.tool === "arrow";
}

export type TPortalFxIsSupportedElementType = {};
export type TArgsFxIsSupportedElementType = { type: TShape1dData["type"] | string };
export function fxIsSupportedElementType(portal: TPortalFxIsSupportedElementType, args: TArgsFxIsSupportedElementType): args is TArgsFxIsSupportedElementType & { type: TShape1dData["type"] } {
  void portal;
  return args.type === "line" || args.type === "arrow";
}

export type TPortalFxIsShape1dNode = {};
export type TArgsFxIsShape1dNode = { node: Konva.Node | null | undefined };
export function fxIsShape1dNode(portal: TPortalFxIsShape1dNode | TArgsFxIsShape1dNode, args?: TArgsFxIsShape1dNode): args is TArgsFxIsShape1dNode & { node: TShape1dNode } {
  void portal;
  const resolvedArgs = args ?? (portal as TArgsFxIsShape1dNode);
  if (!isKonvaShape(resolvedArgs.node)) {
    return false;
  }

  const data = resolvedArgs.node.getAttr(ELEMENT_DATA_ATTR) as TShape1dData | undefined;
  return Boolean(data && fxIsSupportedElementType({}, { type: data.type }));
}

export type TPortalFxHasRenderableRuntime = {};
export type TArgsFxHasRenderableRuntime = TArgsFxIsShape1dNode;
export function fxHasRenderableRuntime(portal: TPortalFxHasRenderableRuntime | TArgsFxHasRenderableRuntime, args?: TArgsFxHasRenderableRuntime): args is TArgsFxHasRenderableRuntime & { node: TShape1dNode } {
  void portal;
  const resolvedArgs = args ?? (portal as TArgsFxHasRenderableRuntime);
  return fxIsShape1dNode({}, resolvedArgs)
    && typeof resolvedArgs.node.getSelfRect === "function"
    && typeof resolvedArgs.node.sceneFunc?.() === "function";
}

export type TPortalFxFindShape1dNodeById = { Shape: typeof Konva.Shape; render: SceneService };
export type TArgsFxFindShape1dNodeById = { id: string };
export function fxFindShape1dNodeById(portal: TPortalFxFindShape1dNodeById, args: TArgsFxFindShape1dNodeById): TShape1dNode | null {
  const candidate = portal.render.staticForegroundLayer.findOne((node: Konva.Node) => {
    return fxIsShape1dNode({}, { node }) && node.id() === args.id;
  });

  return fxIsShape1dNode({}, { node: candidate }) ? (candidate as TShape1dNode) : null;
}

export type TPortalFxGetElementData = {};
export type TArgsFxGetElementData = { node: TShape1dNode };
export function fxGetElementData(portal: TPortalFxGetElementData, args: TArgsFxGetElementData): TShape1dData | null {
  void portal;
  const data = args.node.getAttr(ELEMENT_DATA_ATTR) as TShape1dData | undefined;
  return data ? structuredClone(data) : null;
}

export type TPortalFxGetStrokeWidthFromStyle = {};
export type TArgsFxGetStrokeWidthFromStyle = { style: TElementStyle };
export function fxGetStrokeWidthFromStyle(portal: TPortalFxGetStrokeWidthFromStyle, args: TArgsFxGetStrokeWidthFromStyle) {
  void portal;
  if (typeof args.style.strokeWidth === "string") {
    return STROKE_WIDTH_VALUE_BY_TOKEN[args.style.strokeWidth as keyof typeof STROKE_WIDTH_VALUE_BY_TOKEN]
      ?? Number.parseFloat(args.style.strokeWidth)
      ?? DEFAULT_STROKE_WIDTH;
  }

  return DEFAULT_STROKE_WIDTH;
}

export type TPortalFxGetStrokeColorFromStyle = {
  theme: { getTheme(): string | TThemeDefinition };
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
};
export type TArgsFxGetStrokeColorFromStyle = { style: TElementStyle };
export function fxGetStrokeColorFromStyle(portal: TPortalFxGetStrokeColorFromStyle, args: TArgsFxGetStrokeColorFromStyle) {
  const rawColor = args.style.strokeColor ?? args.style.backgroundColor;
  return portal.resolveThemeColor(portal.theme.getTheme(), rawColor, DEFAULT_STROKE) ?? DEFAULT_STROKE;
}

export type TPortalFxGetColorStyleKey = {};
export type TArgsFxGetColorStyleKey = { style: TElementStyle };
export function fxGetColorStyleKey(portal: TPortalFxGetColorStyleKey, args: TArgsFxGetColorStyleKey): "backgroundColor" | "strokeColor" {
  void portal;
  return typeof args.style.backgroundColor === "string" && typeof args.style.strokeColor !== "string"
    ? "backgroundColor"
    : "strokeColor";
}

export type TPortalFxToPositionPatch = { now: () => number; editor?: { toGroup(node: Konva.Node): unknown } };
export type TArgsFxToPositionPatch = { node: TShape1dNode };
export function fxToPositionPatch(portal: TPortalFxToPositionPatch, args: TArgsFxToPositionPatch) {
  const worldPosition = fnGetWorldPosition({
    absolutePosition: args.node.absolutePosition(),
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  });
  return {
    id: args.node.id(),
    x: worldPosition.x,
    y: worldPosition.y,
    parentGroupId: fnGetCanvasParentGroupId(args.node),
    updatedAt: portal.now(),
  } satisfies Pick<TElement, "id" | "x" | "y" | "parentGroupId" | "updatedAt">;
}

export type TPortalFxToTElement = { now: () => number; editor?: { toGroup(node: Konva.Node): unknown } };
export type TArgsFxToTElement = { node: TShape1dNode };
export function fxToTElement(portal: TPortalFxToTElement, args: TArgsFxToTElement): TElement {
  const baseData = structuredClone(args.node.getAttr(ELEMENT_DATA_ATTR) as TShape1dData | undefined);
  if (!baseData || !fxIsSupportedElementType({}, { type: baseData.type })) {
    throw new Error("Shape1d node is missing element data metadata");
  }

  const baseStyle = structuredClone((args.node.getAttr(ELEMENT_STYLE_ATTR) as TElementStyle | undefined) ?? {});
  const absoluteScale = args.node.getAbsoluteScale();
  const layer = args.node.getLayer();
  const scaleX = absoluteScale.x / (layer?.scaleX() ?? 1);
  const scaleY = absoluteScale.y / (layer?.scaleY() ?? 1);
  const { x, y } = fnGetWorldPosition({
    absolutePosition: args.node.absolutePosition(),
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  });
  const now = portal.now();
  const stroke = args.node.stroke();
  const colorStyleKey = fxGetColorStyleKey({}, { style: baseStyle });
  const style: TElementStyle = {
    ...structuredClone(baseStyle),
    opacity: args.node.opacity(),
  };
  delete style.backgroundColor;
  delete style.strokeColor;
  style[colorStyleKey] = typeof baseStyle[colorStyleKey] === "string" ? baseStyle[colorStyleKey] : (typeof stroke === "string" ? stroke : DEFAULT_STROKE);

  return {
    id: args.node.id(),
    x,
    y,
    rotation: args.node.getAbsoluteRotation(),
    scaleX,
    scaleY,
    bindings: [],
    createdAt: Number(args.node.getAttr(VC_CREATED_AT_ATTR) ?? now),
    locked: false,
    parentGroupId: fnGetCanvasParentGroupId(args.node),
    updatedAt: now,
    zIndex: typeof args.node.getAttr("vcZIndex") === "string" ? args.node.getAttr("vcZIndex") : "",
    data: structuredClone(baseData),
    style,
  } satisfies TElement;
}
