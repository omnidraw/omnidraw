import Konva from "konva";
import { describe, expect, test } from "vitest";
import { fxToElement } from "../../../src/plugins/text/fx.to-text-element";

describe("text scale persistence", () => {
  test("fxToElement preserves scale and keeps style font token canonical", () => {
    const node = new Konva.Text({
      id: "text-1",
      x: 20,
      y: 30,
      width: 120,
      height: 40,
      text: "hello",
      fontSize: 16,
      fontFamily: "Arial",
      align: "center",
      verticalAlign: "middle",
      opacity: 0.6,
    });
    node.scale({ x: 2, y: 2 });
    node.setAttr("vcElementStyle", {
      strokeColor: "@red/700",
      fontSize: "@text/s",
    });

    const element = fxToElement({
      editor: { toGroup: () => null },
    }, {
      node,
      createdAt: 1,
      updatedAt: 2,
    });

    expect(element.scaleX).toBe(2);
    expect(element.scaleY).toBe(2);
    expect(element.style.fontSize).toBe("@text/s");
    expect(element.style.textAlign).toBe("center");
    expect(element.style.verticalAlign).toBe("middle");
    expect(element.data.type).toBe("text");
    if (element.data.type !== "text") {
      throw new Error("expected text");
    }
    expect("fontSize" in element.data).toBe(false);
    expect(element.data.w).toBe(120);
    expect(element.data.h).toBe(40);
  });
});
