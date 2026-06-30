import Konva from "konva";
import { describe, expect, test } from "vitest";
import { fxPenPathToElement } from "../../../src/plugins/pen/fx.path";

describe("pen scale persistence", () => {
  test("fxPenPathToElement preserves element scale instead of baking pen points", () => {
    const node = new Konva.Path({
      id: "pen-1",
      x: 15,
      y: 25,
      data: "M0 0",
      fill: "#111111",
      opacity: 0.5,
    });
    node.scale({ x: 1.5, y: 1.5 });
    node.setAttr("vcElementCreatedAt", 1);
    node.setAttr("vcElementData", {
      type: "pen",
      points: [[0, 0], [10, 5]],
      pressures: [0.5, 0.5],
      simulatePressure: true,
    });
    node.setAttr("vcElementStyle", {
      backgroundColor: "@purple/700",
      strokeWidth: "@stroke-width/thick",
      opacity: 0.5,
    });
    node.setAttr("vcPenStrokeWidth", 7);

    const element = fxPenPathToElement({
      editor: { toGroup: () => null },
      now: () => 5,
    }, {
      node,
    });

    expect(element.scaleX).toBe(1.5);
    expect(element.scaleY).toBe(1.5);
    expect(element.style.strokeWidth).toBe("@stroke-width/thick");
    expect(element.data.type).toBe("pen");
    if (element.data.type !== "pen") {
      throw new Error("expected pen");
    }
    expect(element.data.points).toEqual([[0, 0], [10, 5]]);
  });
});
