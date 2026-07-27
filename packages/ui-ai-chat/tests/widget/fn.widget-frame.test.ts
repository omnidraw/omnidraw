import { describe, expect, test } from "vitest";
import {
  fnNextWidgetZIndex,
  fnWidgetCreationBounds,
} from "../../src/widget/fn.widget-frame";

describe("widget product frame helpers", () => {
  test("normalizes click and drag creation bounds without renderer nodes", () => {
    expect(fnWidgetCreationBounds({
      commit: {
        belowThreshold: true,
        worldBounds: { minX: 10, minY: 20, maxX: 10, maxY: 20 },
        current: { world: { x: 100, y: 80 } },
      },
      defaultSize: { width: 40, height: 20 },
      minSize: { width: 10, height: 10 },
    })).toEqual({ x: 80, y: 70, width: 40, height: 20 });

    expect(fnWidgetCreationBounds({
      commit: {
        belowThreshold: false,
        worldBounds: { minX: 90, minY: 70, maxX: 20, maxY: 10 },
        current: { world: { x: 20, y: 10 } },
      },
      defaultSize: { width: 40, height: 20 },
      minSize: { width: 100, height: 76 },
    })).toEqual({ x: 20, y: 10, width: 100, height: 76 });
  });

  test("allocates a stable order after the highest durable sibling", () => {
    expect(fnNextWidgetZIndex({
      zIndices: ["z00000002", "custom", "z00000009"],
    })).toBe("z00000010");
  });
});
