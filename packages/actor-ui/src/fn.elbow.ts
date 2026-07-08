export type TPoint = {
  x: number;
  y: number;
};

export type TRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TSegment = {
  from: TPoint;
  to: TPoint;
};

export type TFnRouteElbowArrowArgs = {
  start: TPoint;
  end: TPoint;
  obstacles: TRect[];
  padding: number;
  avoidSegments?: TSegment[];
  laneGap?: number;
};

type TDirection = "left" | "right" | "up" | "down";

type TNode = TPoint & {
  key: string;
};

type TVisit = TNode & {
  cost: number;
  estimate: number;
  bends: number;
  direction?: TDirection;
  parent?: string;
};

const TURN_COST = 28;
const AVOID_SEGMENT_COST = 640;
const OVERLAP_EPSILON = 0.01;

function fnKey(point: TPoint): string {
  return `${point.x},${point.y}`;
}

function fnManhattan(left: TPoint, right: TPoint): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function fnDirection(from: TPoint, to: TPoint): TDirection | undefined {
  if (to.x > from.x) {
    return "right";
  }

  if (to.x < from.x) {
    return "left";
  }

  if (to.y > from.y) {
    return "down";
  }

  if (to.y < from.y) {
    return "up";
  }

  return undefined;
}

function fnExpandRect(rect: TRect, padding: number): TRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    w: rect.w + padding * 2,
    h: rect.h + padding * 2,
  };
}

function fnPointInRect(point: TPoint, rect: TRect): boolean {
  return point.x >= rect.x - OVERLAP_EPSILON
    && point.x <= rect.x + rect.w + OVERLAP_EPSILON
    && point.y >= rect.y - OVERLAP_EPSILON
    && point.y <= rect.y + rect.h + OVERLAP_EPSILON;
}

function fnSegmentIntersectsRect(from: TPoint, to: TPoint, rect: TRect): boolean {
  if (from.x === to.x) {
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);

    return from.x >= rect.x - OVERLAP_EPSILON
      && from.x <= rect.x + rect.w + OVERLAP_EPSILON
      && maxY >= rect.y - OVERLAP_EPSILON
      && minY <= rect.y + rect.h + OVERLAP_EPSILON;
  }

  if (from.y === to.y) {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);

    return from.y >= rect.y - OVERLAP_EPSILON
      && from.y <= rect.y + rect.h + OVERLAP_EPSILON
      && maxX >= rect.x - OVERLAP_EPSILON
      && minX <= rect.x + rect.w + OVERLAP_EPSILON;
  }

  return true;
}

function fnRangesOverlap(leftMin: number, leftMax: number, rightMin: number, rightMax: number): boolean {
  return leftMax >= rightMin - OVERLAP_EPSILON && rightMax >= leftMin - OVERLAP_EPSILON;
}

