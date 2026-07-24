import type {
  TBinding,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TShape1dEditHandle = {
  id: `point:${number}` | `mid:${number}`;
  point: [number, number];
  pointIndex: number;
  insert: boolean;
};

export function fnShape1dEditHandles(
  points: readonly (readonly [number, number])[],
): TShape1dEditHandle[] {
  const handles: TShape1dEditHandle[] = [];
  points.forEach((point, pointIndex) => {
    handles.push({
      id: `point:${pointIndex}`,
      point: [point[0], point[1]],
      pointIndex,
      insert: false,
    });
    const next = points[pointIndex + 1];
    if (next !== undefined) {
      handles.push({
        id: `mid:${pointIndex}`,
        point: [
          (point[0] + next[0]) / 2,
          (point[1] + next[1]) / 2,
        ],
        pointIndex: pointIndex + 1,
        insert: true,
      });
    }
  });
  return handles;
}

export function fnBeginShape1dPointEdit(args: {
  points: readonly (readonly [number, number])[];
  handle: TShape1dEditHandle;
}) {
  const points = args.points.map((point) => [
    point[0],
    point[1],
  ] as [number, number]);
  if (args.handle.insert) {
    points.splice(args.handle.pointIndex, 0, [...args.handle.point]);
  }
  return {
    points,
    pointIndex: args.handle.pointIndex,
  };
}

export function fnMoveShape1dPoint(args: {
  points: readonly (readonly [number, number])[];
  pointIndex: number;
  point: { x: number; y: number };
}) {
  return args.points.map((candidate, index) => {
    return index === args.pointIndex
      ? [args.point.x, args.point.y] as [number, number]
      : [candidate[0], candidate[1]] as [number, number];
  });
}

export function fnShape1dElementWithPoints(args: {
  element: TElement;
  points: readonly (readonly [number, number])[];
  startBinding?: TBinding | null;
  endBinding?: TBinding | null;
  updatedAt: number;
}): TElement | null {
  if (
    args.element.data.type !== "line"
    && args.element.data.type !== "arrow"
  ) {
    return null;
  }
  return {
    ...args.element,
    updatedAt: args.updatedAt,
    data: {
      ...args.element.data,
      points: args.points.map((point) => [point[0], point[1]]),
      startBinding: args.startBinding === undefined
        ? args.element.data.startBinding
        : args.startBinding,
      endBinding: args.endBinding === undefined
        ? args.element.data.endBinding
        : args.endBinding,
    },
  };
}

export function fnCanCommitShape1dPointEdit(
  snapshot: TElement,
  current: TElement | undefined,
) {
  return current !== undefined
    && current.id === snapshot.id
    && current.updatedAt === snapshot.updatedAt
    && (current.data.type === "line" || current.data.type === "arrow");
}
