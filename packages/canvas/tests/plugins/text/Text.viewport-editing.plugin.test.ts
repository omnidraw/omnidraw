import Konva from "konva";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test } from "vitest";
import { createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

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

function expectTextareaOverlayToMatchNode(node: Konva.Text, textarea: HTMLTextAreaElement) {
  const absolutePosition = node.getAbsolutePosition();
  const absoluteScale = node.getAbsoluteScale();

  expect(textarea.style.left).toBe(`${absolutePosition.x}px`);
  expect(textarea.style.top).toBe(`${absolutePosition.y}px`);
  expect(parseFloat(textarea.style.width)).toBeCloseTo(Math.max(node.width() * absoluteScale.x, 4), 5);
  expect(parseFloat(textarea.style.fontSize)).toBeCloseTo(node.fontSize() * absoluteScale.x, 5);
  expect(textarea.style.transform).toBe(`rotate(${node.getAbsoluteRotation()}deg)`);
}

describe("text edit viewport sync", () => {
  test("entering edit mode mounts a focused textarea overlay", async () => {
    const harness = await createNewCanvasHarness();
    const node = addHydratedTextNode(harness, createTextElement({
      id: "viewport-edit-state-1",
      data: {
        ...createTextElement().data,
        text: "viewport edit",
      },
    }));

    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement | null;

    expect(textarea).not.toBeNull();
    expect(node.visible()).toBe(false);
    expect(harness.stage.container().ownerDocument.activeElement).toBe(textarea);
    expectTextareaOverlayToMatchNode(node, textarea!);

    await harness.destroy();
  });

  test("panning while editing should move the textarea overlay with canvas space and keep edit mode active", async () => {
    const harness = await createNewCanvasHarness();
    const camera = harness.runtime.services.require("camera");
    const node = addHydratedTextNode(harness, createTextElement({
      id: "viewport-pan-1",
      data: {
        ...createTextElement().data,
        text: "pan me away",
      },
    }));

    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    expectTextareaOverlayToMatchNode(node, textarea);

    camera.pan(400, 0);
    await flushCanvasEffects();

    expect(harness.stage.container().ownerDocument.activeElement).toBe(textarea);
    expectTextareaOverlayToMatchNode(node, textarea);
    expect(parseFloat(textarea.style.left) + parseFloat(textarea.style.width)).toBeLessThan(0);

    await harness.destroy();
  });

  test("zooming while editing should reposition and scale the textarea overlay with canvas space and keep edit mode active", async () => {
    const harness = await createNewCanvasHarness();
    const camera = harness.runtime.services.require("camera");
    const node = addHydratedTextNode(harness, createTextElement({
      id: "viewport-zoom-1",
      data: {
        ...createTextElement().data,
        text: "zoom me",
      },
    }));

    await openEdit(node);

    const textarea = harness.stage.container().querySelector("textarea") as HTMLTextAreaElement;
    const initialWidth = parseFloat(textarea.style.width);
    const initialFontSize = parseFloat(textarea.style.fontSize);
    expectTextareaOverlayToMatchNode(node, textarea);

    camera.zoomAtScreenPoint(2, { x: 220, y: 180 });
    await flushCanvasEffects();

    expect(harness.stage.container().ownerDocument.activeElement).toBe(textarea);
    expectTextareaOverlayToMatchNode(node, textarea);
    expect(parseFloat(textarea.style.width)).toBeGreaterThan(initialWidth);
    expect(parseFloat(textarea.style.fontSize)).toBeGreaterThan(initialFontSize);

    await harness.destroy();
  });
});
