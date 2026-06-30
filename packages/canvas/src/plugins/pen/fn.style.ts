import type { TElementStyle } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { DEFAULT_FILL, DEFAULT_STROKE_WIDTH, STROKE_WIDTH_VALUE_BY_TOKEN } from "./CONSTANTS";

export function fnGetPenStrokeWidthFromStyle(args: {
  style: TElementStyle;
}) {
  if (typeof args.style.strokeWidth === "string") {
    return STROKE_WIDTH_VALUE_BY_TOKEN[args.style.strokeWidth as keyof typeof STROKE_WIDTH_VALUE_BY_TOKEN]
      ?? Number.parseFloat(args.style.strokeWidth)
      ?? DEFAULT_STROKE_WIDTH;
  }

  return DEFAULT_STROKE_WIDTH;
}

export function fnGetPenColorStyleKey(args: {
  style: TElementStyle;
}): "backgroundColor" | "strokeColor" {
  if (typeof args.style.strokeColor === "string" && typeof args.style.backgroundColor !== "string") {
    return "strokeColor";
  }

  return "backgroundColor";
}

export function fnCreatePenStyleFromNode(args: {
  nodeFill: string;
  opacity: number;
  strokeWidth: number;
  baseStyle: TElementStyle;
}): TElementStyle {
  const fill = args.nodeFill || DEFAULT_FILL;
  const style: TElementStyle = {
    ...structuredClone(args.baseStyle),
    opacity: args.opacity,
    strokeWidth: args.baseStyle.strokeWidth,
    strokeStyle: args.baseStyle.strokeStyle,
  };

  const colorStyleKey = fnGetPenColorStyleKey({ style: args.baseStyle });
  delete style.backgroundColor;
  delete style.strokeColor;
  style[colorStyleKey] = typeof args.baseStyle[colorStyleKey] === "string" ? args.baseStyle[colorStyleKey] : fill;

  return style;
}
