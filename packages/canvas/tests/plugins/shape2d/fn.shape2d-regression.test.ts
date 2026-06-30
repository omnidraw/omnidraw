import { describe, expect, test } from "vitest";
import { fnCreateShape2dElement } from "../../../src/core/fn.shape2d";
import { fxApplyRememberedShape2dToolStyle, fxGetShape2dToolDefaults } from "../../../src/plugins/shape2d/Shape2d.plugin";

describe("shape2d default style regression", () => {
  test("fnCreateShape2dElement does not hardcode a red background color", () => {
    const element = fnCreateShape2dElement({
      id: "rect-1",
      type: "rect",
      x: 10,
      y: 20,
      rotation: 0,
      width: 100,
      height: 80,
      createdAt: 1,
      updatedAt: 1,
      parentGroupId: null,
      zIndex: "",
    });

    expect(element.style.backgroundColor).toBeUndefined();
    expect(element.style.opacity).toBe(1);
    expect(element.style.strokeWidth).toBe("@stroke-width/none");
  });

  test("shape2d defaults use the stable token we expect, not red or light-mode white", () => {
    expect(fxGetShape2dToolDefaults().fillColor).toBe("@base/300");
    expect(fxGetShape2dToolDefaults().fillColor).not.toBe("red");
    expect(fxGetShape2dToolDefaults().fillColor).not.toBe("@base/100");
  });

  test("tool defaults can seed fill without being overridden by a built-in red default", () => {
    const baseElement = fnCreateShape2dElement({
      id: "rect-2",
      type: "rect",
      x: 10,
      y: 20,
      rotation: 0,
      width: 100,
      height: 80,
      createdAt: 1,
      updatedAt: 1,
      parentGroupId: null,
      zIndex: "",
    });

    const nextElement = fxApplyRememberedShape2dToolStyle({
      element: baseElement,
      rememberedStyle: {},
    });

    expect(nextElement.style.backgroundColor).toBe("@base/300");
    expect(nextElement.style.backgroundColor).not.toBe("red");
  });
});
