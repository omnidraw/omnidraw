import Konva from "konva";
import { describe, expect, test } from "vitest";
import { fnCreateShape2dElement } from "../../../src/core/fn.shape2d";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function createRectElement(id: string) {
  return fnCreateShape2dElement({
    id,
    type: "rect",
    x: 120,
    y: 140,
    rotation: 0,
    width: 220,
    height: 120,
    createdAt: 1,
    updatedAt: 1,
    parentGroupId: null,
    zIndex: "z0001",
    style: {
      backgroundColor: "@base/300",
      strokeColor: "@base/900",
      strokeWidth: "@stroke-width/thin",
      opacity: 1,
    },
  });
}

async function openShapeInlineEdit(node: Konva.Shape) {
  node.fire("pointerdown", {
    target: node,
    currentTarget: node,
    evt: new MouseEvent("pointerdown", { bubbles: true }),
  });
  await flushCanvasEffects();

  node.fire("pointerdblclick", {
    target: node,
    currentTarget: node,
    evt: new MouseEvent("pointerdblclick", { bubbles: true }),
  });
  await flushCanvasEffects();
}

describe("shape2d inline text ownership", () => {
  test("double-click editing persists inline text onto the shape element", async () => {
    const rect = createRectElement("shape-inline-1");
    const docHandle = createMockDocHandle({
      elements: {
        [rect.id]: structuredClone(rect),
      },
    });
    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");

    const shapeNode = harness.staticForegroundLayer.findOne<Konva.Rect>(`#${rect.id}`);
    if (!(shapeNode instanceof Konva.Rect)) {
      throw new Error("Expected hydrated rect node");
    }

    await openShapeInlineEdit(shapeNode);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    textarea!.value = "Inline hello";
    textarea!.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();

    const persistedRect = docHandle.doc().elements[rect.id];
    expect(persistedRect.data.type).toBe("rect");
    if (persistedRect.data.type === "rect") {
      expect(persistedRect.data.text?.text).toBe("Inline hello");
      expect(persistedRect.data.text?.fontFamily).toBe("Arial");
    }

    expect(Object.values(docHandle.doc().elements).filter((element) => element.data.type === "text")).toHaveLength(0);

    const inlineTextNode = harness.staticForegroundLayer.findOne<Konva.Text>(`#${rect.id}::inline-text`);
    expect(inlineTextNode).toBeInstanceOf(Konva.Text);
    expect(inlineTextNode?.text()).toBe("Inline hello");
    expect(selection.focusedId).toBe(rect.id);
    expect(selection.selection.map((node) => node.id())).toEqual([rect.id]);

    await harness.destroy();
  });
});
