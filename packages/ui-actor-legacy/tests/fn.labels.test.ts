import { describe, expect, it } from "vitest";
import { fnPlaceLabels } from "../src/fn.labels";

describe("fnPlaceLabels", () => {
  it("separates colliding labels and avoids obstacles when a candidate is available", () => {
    const placed = fnPlaceLabels({
      labels: [
        { key: "one", x: 100, y: 100, w: 70, h: 28 },
        { key: "two", x: 100, y: 100, w: 70, h: 28 },
      ],
      obstacles: [{ x: 65, y: 86, w: 70, h: 28 }],
      space: { w: 260, h: 220 },
    });

    expect(placed).toHaveLength(2);
    expect(placed[0]?.y).not.toBe(100);
    expect(`${placed[0]?.x},${placed[0]?.y}`).not.toBe(`${placed[1]?.x},${placed[1]?.y}`);
  });
});
