import Konva from "konva";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test, vi } from "vitest";
import { createNewCanvasHarness, createMockDocHandle, flushCanvasEffects } from "../../new-test-setup";

function createTextElement(overrides?: Partial<TElement>): TElement {
  return {
    id: "text-1",
    x: 100,
    y: 120,
    rotation: 0,
    bindings: [],
    locked: false,
    parentGroupId: null,
    zIndex: "",
    createdAt: 1,
    updatedAt: 1,
    style: {
      opacity: 1,
      strokeColor: "#000000",
    },
    data: {
      type: "text",
      w: 200,
      h: 30,
      text: "hello",
      originalText: "hello",
      fontFamily: "Arial",
      link: null,
      containerId: null,
      autoResize: false,
    },
    ...overrides,
  };
}

function firePointerUp(harness: Awaited<ReturnType<typeof createNewCanvasHarness>>, x: number, y: number) {
  const originalGetPos = harness.staticForegroundLayer.getRelativePointerPosition.bind(harness.staticForegroundLayer);
  harness.staticForegroundLayer.getRelativePointerPosition = () => ({ x, y });

  harness.runtime.hooks.pointerUp.call({
    target: harness.stage,
    currentTarget: harness.stage,
    evt: new PointerEvent("pointerup"),
    cancelBubble: false,
  } as unknown as Konva.KonvaEventObject<PointerEvent>);

  harness.staticForegroundLayer.getRelativePointerPosition = originalGetPos;
}

function addHydratedTextNode(harness: Awaited<ReturnType<typeof createNewCanvasHarness>>, element?: TElement) {
  const elementService = harness.runtime.services.require("element");
  const node = elementService.createNodeFromElement(element ?? createTextElement());
  if (!(node instanceof Konva.Text)) {
    throw new Error("Expected text node");
  }
  harness.staticForegroundLayer.add(node);
  harness.staticForegroundLayer.batchDraw();
  return node;
}

async function openEdit(node: Konva.Text) {
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

describe("new Text plugin regressions", () => {
  test("Escape on a newly created empty text removes the node", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const session = harness.runtime.services.require("session");

    tool.setActiveTool("text");
    await flushCanvasEffects();

    firePointerUp(harness, 100, 150);
    await flushCanvasEffects();

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(harness.staticForegroundLayer.find("Text")).toHaveLength(1);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushCanvasEffects();

    expect(harness.stage.container().querySelector("textarea")).toBeNull();
    expect(harness.staticForegroundLayer.find("Text")).toHaveLength(0);
    expect(session.editingId).toBeNull();

    await harness.destroy();
  });

  test("Escape on existing text saves the latest content", async () => {
    const docHandle = createMockDocHandle();
    const harness = await createNewCanvasHarness({ docHandle });
    const node = addHydratedTextNode(harness, createTextElement({ id: "escape-existing", data: { ...createTextElement().data, text: "original" } }));

    await openEdit(node);
    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "saved on escape";
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushCanvasEffects();

    expect(harness.stage.container().querySelector("textarea")).toBeNull();
    expect(node.text()).toBe("saved on escape");
    expect((docHandle.doc().elements["escape-existing"].data as TElement["data"] & { text: string }).text).toBe("saved on escape");

    await harness.destroy();
  });

  test("long single-line text expands textarea width and committed node width", async () => {
    const harness = await createNewCanvasHarness();
    const node = addHydratedTextNode(harness, createTextElement({ id: "wide-text", data: { ...createTextElement().data, text: "plain text" } }));

    await openEdit(node);
    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    const initialTextareaWidth = parseFloat(textarea.style.width);
    const initialNodeWidth = node.width();

    Object.defineProperty(textarea, "scrollWidth", { configurable: true, get: () => 420 });
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 20 });
    textarea.value = "this is all a single line of text but should stay on one line";
    textarea.dispatchEvent(new Event("input"));

    expect(parseFloat(textarea.style.width)).toBeGreaterThan(initialTextareaWidth);

    textarea.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();

    expect(node.width()).toBeGreaterThan(initialNodeWidth);
    expect(node.text()).toBe("this is all a single line of text but should stay on one line");

    await harness.destroy();
  });

  test("Delete key removes hydrated free text without crashing", async () => {
    const textElement = createTextElement({
      id: "delete-text-regression",
      data: {
        ...createTextElement().data,
        text: "delete me",
      },
    });
    const docHandle = createMockDocHandle({
      elements: {
        [textElement.id]: textElement,
      },
    });
    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");
    const node = harness.staticForegroundLayer.findOne<Konva.Text>(`#${textElement.id}`);

    expect(node).toBeTruthy();
    selection.setSelection([node!]);
    selection.setFocusedNode(node!);

    expect(() => {
      harness.runtime.hooks.keydown.call(new KeyboardEvent("keydown", {
        key: "Delete",
        bubbles: true,
      }));
    }).not.toThrow();

    await flushCanvasEffects();

    expect(harness.staticForegroundLayer.findOne(`#${textElement.id}`)).toBeUndefined();
    expect(docHandle.doc().elements[textElement.id]).toBeUndefined();
    expect(selection.selection).toHaveLength(0);

    await harness.destroy();
  });

  test("throttled drag patch does not patch a new text node before its first CRDT commit", async () => {
    vi.useFakeTimers();

    try {
      const docHandle = createMockDocHandle();
      const harness = await createNewCanvasHarness({ docHandle });
      const tool = harness.runtime.services.require("tool");

      tool.setActiveTool("text");
      await flushCanvasEffects();

      firePointerUp(harness, 100, 150);
      await flushCanvasEffects();

      const node = harness.staticForegroundLayer.findOne((candidate) => candidate instanceof Konva.Text) as Konva.Text | null;
      const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement | null;

      expect(node).not.toBeNull();
      expect(textarea).not.toBeNull();
      expect(docHandle.doc().elements[node!.id()]).toBeUndefined();

      node!.position({ x: 140, y: 190 });
      node!.fire("dragmove", {
        target: node!,
        currentTarget: node!,
        evt: new MouseEvent("dragmove", { bubbles: true }),
      });

      expect(() => {
        vi.runAllTimers();
      }).not.toThrow();
      expect(docHandle.doc().elements[node!.id()]).toBeUndefined();

      textarea!.value = "hello";
      textarea!.dispatchEvent(new Event("blur"));
      await flushCanvasEffects();

      expect(docHandle.doc().elements[node!.id()]).toBeDefined();
      expect((docHandle.doc().elements[node!.id()].data as TElement["data"] & { text: string }).text).toBe("hello");

      await harness.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
