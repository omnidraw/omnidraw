import { describe, expect, it } from "vitest";
import { fnRouteElbowArrow } from "../src/fn.elbow";

describe("fnRouteElbowArrow", () => {
  it("returns orthogonal points from start to end", () => {
    const points = fnRouteElbowArrow({
      start: { x: 10, y: 20 },
      end: { x: 160, y: 120 },
      obstacles: [],
      padding: 12,
    });

    expect(points[0]).toEqual({ x: 10, y: 20 });
    expect(points.at(-1)).toEqual({ x: 160, y: 120 });
    expect(points.every((point, index) => {
      const previous = points[index - 1];

      return !previous || previous.x === point.x || previous.y === point.y;
    })).toBe(true);
  });

  it("routes around expanded obstacle zones", () => {
    const points = fnRouteElbowArrow({
      start: { x: 0, y: 50 },
      end: { x: 200, y: 50 },
      obstacles: [{ x: 80, y: 20, w: 40, h: 80 }],
      padding: 10,
    });

    expect(points.some((point) => point.y <= 10 || point.y >= 110)).toBe(true);
    expect(points.every((point) => !(point.x > 70 && point.x < 130 && point.y > 10 && point.y < 110))).toBe(true);
  });

  it("can produce separate lanes when callers use distinct start and end ports", () => {
    const down = fnRouteElbowArrow({
      start: { x: 90, y: 0 },
      end: { x: 90, y: 180 },
      obstacles: [],
      padding: 10,
    });
    const up = fnRouteElbowArrow({
      start: { x: 130, y: 180 },
      end: { x: 130, y: 0 },
      obstacles: [],
      padding: 10,
    });

    expect(down.map((point) => `${point.x},${point.y}`).join(" ")).not.toBe(up.map((point) => `${point.x},${point.y}`).join(" "));
  });

  it("prefers alternate lanes around previously drawn segments", () => {
    const direct = fnRouteElbowArrow({
      start: { x: 0, y: 40 },
      end: { x: 200, y: 40 },
      obstacles: [],
      padding: 12,
    });
    const separated = fnRouteElbowArrow({
      start: { x: 0, y: 40 },
      end: { x: 200, y: 40 },
      obstacles: [],
      padding: 12,
      avoidSegments: [{ from: { x: 0, y: 40 }, to: { x: 200, y: 40 } }],
      laneGap: 24,
    });

    expect(direct).toEqual([{ x: 0, y: 40 }, { x: 200, y: 40 }]);
    expect(separated.some((point) => point.y !== 40)).toBe(true);
  });
});
