import Konva from "konva";
import type { TElement, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test } from "vitest";
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

describe("new Text plugin editing", () => {
  test("committing multiline text preserves newlines in node and CRDT", async () => {
    const docHandle = createMockDocHandle();
    const harness = await createNewCanvasHarness({ docHandle });

    const node = addHydratedTextNode(harness, createTextElement({ id: "nl-text-1", data: { ...createTextElement().data, text: "" } }));
    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.style.whiteSpace).toBe("pre-wrap");

    textarea.value = "Hello\nWorld\n  indented";
    textarea.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();

    expect(node.text()).toBe("Hello\nWorld\n  indented");
    const data = docHandle.doc().elements["nl-text-1"].data as TTextData;
    expect(data.text).toBe("Hello\nWorld\n  indented");

    await harness.destroy();
  });

  test("textarea auto-sizes on open for existing multiline text", async () => {
    const harness = await createNewCanvasHarness();

    const node = addHydratedTextNode(harness, createTextElement({
      id: "autogrow-open-1",
      data: {
        ...createTextElement().data,
        h: 80,
        text: "first line\nsecond line\nthird line",
      },
    }));
    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    expect(parseFloat(textarea.style.height)).toBeGreaterThan(0);
    expect(textarea.value).toBe("first line\nsecond line\nthird line");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushCanvasEffects();
    expect(harness.stage.container().querySelector("textarea")).toBeNull();

    await harness.destroy();
  });

  test("edit mode textarea uses the text color", async () => {
    const harness = await createNewCanvasHarness();
    const theme = harness.runtime.services.require("theme");

    const node = addHydratedTextNode(harness, createTextElement({
      id: "color-text-1",
      style: {
        opacity: 1,
        strokeColor: "@purple/700",
      },
    }));
    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    const probe = harness.stage.container().ownerDocument.createElement("div");
    probe.style.color = theme.resolveThemeColor("@purple/700", theme.getTheme().colors.canvasText) ?? theme.getTheme().colors.canvasText;

    expect(textarea.style.color).toBe(probe.style.color);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushCanvasEffects();

    await harness.destroy();
  });

  test("Escape saves free text edits without double-cleanup errors", async () => {
    const docHandle = createMockDocHandle();
    const harness = await createNewCanvasHarness({ docHandle });

    const node = addHydratedTextNode(harness, createTextElement({
      id: "escape-save-text-1",
      data: {
        ...createTextElement().data,
        text: "original",
      },
    }));
    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "saved on escape";

    expect(() => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    }).not.toThrow();
    await flushCanvasEffects();

    expect(harness.stage.container().querySelector("textarea")).toBeNull();
    expect(node.text()).toBe("saved on escape");
    expect((docHandle.doc().elements["escape-save-text-1"].data as TTextData).text).toBe("saved on escape");

    await harness.destroy();
  });

  test("leading and trailing whitespace is preserved", async () => {
    const harness = await createNewCanvasHarness();

    const node = addHydratedTextNode(harness, createTextElement({ id: "ws-text-1", data: { ...createTextElement().data, text: "" } }));
    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "  spaces  ";
    textarea.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();

    expect(node.text()).toBe("  spaces  ");

    await harness.destroy();
  });

  test("undo and redo after multiline edit restore text", async () => {
    const harness = await createNewCanvasHarness();
    const history = harness.runtime.services.require("history");

    const node = addHydratedTextNode(harness, createTextElement({
      id: "undo-nl-text-1",
      data: {
        ...createTextElement().data,
        h: 50,
        text: "original",
      },
    }));
    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "line1\nline2\nline3";
    textarea.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();

    history.undo();
    await flushCanvasEffects();
    expect(node.text()).toBe("original");

    history.redo();
    await flushCanvasEffects();
    expect(node.text()).toBe("line1\nline2\nline3");

    await harness.destroy();
  });

  test("Enter inserts newline and keeps edit mode open", async () => {
    const harness = await createNewCanvasHarness();

    const node = addHydratedTextNode(harness, createTextElement({ id: "enter-text-1", data: { ...createTextElement().data, text: "alpha" } }));
    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const notCanceled = textarea.dispatchEvent(enterEvent);
    await flushCanvasEffects();

    expect(notCanceled).toBe(false);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(textarea.value).toBe("alpha\n");
    expect(harness.stage.container().querySelector("textarea")).toBe(textarea);

    textarea.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();
    expect(node.text()).toBe("alpha\n");

    await harness.destroy();
  });
});
