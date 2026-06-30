import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  DEFAULT_OPACITY,
  DEFAULT_STROKE_COLOR_TOKEN,
  DEFAULT_STROKE_WIDTH_TOKEN,
  type TPoint,
  type TShape1dData,
  type TShape1dTool,
} from "./CONSTANTS";

function fnGetShape1dStyleDefaults(args: {
  rememberedStyle?: {
    strokeColor?: string;
    strokeWidth?: string;
    opacity?: number;
    lineType?: "straight" | "curved";
    startCap?: "none" | "arrow" | "dot" | "diamond";
    endCap?: "none" | "arrow" | "dot" | "diamond";
  };
}) {
  return {
    strokeColor: args.rememberedStyle?.strokeColor ?? DEFAULT_STROKE_COLOR_TOKEN,
    strokeWidth: args.rememberedStyle?.strokeWidth ?? DEFAULT_STROKE_WIDTH_TOKEN,
    opacity: args.rememberedStyle?.opacity ?? DEFAULT_OPACITY,
    lineType: args.rememberedStyle?.lineType ?? "straight",
    startCap: args.rememberedStyle?.startCap ?? "none",
    endCap: args.rememberedStyle?.endCap ?? "arrow",
  } as const;
}

export function fnCreateFallbackPreviewElement(args: {
  activeTool: TShape1dTool;
  draftElementId: string | null;
  createId: () => string;
  now: () => number;
  rememberedStyle?: {
    strokeColor?: string;
    strokeWidth?: string;
    opacity?: number;
    lineType?: "straight" | "curved";
    startCap?: "none" | "arrow" | "dot" | "diamond";
    endCap?: "none" | "arrow" | "dot" | "diamond";
  };
}) {
  const timestamp = args.now();
  const defaults = fnGetShape1dStyleDefaults({ rememberedStyle: args.rememberedStyle });

  return {
    id: args.draftElementId ?? args.createId(),
    x: 0,
    y: 0,
    rotation: 0,
    bindings: [],
    createdAt: timestamp,
    locked: false,
    parentGroupId: null,
    updatedAt: timestamp,
    zIndex: "",
    data: {
      type: args.activeTool === "arrow" ? "arrow" : "line",
      lineType: defaults.lineType,
      points: [[0, 0], [0, 0]],
      startBinding: null,
      endBinding: null,
      ...(args.activeTool === "arrow" ? { startCap: defaults.startCap, endCap: defaults.endCap } : {}),
    } as TShape1dData,
    style: {
      strokeColor: defaults.strokeColor,
      opacity: defaults.opacity,
      strokeWidth: defaults.strokeWidth,
    },
  } satisfies TElement;
}

export function fnCreateDraftElement(args: {
  activeTool: TShape1dTool;
  draftElementId: string | null;
  draftStartPoint: TPoint | null;
  draftCurrentPoint: TPoint | null;
  createId: () => string;
  now: () => number;
  rememberedStyle?: {
    strokeColor?: string;
    strokeWidth?: string;
    opacity?: number;
    lineType?: "straight" | "curved";
    startCap?: "none" | "arrow" | "dot" | "diamond";
    endCap?: "none" | "arrow" | "dot" | "diamond";
  };
}) {
  if (!args.draftStartPoint || !args.draftCurrentPoint) {
    return null;
  }

  const [startX, startY] = args.draftStartPoint;
  const [endX, endY] = args.draftCurrentPoint;
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    return null;
  }

  const timestamp = args.now();
  const defaults = fnGetShape1dStyleDefaults({ rememberedStyle: args.rememberedStyle });
  return {
    id: args.draftElementId ?? args.createId(),
    x: startX,
    y: startY,
    rotation: 0,
    bindings: [],
    createdAt: timestamp,
    locked: false,
    parentGroupId: null,
    updatedAt: timestamp,
    zIndex: "",
    data: args.activeTool === "arrow"
      ? {
          type: "arrow",
          lineType: defaults.lineType,
          points: [[0, 0], [dx, dy]],
          startBinding: null,
          endBinding: null,
          startCap: defaults.startCap,
          endCap: defaults.endCap,
        }
      : {
          type: "line",
          lineType: defaults.lineType,
          points: [[0, 0], [dx, dy]],
          startBinding: null,
          endBinding: null,
        },
    style: {
      strokeColor: defaults.strokeColor,
      opacity: defaults.opacity,
      strokeWidth: defaults.strokeWidth,
    },
  } satisfies TElement;
}
