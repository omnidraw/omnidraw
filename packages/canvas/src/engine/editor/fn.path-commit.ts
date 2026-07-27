import type {
  TConnectorEndpoint,
  TConnectorNode,
} from "@omnidraw/cangine";
import type {
  TBinding,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TCanvasPathCommitSource =
  | "cangine-editor:path-geometry"
  | "cangine-editor:path-segment-mode"
  | "cangine-editor:path-transform";

type TArgsPathCommit = {
  element: TElement;
  node: TConnectorNode;
  source: TCanvasPathCommitSource;
  updatedAt: number;
  startBinding?: TBinding | null;
  endBinding?: TBinding | null;
  startPoint?: readonly [number, number];
  endPoint?: readonly [number, number];
};

type TArgsPathReconciliation = {
  node: TConnectorNode;
  source: TCanvasPathCommitSource;
};

function fnEndpointPoint(
  endpoint: TConnectorEndpoint,
  fallback: readonly [number, number],
): [number, number] {
  return endpoint.type === "point"
    ? [endpoint.point.x, endpoint.point.y]
    : [fallback[0], fallback[1]];
}

function fnTransformPoint(
  point: readonly [number, number],
  transform: TConnectorNode["transform"],
): [number, number] {
  const translatedX = point[0] - transform.origin.x;
  const translatedY = point[1] - transform.origin.y;
  const scaledX = translatedX * transform.scale.x;
  const scaledY = translatedY * transform.scale.y;
  const skewedX = scaledX + Math.tan(transform.skew.x) * scaledY;
  const skewedY = Math.tan(transform.skew.y) * scaledX + scaledY;
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return [
    transform.position.x
      + transform.origin.x
      + skewedX * cosine
      - skewedY * sine,
    transform.position.y
      + transform.origin.y
      + skewedX * sine
      + skewedY * cosine,
  ];
}

function fnTransformElement(
  element: TElement,
  node: TConnectorNode,
  updatedAt: number,
): TElement {
  const data = element.data;
  if (data.type !== "line" && data.type !== "arrow") {
    return element;
  }
  const fallbackStart = data.points[0] ?? [0, 0];
  const fallbackEnd = data.points.at(-1) ?? fallbackStart;
  const points: [number, number][] = [
    fnEndpointPoint(node.from, fallbackStart),
    ...(node.waypoints ?? []).map((point) => {
      return [point.x, point.y] as [number, number];
    }),
    fnEndpointPoint(node.to, fallbackEnd),
  ].map((point) => fnTransformPoint(point, node.transform));
  return {
    ...element,
    data: {
      ...data,
      points,
    },
    updatedAt,
  };
}

export function fnCanvasElementFromPathCommit(
  args: TArgsPathCommit,
): TElement | null {
  const data = args.element.data;
  if (data.type !== "line" && data.type !== "arrow") {
    return null;
  }
  if (args.source === "cangine-editor:path-transform") {
    return fnTransformElement(args.element, args.node, args.updatedAt);
  }

  const fallbackStart = data.points[0] ?? [0, 0];
  const fallbackEnd = data.points.at(-1) ?? fallbackStart;
  const points: [number, number][] = [
    args.startPoint === undefined
      ? fnEndpointPoint(args.node.from, fallbackStart)
      : [args.startPoint[0], args.startPoint[1]],
    ...(args.node.waypoints ?? []).map((point) => {
      return [point.x, point.y] as [number, number];
    }),
    args.endPoint === undefined
      ? fnEndpointPoint(args.node.to, fallbackEnd)
      : [args.endPoint[0], args.endPoint[1]],
  ];
  const lineType = args.node.routing.type === "quadratic"
    || args.node.routing.type === "bezier"
    ? "curved"
    : "straight";
  return {
    ...args.element,
    data: {
      ...data,
      lineType,
      points,
      startBinding: args.startBinding === undefined
        ? data.startBinding
        : args.startBinding,
      endBinding: args.endBinding === undefined
        ? data.endBinding
        : args.endBinding,
    },
    updatedAt: args.updatedAt,
  };
}

export function fnCanvasPathReconciliationNode(
  args: TArgsPathReconciliation,
): TConnectorNode | null {
  if (args.source !== "cangine-editor:path-transform") {
    return null;
  }
  return {
    ...args.node,
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
  };
}
