import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test } from "vitest";
import {
  createMockDocHandle,
  createNewCanvasHarness,
} from "../../new-test-setup";

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

describe("group plugin regressions", () => {
  test("grouping two rects persists hierarchy and selects its semantic group", async () => {
    const rectA = createRectElement("rect-a", 40, 60);
    const rectB = createRectElement("rect-b", 240, 60);
    const docHandle = createMockDocHandle({
      elements: {
        [rectA.id]: rectA,
        [rectB.id]: rectB,
      },
    });
    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");
    selection.setSelection([
      { kind: "element", id: rectA.id },
      { kind: "element", id: rectB.id },
    ]);
    selection.setFocusedTarget({ kind: "element", id: rectB.id });

    harness.runtime.hooks.keydown.call(new KeyboardEvent("keydown", {
      key: "g",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await harness.flush();

    const document = harness.docHandle.doc();
    const groups = Object.values(document.groups);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(document.elements[rectA.id]?.parentGroupId).toBe(group.id);
    expect(document.elements[rectB.id]?.parentGroupId).toBe(group.id);
    expect(selection.selection).toEqual([{
      kind: "group",
      id: group.id,
    }]);
    expect(selection.focused).toEqual({
      kind: "group",
      id: group.id,
    });
    expect(harness.scene.projectionIndex?.groupNodeIds[group.id]).toBeDefined();

    await harness.destroy();
  });
});
