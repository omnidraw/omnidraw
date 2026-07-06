import { fnRouteElbowArrow, type TPoint, type TRect, type TSegment } from "./fn.elbow";

export type TFnEdgeNode = {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TFnEdgeTransition = {
  key: string;
  source: string;
  target: string;
};

export type TFnPlanStateMachineEdgesArgs = {
  nodes: TFnEdgeNode[];
  transitions: TFnEdgeTransition[];
  padding: number;
  laneGap: number;
  arrowheadClearance: number;
  portGap: number;
};

export type TFnPlannedEdge = TFnEdgeTransition & {
  points: TPoint[];
  start: TPoint;
  end: TPoint;
};

type TSide = "top" | "right" | "bottom" | "left";

type TCandidate = {
  sourceSide: TSide;
  targetSide: TSide;
  sourceOffset: number;
  targetOffset: number;
};

type TScoredCandidate = {
  candidate: TCandidate;
  points: TPoint[];
  score: number;
};

const SIDES: TSide[] = ["right", "bottom", "left", "top"];
const PORT_OFFSETS = [0, -30, 30, -56, 56] as const;
const TARGET_PORT_OFFSETS = [0] as const;
const BEND_COST = 52;
const PORT_REUSE_COST = 2200;
const OBSTACLE_COST = 100000;
const ENDPOINT_OBSTACLE_COST = 100000;
const TARGET_APPROACH_COST = 1200;
const TARGET_APPROACH_STUB = 28;
const SOURCE_DEPARTURE_COST = 1200;
const SOURCE_DEPARTURE_STUB = 28;

function fnOppositeSide(side: TSide): TSide {
  if (side === "top") {
    return "bottom";
  }

  if (side === "right") {
    return "left";
  }

  if (side === "bottom") {
    return "top";
  }

  return "right";
}

function fnClamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fnNodeCenter(node: TFnEdgeNode): TPoint {
  return {
    x: node.x + node.w / 2,
    y: node.y + node.h / 2,
  };
}

function fnPreferredSide(source: TFnEdgeNode, target: TFnEdgeNode): TSide {
  const sourceCenter = fnNodeCenter(source);
  const targetCenter = fnNodeCenter(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }

  return dy >= 0 ? "bottom" : "top";
}

function fnSideRank(side: TSide, preferred: TSide): number {
  if (side === preferred) {
    return 0;
  }

  if (side === fnOppositeSide(preferred)) {
    return 2;
  }

  return 1;
}

function fnPortPoint(node: TFnEdgeNode, side: TSide, offset: number, clearance: number): TPoint {
  if (side === "left" || side === "right") {
    const direction = side === "left" ? -1 : 1;

    return {
      x: node.x + node.w / 2 + direction * (node.w / 2 + clearance),
      y: fnClamp(node.y + node.h / 2 + offset, node.y + 16, node.y + node.h - 16),
    };
  }

  const direction = side === "top" ? -1 : 1;

  return {
    x: fnClamp(node.x + node.w / 2 + offset, node.x + 16, node.x + node.w - 16),
    y: node.y + node.h / 2 + direction * (node.h / 2 + clearance),
  };
}

function fnTargetApproachPoint(end: TPoint, side: TSide): TPoint {
  if (side === "left") {
    return { x: end.x - TARGET_APPROACH_STUB, y: end.y };
  }

  if (side === "right") {
    return { x: end.x + TARGET_APPROACH_STUB, y: end.y };
  }

  if (side === "top") {
    return { x: end.x, y: end.y - TARGET_APPROACH_STUB };
  }

  return { x: end.x, y: end.y + TARGET_APPROACH_STUB };
}

function fnSourceDeparturePoint(start: TPoint, side: TSide): TPoint {
  if (side === "left") {
    return { x: start.x - SOURCE_DEPARTURE_STUB, y: start.y };
  }

  if (side === "right") {
    return { x: start.x + SOURCE_DEPARTURE_STUB, y: start.y };
  }

  if (side === "top") {
    return { x: start.x, y: start.y - SOURCE_DEPARTURE_STUB };
  }

  return { x: start.x, y: start.y + SOURCE_DEPARTURE_STUB };
}

function fnPointDistance(left: TPoint, right: TPoint): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;

  return Math.sqrt(dx * dx + dy * dy);
}

function fnPathLength(points: TPoint[]): number {
  return points.reduce((total, point, index) => {
    const previous = points[index - 1];

    if (!previous) {
      return total;
    }

    return total + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
  }, 0);
}

function fnBendCount(points: TPoint[]): number {
  let bends = 0;

  for (let index = 2; index < points.length; index += 1) {
    const a = points[index - 2];
    const b = points[index - 1];
    const c = points[index];

    if (!a || !b || !c) {
      continue;
    }

    const firstHorizontal = a.y === b.y;
    const secondHorizontal = b.y === c.y;

    if (firstHorizontal !== secondHorizontal) {
      bends += 1;
    }
  }

  return bends;
}

