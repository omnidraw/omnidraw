import Konva from "konva";
import { describe, expect, test } from "vitest";
import { fxToTElement } from "../../../src/plugins/shape1d/fx.node";

describe("shape1d scale persistence", () => {
  test("fxToTElement preserves element scale instead of baking points", () => {
    const node = new Konva.Line({
      id: "line-1",
      x: 10,
      y: 20,
      stroke: "#111111",
      strokeWidth: 4,
      opacity: 0.75,
    });
    node.scale({ x: 2, y: 3 });
    node.setAttr("vcElementCreatedAt", 1);
    node.setAttr("vcZIndex", "z-1");
    node.setAttr("vcElementData", {
      type: "line",
      lineType: "straight",
      points: [[0, 0], [20, 10]],
      startBinding: null,
      endBinding: null,
    });
    node.setAttr("vcElementStyle", {
      strokeColor: "@blue/700",
      strokeWidth: "@stroke-width/medium",
      opacity: 0.75,
    });

    const element = fxToTElement({
      editor: { toGroup: () => null },
      now: () => 5,
    }, {
      node: node as never,
    });

    expect(element.scaleX).toBe(2);
    expect(element.scaleY).toBe(3);
    expect(element.style.strokeWidth).toBe("@stroke-width/medium");
    expect(element.data.type).toBe("line");
    if (element.data.type !== "line") {
      throw new Error("expected line");
    }
    expect(element.data.points).toEqual([[0, 0], [20, 10]]);
  });
});