function fnSegmentOverlapPenalty(from: TPoint, to: TPoint, avoidSegment: TSegment, laneGap: number): number {
  const horizontal = from.y === to.y;
  const vertical = from.x === to.x;
  const avoidHorizontal = avoidSegment.from.y === avoidSegment.to.y;
  const avoidVertical = avoidSegment.from.x === avoidSegment.to.x;

  if (!horizontal && !vertical) {
    return AVOID_SEGMENT_COST;
  }

  if (horizontal && avoidHorizontal) {
    const distance = Math.abs(from.y - avoidSegment.from.y);
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const avoidMinX = Math.min(avoidSegment.from.x, avoidSegment.to.x);
    const avoidMaxX = Math.max(avoidSegment.from.x, avoidSegment.to.x);

    return distance < laneGap && fnRangesOverlap(minX, maxX, avoidMinX, avoidMaxX)
      ? AVOID_SEGMENT_COST + (laneGap - distance)
      : 0;
  }

  if (vertical && avoidVertical) {
    const distance = Math.abs(from.x - avoidSegment.from.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    const avoidMinY = Math.min(avoidSegment.from.y, avoidSegment.to.y);
    const avoidMaxY = Math.max(avoidSegment.from.y, avoidSegment.to.y);

    return distance < laneGap && fnRangesOverlap(minY, maxY, avoidMinY, avoidMaxY)
      ? AVOID_SEGMENT_COST + (laneGap - distance)
      : 0;
  }

  if (horizontal && avoidVertical) {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const avoidMinY = Math.min(avoidSegment.from.y, avoidSegment.to.y);
    const avoidMaxY = Math.max(avoidSegment.from.y, avoidSegment.to.y);

    return avoidSegment.from.x >= minX - laneGap
      && avoidSegment.from.x <= maxX + laneGap
      && from.y >= avoidMinY - laneGap
      && from.y <= avoidMaxY + laneGap
      ? AVOID_SEGMENT_COST / 2
      : 0;
  }

  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  const avoidMinX = Math.min(avoidSegment.from.x, avoidSegment.to.x);
  const avoidMaxX = Math.max(avoidSegment.from.x, avoidSegment.to.x);

  return avoidSegment.from.y >= minY - laneGap
    && avoidSegment.from.y <= maxY + laneGap
    && from.x >= avoidMinX - laneGap
    && from.x <= avoidMaxX + laneGap
    ? AVOID_SEGMENT_COST / 2
    : 0;
}

function fnAvoidSegmentPenalty(from: TPoint, to: TPoint, avoidSegments: TSegment[], laneGap: number): number {
  return avoidSegments.reduce(
    (total, avoidSegment) => total + fnSegmentOverlapPenalty(from, to, avoidSegment, laneGap),
    0,
  );
}

function fnIsBlocked(point: TPoint, from: TPoint, obstacles: TRect[]): boolean {
  return obstacles.some((obstacle) => fnPointInRect(point, obstacle) || fnSegmentIntersectsRect(from, point, obstacle));
}

function fnUniqueNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value)))].sort((left, right) => left - right);
}

function fnBuildGrid(args: TFnRouteElbowArrowArgs): TNode[] {
  const expandedObstacles = args.obstacles.map((obstacle) => fnExpandRect(obstacle, args.padding));
  const laneGap = args.laneGap ?? args.padding;
  const xs = fnUniqueNumbers([
    args.start.x,
    args.end.x,
    (args.start.x + args.end.x) / 2,
    ...(args.avoidSegments ?? []).flatMap((segment) => [
      segment.from.x,
      segment.to.x,
      segment.from.x - laneGap,
      segment.from.x + laneGap,
      segment.to.x - laneGap,
      segment.to.x + laneGap,
    ]),
    ...expandedObstacles.flatMap((obstacle) => [
      obstacle.x - args.padding,
      obstacle.x,
      obstacle.x + obstacle.w / 2,
      obstacle.x + obstacle.w,
      obstacle.x + obstacle.w + args.padding,
    ]),
  ]);
  const ys = fnUniqueNumbers([
    args.start.y,
    args.end.y,
    (args.start.y + args.end.y) / 2,
    ...(args.avoidSegments ?? []).flatMap((segment) => [
      segment.from.y,
      segment.to.y,
      segment.from.y - laneGap,
      segment.from.y + laneGap,
      segment.to.y - laneGap,
      segment.to.y + laneGap,
    ]),
    ...expandedObstacles.flatMap((obstacle) => [
      obstacle.y - args.padding,
      obstacle.y,
      obstacle.y + obstacle.h / 2,
      obstacle.y + obstacle.h,
      obstacle.y + obstacle.h + args.padding,
    ]),
  ]);

  return xs.flatMap((x) => ys.map((y) => ({ x, y, key: fnKey({ x, y }) })));
}

