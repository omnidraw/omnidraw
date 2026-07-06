import { describe, expect, it } from "vitest";
import { fnLayoutStateMachine } from "../src/fn.layout";

describe("fnLayoutStateMachine", () => {
  it("returns relative coordinates inside the requested space", () => {
    const positions = fnLayoutStateMachine({
      states: [
        { name: "booting" },
        { name: "ready" },
        { name: "busy.inspecting" },
        { name: "waiting.scope" },
        { name: "error" },
        { name: "error.validation" },
      ],
      space: { w: 820, h: 520 },
      box: { w: 210, h: 92 },
    });

    expect(positions).toHaveLength(6);
    expect(positions.every((position) => position.x >= 0 && position.x <= 1)).toBe(true);
    expect(positions.every((position) => position.y >= 0 && position.y <= 1)).toBe(true);
    expect(positions.find((position) => position.name === "error.validation")?.y)
      .toBeGreaterThan(positions.find((position) => position.name === "error")?.y ?? 0);
  });
});
