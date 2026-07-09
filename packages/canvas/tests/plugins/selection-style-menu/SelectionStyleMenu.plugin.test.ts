import Konva from "konva";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test } from "vitest";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";
import { fnCreatePenDataFromStrokePoints, type TStrokePoint } from "../../../src/plugins/pen/fn.math";

function createPenElement(args?: {
  id?: string;
  color?: string;
  points?: TStrokePoint[];
}): TElement {
  const strokePoints = args?.points ?? [
    { x: 120, y: 80, pressure: 0.5 },
    { x: 150, y: 100, pressure: 0.55 },
    { x: 185, y: 110, pressure: 0.6 },
    { x: 220, y: 135, pressure: 0.5 },
  ];
  const penData = fnCreatePenDataFromStrokePoints({ points: strokePoints });
  if (!penData) {
    throw new Error("Failed to create pen data for test");
  }

  return {
    id: args?.id ?? "pen-1",
    x: penData.x,
    y: penData.y,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 1,
    locked: false,
    parentGroupId: null,
    zIndex: "",
    style: {
      backgroundColor: args?.color ?? "@base/900",
      opacity: 0.92,
      strokeWidth: "@stroke-width/thick",
    },
    data: {
      type: "pen",
      points: penData.points,
      pressures: penData.pressures,
      simulatePressure: penData.simulatePressure,
    },
  } satisfies TElement;
}

function getStageDom(harness: Awaited<ReturnType<typeof createNewCanvasHarness>>) {
  return harness.stage.container();
}

function getButtonByTitle(root: ParentNode, title: string, index = 0) {
  const button = root.querySelectorAll<HTMLButtonElement>(`button[title="${title}"]`)[index];
  if (!button) {
    throw new Error(`Missing button with title '${title}' at index ${index}`);
  }

  return button;
}

function clickElement(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("SelectionStyleMenu plugin", () => {
  test.each(["rect", "pen", "text"])("hides the style menu when %s is active without selection", async (toolId) => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const root = getStageDom(harness);

    tool.setActiveTool(toolId);
    await flushCanvasEffects();

    expect(root.querySelector('button[title="blue/700"]')).toBeNull();
    expect(root.querySelector('button[title="base/900"]')).toBeNull();

    await harness.destroy();
  });

  test("shows selected element style and hides after selection is cleared", async () => {
    const element = createPenElement({ id: "pen-selected", color: "@red/700" });
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });
    const harness = await createNewCanvasHarness({ docHandle });
    const tool = harness.runtime.services.require("tool");
    const selection = harness.runtime.services.require("selection");
    const root = getStageDom(harness);
    const selectedNode = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`);
    if (!(selectedNode instanceof Konva.Path)) {
      throw new Error("Expected hydrated selected pen node");
    }

    tool.setActiveTool("pen");
    await flushCanvasEffects();

    expect(root.querySelector('button[title="red/700"]')).toBeNull();

    selection.setSelection([selectedNode]);
    selection.setFocusedNode(selectedNode);
    await flushCanvasEffects();

    expect(root.querySelectorAll('button[title="red/700"]').length).toBe(2);

    selection.clear();
    await flushCanvasEffects();

    expect(root.querySelector('button[title="red/700"]')).toBeNull();

    await harness.destroy();
  });

  test("renders expanded color shades in a side panel", async () => {
    const element = createPenElement({ id: "pen-expanded", color: "@base/900" });
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });
    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");
    const root = getStageDom(harness);
    const selectedNode = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`);
    if (!(selectedNode instanceof Konva.Path)) {
      throw new Error("Expected hydrated selected pen node");
    }

    selection.setSelection([selectedNode]);
    selection.setFocusedNode(selectedNode);
    await flushCanvasEffects();

    const currentColorButton = getButtonByTitle(root, "base/900", 1);
    clickElement(currentColorButton);
    await flushCanvasEffects();

    expect(root.querySelector('button[title="base/100"]')).toBeTruthy();
    expect(root.querySelectorAll('button[title="base/900"]').length).toBeGreaterThanOrEqual(2);

    await harness.destroy();
  });
});
