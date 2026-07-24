import type { TPolygonNode } from "@vibecanvas/canvas-engine";
import {
  CANVAS_PROJECTION_FALLBACK_COLORS,
  CANVAS_PROJECTION_PEN_OPTIONS,
} from "../CONSTANTS";
import { fnCanvasSolidPaint } from "../fn.color";
import {
  fnCanvasElementChildBase,
  fnCanvasElementRootNode,
} from "../fn.nodes";
import { fnResolveCanvasElementStyle } from "../fn.style";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";

export function fnProjectPenElement(
  args: TCanvasElementProjectorArgs,
): TCanvasElementProjectionDraft {
  const data = args.element.data;
  if (data.type !== "pen") {
    throw new TypeError("Expected a pen element.");
  }
  if (data.points.length === 0) {
    throw new TypeError("Pen element has no points.");
  }

  const style = fnResolveCanvasElementStyle(args);
  const input = data.points.map((point, index) => [
    point[0],
    point[1],
    data.pressures[index] ?? 0.5,
  ] as [number, number, number]);
  const normalized = input.length === 1
    ? [
        input[0]!,
        [input[0]![0] + 0.5, input[0]![1] + 0.5, input[0]![2]] as [number, number, number],
      ]
    : input;
  const outline = args.dependencies.getStroke(normalized, {
    ...CANVAS_PROJECTION_PEN_OPTIONS,
    size: style.stroke?.width ?? CANVAS_PROJECTION_PEN_OPTIONS.size,
    simulatePressure: data.simulatePressure,
  });
  if (outline.length < 3) {
    throw new TypeError("Pen outline generation returned insufficient geometry.");
  }

  const root = fnCanvasElementRootNode({
    element: args.element,
    parentNodeId: args.parentNodeId,
    opacity: style.opacity,
  });
  const render: TPolygonNode = {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "render",
    }),
    kind: "polygon",
    points: outline.map((point) => ({
      x: point[0] ?? 0,
      y: point[1] ?? 0,
    })),
    closed: true,
    fill: style.fill
      ?? style.stroke?.paint
      ?? fnCanvasSolidPaint({ color: CANVAS_PROJECTION_FALLBACK_COLORS.dark }),
  };
  return {
    nodes: [root, render],
  };
}
