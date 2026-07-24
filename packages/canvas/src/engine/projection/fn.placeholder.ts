import type {
  TRectNode,
  TTextNode,
} from "@vibecanvas/canvas-engine";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasProjectionDiagnosticCode,
  TCanvasProjectionTheme,
} from "../typed";
import {
  CANVAS_PROJECTION_FALLBACK_COLORS,
  CANVAS_PROJECTION_PLACEHOLDER,
} from "./CONSTANTS";
import { fnCanvasSolidPaint } from "./fn.color";
import {
  fnCanvasElementChildBase,
  fnCanvasElementLocalSize,
  fnCanvasElementRootNode,
} from "./fn.nodes";
import type { TCanvasElementProjectionDraft } from "./typed";

type TArgsPlaceholder = {
  element: TElement;
  parentNodeId: string;
  theme: TCanvasProjectionTheme;
  code: TCanvasProjectionDiagnosticCode;
  projectorId?: string;
};

function finiteDimension(value: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : minimum;
}

export function fnProjectCanvasPlaceholder(
  args: TArgsPlaceholder,
): TCanvasElementProjectionDraft {
  const sourceSize = fnCanvasElementLocalSize({ element: args.element });
  const size = {
    width: finiteDimension(sourceSize.width, CANVAS_PROJECTION_PLACEHOLDER.minWidth),
    height: finiteDimension(sourceSize.height, CANVAS_PROJECTION_PLACEHOLDER.minHeight),
  };
  const discriminator = args.element.data.type;
  const label = `${CANVAS_PROJECTION_PLACEHOLDER.title}\n${discriminator} · ${args.code}`;
  const root = {
    ...fnCanvasElementRootNode({
      element: args.element,
      parentNodeId: args.parentNodeId,
      opacity: 1,
      placeholder: true,
    }),
    accessibility: {
      role: "group",
      label,
    },
    metadata: {
      "vibecanvas:target-kind": "element",
      "vibecanvas:element-id": args.element.id,
      "vibecanvas:element-type": discriminator,
      "vibecanvas:locked": args.element.locked,
      "vibecanvas:placeholder": true,
      "vibecanvas:projection-error": args.code,
      "vibecanvas:projector-id": args.projectorId ?? "none",
    },
  };
  const frame: TRectNode = {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "placeholder-frame",
    }),
    kind: "rect",
    size,
    radius: 8,
    fill: fnCanvasSolidPaint({
      color: CANVAS_PROJECTION_FALLBACK_COLORS.placeholderFill,
    }),
    stroke: {
      paint: fnCanvasSolidPaint({
        color: CANVAS_PROJECTION_FALLBACK_COLORS.placeholderStroke,
      }),
      width: 4,
      dash: [12, 8],
      cap: "square",
      join: "round",
    },
  };
  const text: TTextNode = {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "placeholder-text",
    }),
    kind: "text",
    runs: [{ text: label }],
    style: {
      fontFamilies: ["Inter", "Arial", "sans-serif"],
      fontSize: 14,
      lineHeight: 18,
      fill: fnCanvasSolidPaint({
        color: CANVAS_PROJECTION_FALLBACK_COLORS.dark,
      }),
    },
    layout: {
      type: "fixed",
      size,
      overflow: "clip",
    },
    align: "center",
    verticalAlign: "middle",
    wrap: "word",
  };

  return {
    nodes: [root, frame, text],
  };
}
