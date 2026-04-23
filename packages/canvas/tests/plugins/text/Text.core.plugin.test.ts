import Konva from "konva";
import type { TElement, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test } from "vitest";
import { fxToElement } from "../../../src/plugins/text/fx.to-text-element";
import { txUpdateTextNodeFromElement } from "../../../src/plugins/text/tx.update-text-node-from-element";
import { THEME_ID_DARK } from "@vibecanvas/service-theme";
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
  const canvasRegistry = harness.runtime.services.require("canvasRegistry");
  const node = canvasRegistry.createNodeFromElement(element ?? createTextElement());
  if (!(node instanceof Konva.Text)) {
    throw new Error("Expected text node");
  }
  harness.staticForegroundLayer.add(node);
  harness.staticForegroundLayer.batchDraw();
  return node;
}

function simulateTransformerResize(transformer: Konva.Transformer, node: Konva.Text, args: { scaleX: number; scaleY: number }) {
  transformer.fire("transformstart", { target: node, currentTarget: transformer, evt: {} as Event });
  node.scaleX(node.scaleX() * args.scaleX);
  node.scaleY(node.scaleY() * args.scaleY);
  node.fire("transform", { target: node, currentTarget: node, evt: {} as Event });
  transformer.fire("transformend", { target: node, currentTarget: transformer, evt: {} as Event });
}

function simulateTransformerRotate(transformer: Konva.Transformer, node: Konva.Text, args: { rotation: number }) {
  const originalGetActiveAnchor = transformer.getActiveAnchor.bind(transformer);
  transformer.getActiveAnchor = () => "rotater";
  transformer.fire("transformstart", { target: node, currentTarget: transformer, evt: {} as Event });
  node.rotation(args.rotation);
  node.fire("transform", { target: node, currentTarget: node, evt: {} as Event });
  transformer.fire("transformend", { target: node, currentTarget: transformer, evt: {} as Event });
  transformer.getActiveAnchor = originalGetActiveAnchor;
}

describe("new Text plugin core", () => {
  test("createNodeFromElement hydrates a Konva.Text and canvasRegistry.toElement serializes it back", async () => {
    const harness = await createNewCanvasHarness();
    const canvasRegistry = harness.runtime.services.require("canvasRegistry");
    const render = harness.runtime.services.require("scene");

    const element = createTextElement({
      id: "text-hydrate-1",
      x: 50,
      y: 80,
      data: {
        ...createTextElement().data,
        text: "Hello world",
      },
    });

    const node = addHydratedTextNode(harness, element);
    const roundTrip = fxToElement({ editor: canvasRegistry }, { node, createdAt: element.createdAt, updatedAt: element.updatedAt });
    const data = roundTrip.data as TTextData;

    expect(node.text()).toBe("Hello world");
    expect(data.text).toBe("Hello world");
    expect(roundTrip.style.fontSize).toBe("@text/s");
    expect(roundTrip.style.textAlign).toBe("left");
    expect(canvasRegistry.toElement(node)?.data.type).toBe("text");

    await harness.destroy();
  });

  test("token text color repaints on theme change and round-trips stored token", async () => {
    const harness = await createNewCanvasHarness();
    const theme = harness.runtime.services.require("theme");
    const canvasRegistry = harness.runtime.services.require("canvasRegistry");
    const node = addHydratedTextNode(harness, createTextElement({
      id: "text-token-1",
      style: {
        opacity: 1,
        strokeColor: "@purple/700",
      },
    }));

    expect(node.fill()).toBe("#7e22ce");
    expect(canvasRegistry.toElement(node)?.style.strokeColor).toBe("@purple/700");

    theme.setTheme(THEME_ID_DARK);
    await flushCanvasEffects();

    expect(node.fill()).toBe("#c084fc");
    expect(canvasRegistry.toElement(node)?.style.strokeColor).toBe("@purple/700");

    await harness.destroy();
  });

  test("committing text through edit mode patches CRDT", async () => {
    const docHandle = createMockDocHandle();
    const harness = await createNewCanvasHarness({ docHandle });

    const node = addHydratedTextNode(harness, createTextElement({ id: "crdt-text-1", data: { ...createTextElement().data, text: "" } }));

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

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Hello CRDT";
    textarea.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();

    const data = docHandle.doc().elements["crdt-text-1"].data as TTextData;
    expect(data.text).toBe("Hello CRDT");
    expect(node.text()).toBe("Hello CRDT");

    await harness.destroy();
  });

  test("multiline text commit preserves newlines", async () => {
    const docHandle = createMockDocHandle();
    const harness = await createNewCanvasHarness({ docHandle });

    const node = addHydratedTextNode(harness, createTextElement({ id: "crdt-nl-1", data: { ...createTextElement().data, text: "" } }));

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

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "first line\nsecond line\nthird line";
    textarea.dispatchEvent(new Event("blur"));
    await flushCanvasEffects();

    const data = docHandle.doc().elements["crdt-nl-1"].data as TTextData;
    expect(data.text.split("\n")).toHaveLength(3);
    expect(node.text()).toBe("first line\nsecond line\nthird line");

    await harness.destroy();
  });

  test("drag undo and redo restore text position", async () => {
    const harness = await createNewCanvasHarness();
    const history = harness.runtime.services.require("history");

    const node = addHydratedTextNode(harness, createTextElement({ id: "drag-text-1", x: 50, y: 60, data: { ...createTextElement().data, text: "drag me" } }));
    const startPos = { ...node.absolutePosition() };

    node.fire("dragstart", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragstart", { bubbles: true }),
    });
    node.setAbsolutePosition({ x: startPos.x + 100, y: startPos.y + 50 });
    node.fire("dragend", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragend", { bubbles: true }),
    });

    expect(node.absolutePosition().x).toBeCloseTo(startPos.x + 100, 1);
    expect(history.canUndo()).toBe(true);

    history.undo();
    await flushCanvasEffects();
    expect(node.absolutePosition().x).toBeCloseTo(startPos.x, 1);

    history.redo();
    await flushCanvasEffects();
    expect(node.absolutePosition().x).toBeCloseTo(startPos.x + 100, 1);

    await harness.destroy();
  });

  test("transform rotate persists text rotation and undo restores original values", async () => {
    const harness = await createNewCanvasHarness();
    const history = harness.runtime.services.require("history");
    const selection = harness.runtime.services.require("selection");

    const node = addHydratedTextNode(harness, createTextElement({
      id: "rotate-text-1",
      x: 150,
      y: 150,
      rotation: 0,
    }));

    selection.setSelection([node]);
    await flushCanvasEffects();

    const transformer = harness.dynamicLayer.findOne<Konva.Transformer>("Transformer");
    expect(transformer).toBeTruthy();

    simulateTransformerRotate(transformer!, node, { rotation: 32 });
    await flushCanvasEffects();

    expect(node.rotation()).toBeCloseTo(32, 1);
    history.undo();
    await flushCanvasEffects();
    expect(node.rotation()).toBeCloseTo(0, 1);

    await harness.destroy();
  });

});
