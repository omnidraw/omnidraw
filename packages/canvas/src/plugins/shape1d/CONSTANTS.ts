import type { TArrowData, TLineData } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TShape1dData = TLineData | TArrowData;
export type TShape1dTool = "line" | "arrow";
export type TPoint = [number, number];

export const DEFAULT_STROKE_COLOR_TOKEN = "@base/900";
export const DEFAULT_OPACITY = 0.92;
export const DEFAULT_STROKE_WIDTH_TOKEN = "@stroke-width/medium";
export const STROKE_WIDTH_VALUE_BY_TOKEN = {
  "@stroke-width/none": 0,
  "@stroke-width/thin": 1,
  "@stroke-width/medium": 4,
  "@stroke-width/thick": 7,
  "@stroke-width/heavy": 12,
} as const;