function fnNeighbors(node: TVisit, nodes: TNode[], obstacles: TRect[]): TNode[] {
  const horizontal = nodes.filter((candidate) => candidate.y === node.y && candidate.x !== node.x);
  const vertical = nodes.filter((candidate) => candidate.x === node.x && candidate.y !== node.y);
  const nearestLeft = horizontal.filter((candidate) => candidate.x < node.x).at(-1);
  const nearestRight = horizontal.find((candidate) => candidate.x > node.x);
  const nearestUp = vertical.filter((candidate) => candidate.y < node.y).at(-1);
  const nearestDown = vertical.find((candidate) => candidate.y > node.y);

  return [nearestLeft, nearestRight, nearestUp, nearestDown]
    .filter((candidate): candidate is TNode => candidate !== undefined)
    .filter((candidate) => !fnIsBlocked(candidate, node, obstacles));
}

function fnReconstruct(end: TVisit, visits: Map<string, TVisit>): TPoint[] {
  const path: TPoint[] = [];
  let cursor: TVisit | undefined = end;

  while (cursor) {
    path.unshift({ x: cursor.x, y: cursor.y });
    cursor = cursor.parent ? visits.get(cursor.parent) : undefined;
  }

  return fnSimplifyPath(path);
}

function fnSimplifyPath(points: TPoint[]): TPoint[] {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];

    if (!previous || !next) {
      return true;
    }

    return !(previous.x === point.x && point.x === next.x)
      && !(previous.y === point.y && point.y === next.y);
  });
}

function fnFallbackPath(args: TFnRouteElbowArrowArgs): TPoint[] {
  if (Math.abs(args.start.x - args.end.x) > Math.abs(args.start.y - args.end.y)) {
    const midX = (args.start.x + args.end.x) / 2;

    return fnSimplifyPath([args.start, { x: midX, y: args.start.y }, { x: midX, y: args.end.y }, args.end]);
  }

  const midY = (args.start.y + args.end.y) / 2;

  return fnSimplifyPath([args.start, { x: args.start.x, y: midY }, { x: args.end.x, y: midY }, args.end]);
}

export function fnRouteElbowArrow(args: TFnRouteElbowArrowArgs): TPoint[] {
  const obstacles = args.obstacles.map((obstacle) => fnExpandRect(obstacle, args.padding));
  const avoidSegments = args.avoidSegments ?? [];
  const laneGap = args.laneGap ?? args.padding;
  const nodes = fnBuildGrid(args);
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const startKey = fnKey(args.start);
  const endKey = fnKey(args.end);
  const open = new Set<string>([startKey]);
  const visits = new Map<string, TVisit>([
    [startKey, {
      ...args.start,
      key: startKey,
      bends: 0,
      cost: 0,
      estimate: fnManhattan(args.start, args.end),
    }],
  ]);

  nodeByKey.set(startKey, { ...args.start, key: startKey });
  nodeByKey.set(endKey, { ...args.end, key: endKey });

  while (open.size > 0) {
    const currentKey = [...open].sort((left, right) => {
      const leftVisit = visits.get(left);
      const rightVisit = visits.get(right);

      return (leftVisit?.estimate ?? 0) - (rightVisit?.estimate ?? 0);
    })[0];

    if (!currentKey) {
      break;
    }

    const current = visits.get(currentKey);

    if (!current) {
      break;
    }

    if (current.key === endKey) {
      return fnReconstruct(current, visits);
    }

    open.delete(current.key);

    for (const neighbor of fnNeighbors(current, [...nodeByKey.values()], obstacles)) {
      const direction = fnDirection(current, neighbor);
      const bendCost = current.direction && direction && current.direction !== direction ? TURN_COST : 0;
      const avoidCost = fnAvoidSegmentPenalty(current, neighbor, avoidSegments, laneGap);
      const nextCost = current.cost + fnManhattan(current, neighbor) + bendCost + avoidCost;
      const existing = visits.get(neighbor.key);

      if (existing && existing.cost <= nextCost) {
        continue;
      }

      visits.set(neighbor.key, {
        ...neighbor,
        bends: current.bends + (bendCost > 0 ? 1 : 0),
        cost: nextCost,
        direction,
        estimate: nextCost + fnManhattan(neighbor, args.end),
        parent: current.key,
      });
      open.add(neighbor.key);
    }
  }

  return fnFallbackPath(args);
}