function fnPointInRect(point: TPoint, rect: TRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function fnSegmentIntersectsRect(from: TPoint, to: TPoint, rect: TRect): boolean {
  if (from.x === to.x) {
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);

    return from.x >= rect.x && from.x <= rect.x + rect.w && maxY >= rect.y && minY <= rect.y + rect.h;
  }

  if (from.y === to.y) {
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);

    return from.y >= rect.y && from.y <= rect.y + rect.h && maxX >= rect.x && minX <= rect.x + rect.w;
  }

  return true;
}

function fnPathSegments(points: TPoint[]): TSegment[] {
  return points.flatMap((point, index) => {
    const next = points[index + 1];

    if (!next || (next.x === point.x && next.y === point.y)) {
      return [];
    }

    return [{ from: point, to: next }];
  });
}

function fnObstaclePenalty(points: TPoint[], obstacles: TRect[]): number {
  const segments = fnPathSegments(points);

  return obstacles.reduce((total, obstacle) => {
    const blockedPoint = points.some((point) => fnPointInRect(point, obstacle));
    const blockedSegment = segments.some((segment) => fnSegmentIntersectsRect(segment.from, segment.to, obstacle));

    return total + (blockedPoint || blockedSegment ? OBSTACLE_COST : 0);
  }, 0);
}

function fnNodeRect(node: TFnEdgeNode): TRect {
  return {
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
  };
}

function fnEndpointObstaclePenalty(points: TPoint[], source: TFnEdgeNode, target: TFnEdgeNode): number {
  const segments = fnPathSegments(points);
  const sourceRect = fnNodeRect(source);
  const targetRect = fnNodeRect(target);
  const crossesSourceAfterDeparture = segments
    .slice(1)
    .some((segment) => fnSegmentIntersectsRect(segment.from, segment.to, sourceRect));
  const crossesTargetBeforeApproach = segments
    .slice(0, -1)
    .some((segment) => fnSegmentIntersectsRect(segment.from, segment.to, targetRect));

  return (crossesSourceAfterDeparture ? ENDPOINT_OBSTACLE_COST : 0)
    + (crossesTargetBeforeApproach ? ENDPOINT_OBSTACLE_COST : 0);
}

function fnAxisSign(value: number): number {
  if (value > 0) {
    return 1;
  }

  if (value < 0) {
    return -1;
  }

  return 0;
}

function fnTargetApproachPenalty(points: TPoint[], target: TFnEdgeNode): number {
  const end = points.at(-1);
  const beforeEnd = points.at(-2);

  if (!end || !beforeEnd) {
    return TARGET_APPROACH_COST;
  }

  const targetCenter = fnNodeCenter(target);
  const approachX = fnAxisSign(end.x - beforeEnd.x);
  const approachY = fnAxisSign(end.y - beforeEnd.y);
  const centerX = fnAxisSign(targetCenter.x - end.x);
  const centerY = fnAxisSign(targetCenter.y - end.y);

  if (approachX !== 0) {
    return approachX === centerX ? 0 : TARGET_APPROACH_COST;
  }

  if (approachY !== 0) {
    return approachY === centerY ? 0 : TARGET_APPROACH_COST;
  }

  return TARGET_APPROACH_COST;
}

function fnSourceDeparturePenalty(points: TPoint[], source: TFnEdgeNode): number {
  const start = points[0];
  const afterStart = points[1];

  if (!start || !afterStart) {
    return SOURCE_DEPARTURE_COST;
  }

  const sourceCenter = fnNodeCenter(source);
  const departureX = fnAxisSign(afterStart.x - start.x);
  const departureY = fnAxisSign(afterStart.y - start.y);
  const awayX = fnAxisSign(start.x - sourceCenter.x);
  const awayY = fnAxisSign(start.y - sourceCenter.y);

  if (departureX !== 0) {
    return departureX === awayX ? 0 : SOURCE_DEPARTURE_COST;
  }

  if (departureY !== 0) {
    return departureY === awayY ? 0 : SOURCE_DEPARTURE_COST;
  }

  return SOURCE_DEPARTURE_COST;
}

function fnPortReusePenalty(point: TPoint, usedPorts: TPoint[], portGap: number): number {
  return usedPorts.reduce((total, usedPort) => {
    const distance = fnPointDistance(point, usedPort);

    return total + (distance < portGap ? PORT_REUSE_COST + (portGap - distance) * 20 : 0);
  }, 0);
}

