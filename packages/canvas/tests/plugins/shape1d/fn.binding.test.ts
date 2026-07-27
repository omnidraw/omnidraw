import { describe, expect, it } from "vitest";
import {
  fnShape1dBinding,
  fnShape1dBindingWorldPoint,
} from "../../../src/plugins/shape1d/fn.binding";

describe("shape1d product bindings", () => {
  it("stores a stable normalized anchor and resolves it after target resize", () => {
    const binding = fnShape1dBinding({
      targetId: "shape",
      worldPoint: { x: 150, y: 75 },
      worldBounds: { minX: 100, minY: 50, maxX: 200, maxY: 100 },
    });

    expect(binding).toEqual({
      targetId: "shape",
      anchor: { x: 0.5, y: 0.5 },
    });
    expect(fnShape1dBindingWorldPoint({
      binding: binding!,
      worldBounds: { minX: 200, minY: 100, maxX: 400, maxY: 300 },
    })).toEqual({ x: 300, y: 200 });
  });

  it("clamps anchors and rejects degenerate target bounds", () => {
    expect(fnShape1dBinding({
      targetId: "shape",
      worldPoint: { x: -50, y: 500 },
      worldBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    })).toEqual({
      targetId: "shape",
      anchor: { x: 0, y: 1 },
    });
    expect(fnShape1dBinding({
      targetId: "shape",
      worldPoint: { x: 0, y: 0 },
      worldBounds: { minX: 0, minY: 0, maxX: 0, maxY: 100 },
    })).toBeNull();
  });
});
