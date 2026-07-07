import { describe, expect, it } from "vitest";
import { fnPlanStateMachineEdges, type TFnEdgeNode } from "../src/fn.edge";
import type { TPoint, TRect } from "../src/fn.elbow";

function segments(points: TPoint[]) {
  return points.flatMap((point, index) => {
    const next = points[index + 1];

    if (!next) {
      return [];
    }

    return [{ from: point, to: next }];
  });
}

function segmentIntersectsRect(from: TPoint, to: TPoint, rect: TRect) {
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

function distance(left: TPoint, right: TPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function pointsTowardTargetCenter(points: TPoint[], target: TFnEdgeNode) {
  const end = points.at(-1);
  const beforeEnd = points.at(-2);

  if (!end || !beforeEnd) {
    return false;
  }

  const targetCenter = {
    x: target.x + target.w / 2,
    y: target.y + target.h / 2,
  };
  const approach = {
    x: Math.sign(end.x - beforeEnd.x),
    y: Math.sign(end.y - beforeEnd.y),
  };
  const center = {
    x: Math.sign(targetCenter.x - end.x),
    y: Math.sign(targetCenter.y - end.y),
  };

  if (approach.x !== 0) {
    return approach.x === center.x && end.y === targetCenter.y;
  }

  return approach.y === center.y && end.x === targetCenter.x;
}

function leavesSourceOutward(points: TPoint[], source: TFnEdgeNode) {
  const start = points[0];
  const afterStart = points[1];

  if (!start || !afterStart) {
    return false;
  }

  const sourceCenter = {
    x: source.x + source.w / 2,
    y: source.y + source.h / 2,
  };
  const departure = {
    x: Math.sign(afterStart.x - start.x),
    y: Math.sign(afterStart.y - start.y),
  };
  const away = {
    x: Math.sign(start.x - sourceCenter.x),
    y: Math.sign(start.y - sourceCenter.y),
  };

  return departure.x !== 0 ? departure.x === away.x : departure.y === away.y;
}

function avoidsSourceAfterDeparture(points: TPoint[], source: TFnEdgeNode) {
  const sourceRect = {
    x: source.x,
    y: source.y,
    w: source.w,
    h: source.h,
  };

  return segments(points)
    .slice(1)
    .every((segment) => !segmentIntersectsRect(segment.from, segment.to, sourceRect));
}

describe("fnPlanStateMachineEdges", () => {
  it("uses different ports for reciprocal transitions", () => {
    const nodes: TFnEdgeNode[] = [
      { name: "ready", x: 100, y: 270, w: 210, h: 92 },
      { name: "busy.inspecting", x: 390, y: 120, w: 210, h: 92 },
    ];
    const planned = fnPlanStateMachineEdges({
      nodes,
      transitions: [
        { key: "ready-to-busy", source: "ready", target: "busy.inspecting" },
        { key: "busy-to-ready", source: "busy.inspecting", target: "ready" },
      ],
      padding: 24,
      laneGap: 28,
      arrowheadClearance: 9,
      portGap: 44,
    });

    expect(planned).toHaveLength(2);
    expect(distance(planned[0]?.start ?? { x: 0, y: 0 }, planned[1]?.end ?? { x: 0, y: 0 })).toBeGreaterThanOrEqual(44);
    expect(distance(planned[0]?.end ?? { x: 0, y: 0 }, planned[1]?.start ?? { x: 0, y: 0 })).toBeGreaterThanOrEqual(44);
  });

  it("does not route an edge through an unrelated state box", () => {
    const obstacle = { name: "error", x: 520, y: 225, w: 210, h: 92 };
    const nodes: TFnEdgeNode[] = [
      { name: "busy.inspecting", x: 260, y: 90, w: 210, h: 92 },
      obstacle,
      { name: "error.validation", x: 540, y: 400, w: 210, h: 92 },
    ];
    const planned = fnPlanStateMachineEdges({
      nodes,
      transitions: [
        { key: "validationFailed", source: "busy.inspecting", target: "error.validation" },
      ],
      padding: 28,
      laneGap: 30,
      arrowheadClearance: 9,
      portGap: 44,
    });
    const obstacleRect = {
      x: obstacle.x,
      y: obstacle.y,
      w: obstacle.w,
      h: obstacle.h,
    };
    const crossesObstacle = segments(planned[0]?.points ?? [])
      .some((segment) => segmentIntersectsRect(segment.from, segment.to, obstacleRect));

    expect(crossesObstacle).toBe(false);
  });

  it("points the arrowhead along the vector into the target center", () => {
    const target = { name: "busy.inspecting", x: 390, y: 120, w: 210, h: 92 };
    const nodes: TFnEdgeNode[] = [
      { name: "ready", x: 100, y: 270, w: 210, h: 92 },
      target,
    ];
    const planned = fnPlanStateMachineEdges({
      nodes,
      transitions: [
        { key: "inspect", source: "ready", target: "busy.inspecting" },
      ],
      padding: 24,
      laneGap: 28,
      arrowheadClearance: 9,
      portGap: 44,
    });

    expect(pointsTowardTargetCenter(planned[0]?.points ?? [], target)).toBe(true);
  });

  it("leaves the source box outward before routing reciprocal vertical edges", () => {
    const source = { name: "waiting.scope", x: 305, y: 385, w: 210, h: 92 };
    const target = { name: "busy.inspecting", x: 304, y: 103, w: 210, h: 92 };
    const planned = fnPlanStateMachineEdges({
      nodes: [source, target],
      transitions: [
        { key: "scopeProvided", source: "waiting.scope", target: "busy.inspecting" },
      ],
      padding: 28,
      laneGap: 28,
      arrowheadClearance: 9,
      portGap: 44,
    });

    expect(leavesSourceOutward(planned[0]?.points ?? [], source)).toBe(true);
    expect(avoidsSourceAfterDeparture(planned[0]?.points ?? [], source)).toBe(true);
    expect(pointsTowardTargetCenter(planned[0]?.points ?? [], target)).toBe(true);
  });
});
