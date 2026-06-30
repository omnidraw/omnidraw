import type { TElement, TElementStyle, TPenData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { fnGetAbsolutePositionFromWorldPosition, fnGetWorldPosition } from "../../core/fn.world-position";
import { fnGetCanvasParentGroupId } from "../../core/fn.canvas-node-semantics";
import { fnGetNodeZIndex } from "../../core/fn.get-node-z-index";
import { fnCreatePenStyleFromNode } from "./fn.style";
import { fnScalePenDataPoints } from "./fn.math";

const ELEMENT_DATA_ATTR = "vcElementData";
const ELEMENT_STYLE_ATTR = "vcElementStyle";
const PEN_STROKE_WIDTH_ATTR = "vcPenStrokeWidth";
const ELEMENT_CREATED_AT_ATTR = "vcElementCreatedAt";

export type TPortalFxIsPenPath = {};
export type TArgsFxIsPenPath = {
  node: Konva.Path;
};

export function fxIsPenPath(portal: TPortalFxIsPenPath, args: TArgsFxIsPenPath) {
  void portal;
  const data = args.node.getAttr(ELEMENT_DATA_ATTR) as TPenData | undefined;
  return data?.type === "pen";
}

export type TPortalFxIsPenNode = {
  Path: typeof Konva.Path;
};
export type TArgsFxIsPenNode = {
  node: Konva.Node;
};

export function fxIsPenNode(portal: TPortalFxIsPenNode, args: TArgsFxIsPenNode): args is TArgsFxIsPenNode & { node: Konva.Path } {
  return args.node instanceof portal.Path && fxIsPenPath({}, { node: args.node });
}

export type TPortalFxPenPathToElement = {
  editor: { toGroup(node: Konva.Node): unknown };
  now: () => number;
};
export type TArgsFxPenPathToElement = {
  node: Konva.Path;
};

export function fxPenPathToElement(portal: TPortalFxPenPathToElement, args: TArgsFxPenPathToElement): TElement {
  const baseData = structuredClone(args.node.getAttr(ELEMENT_DATA_ATTR) as TPenData | undefined);
  if (!baseData || baseData.type !== "pen") {
    throw new Error("Pen path is missing vcElementData metadata");
  }

  const baseStyle = structuredClone((args.node.getAttr(ELEMENT_STYLE_ATTR) as TElementStyle | undefined) ?? {});
  const absoluteScale = args.node.getAbsoluteScale();
  const layer = args.node.getLayer();
  const layerScaleX = layer?.scaleX() ?? 1;
  const layerScaleY = layer?.scaleY() ?? 1;
  const scaleX = absoluteScale.x / layerScaleX;
  const scaleY = absoluteScale.y / layerScaleY;
  const worldPosition = fnGetWorldPosition({
    absolutePosition: args.node.absolutePosition(),
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  });
  const parentGroupId = fnGetCanvasParentGroupId(args.node);

  return {
    id: args.node.id(),
    rotation: args.node.getAbsoluteRotation(),
    scaleX,
    scaleY,
    x: worldPosition.x,
    y: worldPosition.y,
    bindings: [],
    createdAt: Number(args.node.getAttr(ELEMENT_CREATED_AT_ATTR) ?? portal.now()),
    locked: false,
    parentGroupId,
    updatedAt: portal.now(),
    zIndex: fnGetNodeZIndex({ node: args.node }),
    data: structuredClone(baseData),
    style: fnCreatePenStyleFromNode({
      nodeFill: (() => {
        const fill = args.node.fill();
        return typeof fill === "string" ? fill : "";
      })(),
      opacity: args.node.opacity(),
      strokeWidth: args.node.getAttr(PEN_STROKE_WIDTH_ATTR) ?? 7,
      baseStyle,
    }),
  } satisfies TElement;
}

export type TPortalFxGetPenAbsolutePosition = {};
export type TArgsFxGetPenAbsolutePosition = {
  node: Konva.Path;
  element: TElement;
};

export function fxGetPenAbsolutePosition(portal: TPortalFxGetPenAbsolutePosition, args: TArgsFxGetPenAbsolutePosition) {
  void portal;
  return fnGetAbsolutePositionFromWorldPosition({
    worldPosition: { x: args.element.x, y: args.element.y },
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  });
}
