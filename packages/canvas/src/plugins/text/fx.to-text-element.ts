import type { TElement, TElementStyle, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnGetNodeZIndex } from "../../core/fn.get-node-z-index";
import { fnGetWorldPosition } from "../../core/fn.world-position";
import { fnGetCanvasParentGroupId } from "../../core/fn.canvas-node-semantics";
import type Konva from "konva";
import {
  DEFAULT_TEXT_FONT_SIZE_TOKEN, VC_CONTAINER_ID_ATTR, VC_ORIGINAL_TEXT_ATTR, VC_TEXT_AUTO_RESIZE_ATTR,
  VC_USES_THEME_TEXT_COLOR_ATTR
} from "./CONSTANTS";
import { VC_CREATED_AT_ATTR, VC_UPDATED_AT_ATTR, ELEMENT_STYLE_ATTR, ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";


type TPortal = {
  Date: typeof Date;
}
type TArgs = {
  node: Konva.Text;
};

export function fxToTextElement(portal: TPortal, args: TArgs) {
  const worldPosition = fnGetWorldPosition({
    absolutePosition: args.node.absolutePosition(),
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  });
  const absoluteScale = args.node.getAbsoluteScale();
  const layer = args.node.getLayer();
  const layerScaleX = layer?.scaleX() ?? 1;
  const layerScaleY = layer?.scaleY() ?? 1;
  const parentGroupId = fnGetCanvasParentGroupId(args.node);

  const baseStyle = structuredClone((args.node.getAttr(ELEMENT_STYLE_ATTR) as TElementStyle | undefined) ?? {});

  const textScaleX = absoluteScale.x / layerScaleX;
  const textScaleY = absoluteScale.y / layerScaleY;

  const style: TElementStyle = {
    ...baseStyle,
    opacity: args.node.opacity(),
    fontSize: baseStyle.fontSize ?? DEFAULT_TEXT_FONT_SIZE_TOKEN,
    textAlign: args.node.align() as "left" | "center" | "right",
    verticalAlign: args.node.verticalAlign() as "top" | "middle" | "bottom",
  };
  const fill = args.node.fill();
  const usesThemeTextColor = args.node.getAttr(VC_USES_THEME_TEXT_COLOR_ATTR) === true;
  if (!usesThemeTextColor && typeof baseStyle.strokeColor !== "string" && typeof fill === "string") {
    style.strokeColor = fill;
  }
  const data: TTextData = {
    type: "text",
    w: args.node.width(),
    h: args.node.height(),
    text: args.node.text(),
    originalText: (args.node.getAttr(VC_ORIGINAL_TEXT_ATTR) as string | undefined) ?? args.node.text(),
    fontFamily: args.node.fontFamily(),
    link: null,
    containerId: (args.node.getAttr(VC_CONTAINER_ID_ATTR) as string | null | undefined) ?? null,
    autoResize: (args.node.getAttr(VC_TEXT_AUTO_RESIZE_ATTR) as boolean | undefined) ?? false,
  };

  return {
    id: args.node.id(),
    x: worldPosition.x,
    y: worldPosition.y,
    rotation: args.node.getAbsoluteRotation(),
    scaleX: textScaleX,
    scaleY: textScaleY,
    bindings: [],
    createdAt: args.node.getAttr(VC_CREATED_AT_ATTR) ?? portal.Date.now(),
    updatedAt: args.node.getAttr(VC_UPDATED_AT_ATTR) ?? portal.Date.now(),
    locked: false,
    parentGroupId,
    zIndex: fnGetNodeZIndex({ node: args.node }),
    style,
    data,
  } satisfies TElement;
}