function fnCandidateScore(args: {
  candidate: TCandidate;
  points: TPoint[];
  source: TFnEdgeNode;
  target: TFnEdgeNode;
  obstacles: TRect[];
  usedPorts: TPoint[];
  portGap: number;
}): number {
  const preferredSide = fnPreferredSide(args.source, args.target);
  const sideCost = fnSideRank(args.candidate.sourceSide, preferredSide) * 130;

  return fnPathLength(args.points)
    + fnBendCount(args.points) * BEND_COST
    + sideCost
    + Math.abs(args.candidate.sourceOffset) * 0.4
    + Math.abs(args.candidate.targetOffset) * 0.4
    + fnPortReusePenalty(args.points[0] ?? { x: 0, y: 0 }, args.usedPorts, args.portGap)
    + fnPortReusePenalty(args.points.at(-1) ?? { x: 0, y: 0 }, args.usedPorts, args.portGap)
    + fnObstaclePenalty(args.points, args.obstacles)
    + fnEndpointObstaclePenalty(args.points, args.source, args.target)
    + fnTargetApproachPenalty(args.points, args.target)
    + fnSourceDeparturePenalty(args.points, args.source);
}

function fnCandidates(source: TFnEdgeNode, target: TFnEdgeNode): TCandidate[] {
  const preferredSide = fnPreferredSide(source, target);
  const orderedSides = [...SIDES].sort((left, right) => fnSideRank(left, preferredSide) - fnSideRank(right, preferredSide));

  return orderedSides.flatMap((sourceSide) => PORT_OFFSETS.flatMap((sourceOffset) => {
    const targetSide = fnOppositeSide(sourceSide);

    return TARGET_PORT_OFFSETS.map((targetOffset) => ({
      sourceSide,
      targetSide,
      sourceOffset,
      targetOffset,
    }));
  }));
}

function fnPlanSingleEdge(args: {
  transition: TFnEdgeTransition;
  source: TFnEdgeNode;
  target: TFnEdgeNode;
  obstacles: TRect[];
  avoidSegments: TSegment[];
  usedPorts: TPoint[];
  padding: number;
  laneGap: number;
  arrowheadClearance: number;
  portGap: number;
}): TScoredCandidate {
  const scored = fnCandidates(args.source, args.target).map((candidate) => {
    const start = fnPortPoint(args.source, candidate.sourceSide, candidate.sourceOffset, 0);
    const departure = fnSourceDeparturePoint(start, candidate.sourceSide);
    const end = fnPortPoint(args.target, candidate.targetSide, candidate.targetOffset, args.arrowheadClearance);
    const approach = fnTargetApproachPoint(end, candidate.targetSide);
    const routedPoints = fnRouteElbowArrow({
      start: departure,
      end: approach,
      obstacles: args.obstacles,
      padding: args.padding,
      avoidSegments: args.avoidSegments,
      laneGap: args.laneGap,
    });
    const points = [
      start,
      departure,
      ...routedPoints.slice(1),
      end,
    ];

    return {
      candidate,
      points,
      score: fnCandidateScore({
        candidate,
        points,
        source: args.source,
        target: args.target,
        obstacles: args.obstacles,
        usedPorts: args.usedPorts,
        portGap: args.portGap,
      }),
    };
  }).sort((left, right) => left.score - right.score);

  return scored[0] ?? {
    candidate: {
      sourceSide: "right",
      targetSide: "left",
      sourceOffset: 0,
      targetOffset: 0,
    },
    points: [fnNodeCenter(args.source), fnNodeCenter(args.target)],
    score: OBSTACLE_COST,
  };
}

export function fnPlanStateMachineEdges(args: TFnPlanStateMachineEdgesArgs): TFnPlannedEdge[] {
  const nodeByName = new Map(args.nodes.map((node) => [node.name, node]));
  const usedPorts: TPoint[] = [];
  const avoidSegments: TSegment[] = [];
  const planned: TFnPlannedEdge[] = [];

  for (const transition of args.transitions) {
    const source = nodeByName.get(transition.source);
    const target = nodeByName.get(transition.target);

    if (!source || !target) {
      continue;
    }

    const obstacles = args.nodes
      .filter((node) => node.name !== source.name && node.name !== target.name)
      .map((node) => ({
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
      }));
    const best = fnPlanSingleEdge({
      transition,
      source,
      target,
      obstacles,
      avoidSegments,
      usedPorts,
      padding: args.padding,
      laneGap: args.laneGap,
      arrowheadClearance: args.arrowheadClearance,
      portGap: args.portGap,
    });
    const start = best.points[0] ?? fnNodeCenter(source);
    const end = best.points.at(-1) ?? fnNodeCenter(target);

    planned.push({
      ...transition,
      points: best.points,
      start,
      end,
    });
    usedPorts.push(start, end);
    avoidSegments.push(...fnPathSegments(best.points));
  }

  return planned;
}
