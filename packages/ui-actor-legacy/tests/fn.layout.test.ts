import { describe, expect, it } from "vitest";
import { fnLayoutStateMachine } from "../src/fn.layout";

const SPACE = { w: 820, h: 520 };
const BOX = { w: 210, h: 92 };
const CLEARANCE = 54;
const STATES = [
  { name: "booting" },
  { name: "ready" },
  { name: "busy.inspecting" },
  { name: "waiting.scope" },
  { name: "error" },
  { name: "error.validation" },
];
const TRANSITIONS = [
  { source: "booting", target: "ready" },
  { source: "ready", target: "busy.inspecting" },
  { source: "busy.inspecting", target: "ready" },
  { source: "busy.inspecting", target: "waiting.scope" },
  { source: "waiting.scope", target: "busy.inspecting" },
  { source: "busy.inspecting", target: "error.validation" },
];

function toRect(position: { x: number; y: number }) {
  return {
    x: position.x * SPACE.w,
    y: position.y * SPACE.h,
    w: BOX.w,
    h: BOX.h,
  };
}

function expandedIntersects(left: ReturnType<typeof toRect>, right: ReturnType<typeof toRect>) {
  return left.x - CLEARANCE < right.x + right.w
    && left.x + left.w + CLEARANCE > right.x
    && left.y - CLEARANCE < right.y + right.h
    && left.y + left.h + CLEARANCE > right.y;
}

describe("fnLayoutStateMachine", () => {
  it("returns relative coordinates inside the requested space", () => {
    const positions = fnLayoutStateMachine({
      states: STATES,
      transitions: TRANSITIONS,
      space: SPACE,
      box: BOX,
      clearance: CLEARANCE,
    });

    expect(positions).toHaveLength(6);
    expect(positions.every((position) => position.x >= 0 && position.x <= 1)).toBe(true);
    expect(positions.every((position) => position.y >= 0 && position.y <= 1)).toBe(true);
    expect(positions.find((position) => position.name === "error.validation")?.y)
      .toBeGreaterThan(positions.find((position) => position.name === "error")?.y ?? 0);
  });

  it("is deterministic for the same graph and dimensions", () => {
    const first = fnLayoutStateMachine({
      states: STATES,
      transitions: TRANSITIONS,
      space: SPACE,
      box: BOX,
      clearance: CLEARANCE,
    });
    const second = fnLayoutStateMachine({
      states: STATES,
      transitions: TRANSITIONS,
      space: SPACE,
      box: BOX,
      clearance: CLEARANCE,
    });

    expect(second).toEqual(first);
  });

  it("keeps expanded state boxes apart enough for arrow and label lanes", () => {
    const positions = fnLayoutStateMachine({
      states: STATES,
      transitions: TRANSITIONS,
      space: SPACE,
      box: BOX,
      clearance: CLEARANCE,
    });
    const rects = positions.map((position) => ({ name: position.name, rect: toRect(position) }));

    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        const left = rects[leftIndex];
        const right = rects[rightIndex];

        expect(left && right && expandedIntersects(left.rect, right.rect), `${left?.name} overlaps ${right?.name}`).toBe(false);
      }
    }
  });
});
