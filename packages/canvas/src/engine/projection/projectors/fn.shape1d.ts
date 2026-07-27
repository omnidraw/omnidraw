import type {
  TConnectorMarker,
  TConnectorNode,
  TStrokeStyle,
} from "@omnidraw/cangine";
import {
  CANVAS_PROJECTION_FALLBACK_COLORS,
} from "../CONSTANTS";
import {
  fnCanvasSolidPaint,
} from "../fn.color";
import {
  fnCanvasElementChildBase,
  fnCanvasElementRootNode,
} from "../fn.nodes";
import { fnResolveCanvasElementStyle } from "../fn.style";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";

function marker(cap: "none" | "arrow" | "dot" | "diamond"): TConnectorMarker | undefined {
  if (cap === "none") {
    return undefined;
  }
  return {
    shape: cap === "dot" ? "circle" : cap,
    size: 10,
    filled: true,
  };
}

export function fnProjectShape1dElement(
  args: TCanvasElementProjectorArgs,
): TCanvasElementProjectionDraft {
  const data = args.element.data;
  if (data.type !== "line" && data.type !== "arrow") {
    throw new TypeError("Expected a line or arrow element.");
  }

  const style = fnResolveCanvasElementStyle(args);
  const root = fnCanvasElementRootNode({
    element: args.element,
    parentNodeId: args.parentNodeId,
    opacity: style.opacity,
  });
  const points = data.points.length >= 2
    ? data.points
    : [[0, 0], [0, 0]] as [number, number][];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const stroke: TStrokeStyle = style.stroke ?? {
    paint: fnCanvasSolidPaint({
      color: CANVAS_PROJECTION_FALLBACK_COLORS.dark,
    }),
    width: 4,
    cap: "round",
    join: "round",
  };
  const render: TConnectorNode = {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "render",
    }),
    kind: "connector",
    from: {
      type: "point",
      point: { x: first[0], y: first[1] },
    },
    to: {
      type: "point",
      point: { x: last[0], y: last[1] },
    },
    routing: data.lineType === "curved"
      ? { type: "bezier" }
      : { type: "straight" },
    waypoints: points.slice(1, -1).map((point) => ({
      x: point[0],
      y: point[1],
    })),
    stroke,
    ...(data.type === "arrow"
      ? {
          ...(data.startCap === "none"
            ? {}
            : { startMarker: marker(data.startCap) }),
          ...(data.endCap === "none"
            ? {}
            : { endMarker: marker(data.endCap) }),
        }
      : {}),
    metadata: {
      "vibecanvas:target-kind": "element",
      "vibecanvas:element-id": args.element.id,
      "vibecanvas:derived": true,
      "vibecanvas:line-type": data.lineType,
      "vibecanvas:start-binding-target": data.startBinding?.targetId ?? null,
      "vibecanvas:end-binding-target": data.endBinding?.targetId ?? null,
    },
  };

  return {
    nodes: [root, render],
  };
}
