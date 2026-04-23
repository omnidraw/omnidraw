import Konva from "konva";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test } from "vitest";
import { createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function createRectElement(id: string, x: number, y: number): TElement {
  return {
    id,
    x,
    y,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 1,
    locked: false,
    parentGroupId: null,
    zIndex: id === "rect-a" ? "z0001" : "z0002",
    style: {
      backgroundColor: "#ffffff",
      strokeColor: "#111111",
      strokeWidth: "@stroke-width/medium",
      opacity: 1,
    },
    data: {
      type: "rect",
      w: 120,
      h: 80,
    },
  };
}

function addRectNode(
  harness: Awaited<ReturnType<typeof createNewCanvasHarness>>,
  element: TElement,
) {
  const elementService = harness.runtime.services.require("element");
  const node = elementService.createNodeFromElement(element);

  if (!(node instanceof Konva.Rect)) {
    throw new Error("Expected Konva.Rect node");
  }

  harness.staticForegroundLayer.add(node);
  harness.staticForegroundLayer.batchDraw();
  return node;
}

describe("group plugin regressions", () => {
  test("grouping two rectangles should create a persisted group and select it", async () => {
    const harness = await createNewCanvasHarness();
    const selection = harness.runtime.services.require("selection");

    const rectA = addRectNode(harness, createRectElement("rect-a", 40, 60));
    const rectB = addRectNode(harness, createRectElement("rect-b", 240, 60));

    selection.setSelection([rectA, rectB]);
    selection.setFocusedNode(rectB);

    harness.runtime.hooks.keydown.call(new KeyboardEvent("keydown", {
      key: "g",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await flushCanvasEffects();

    const groups = Object.values(harness.docHandle.doc().groups);

    expect(groups).toHaveLength(1);
    expect(selection.selection).toHaveLength(1);
    expect(selection.selection[0]).toBeInstanceOf(Konva.Group);
    expect(rectA.getParent()).toBe(selection.selection[0]);
    expect(rectB.getParent()).toBe(selection.selection[0]);

    await harness.destroy();
  });
});
