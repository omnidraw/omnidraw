import Konva from "konva";
import type { TArrowData, TElement, TLineData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TShape1dNode } from "../../../src/plugins/shape1d/CONSTANTS";
import { describe, expect, test } from "vitest";
import { fxIsShape1dNode } from "../../../src/plugins/shape1d/fx.node";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function createHookPointerEvent(type: string, pressure = 0.5) {
  return {
    target: null,
    currentTarget: null,
    evt: new PointerEvent(type, { pressure }),
    cancelBubble: false,
  } as unknown as Konva.KonvaEventObject<PointerEvent>;
}

function withDynamicPointer(
  harness: Awaited<ReturnType<typeof createNewCanvasHarness>>,
  point: { x: number; y: number },
  callback: () => void,
) {
  const original = harness.dynamicLayer.getRelativePointerPosition.bind(harness.dynamicLayer);
  harness.dynamicLayer.getRelativePointerPosition = () => point;
  callback();
  harness.dynamicLayer.getRelativePointerPosition = original;
}

function getShape1dNode(harness: Awaited<ReturnType<typeof createNewCanvasHarness>>, id: string): TShape1dNode {
  const node = harness.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return candidate.id() === id;
  });

  if (!fxIsShape1dNode({}, { node })) {
    throw new Error(`Expected shape1d node '${id}'`);
  }

  return node as TShape1dNode;
}

function getTransformDragProxy(harness: Awaited<ReturnType<typeof createNewCanvasHarness>>): Konva.Rect {
  const proxy = harness.staticForegroundLayer.findOne((node: Konva.Node) => {
    return node instanceof Konva.Rect && node.name() === "transform-drag-proxy";
  });

  if (!(proxy instanceof Konva.Rect)) {
    throw new Error("Expected transform drag proxy rect");
  }

  return proxy;
}

function createLineElement(args?: {
  id?: string;
  x?: number;
  y?: number;
  lineType?: TLineData["lineType"];
}): TElement {
  return {
    id: args?.id ?? "line-1",
    x: args?.x ?? 120,
    y: args?.y ?? 80,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 1,
    locked: false,
    parentGroupId: null,
    zIndex: "",
    style: {
      strokeColor: "#0f172a",
      opacity: 0.92,
      strokeWidth: "@stroke-width/medium",
    },
    data: {
      type: "line",
      lineType: args?.lineType ?? "straight",
      points: [[0, 0], [120, 40]],
      startBinding: null,
      endBinding: null,
    },
  } satisfies TElement;
}

function createArrowElement(args?: {
  id?: string;
  x?: number;
  y?: number;
  lineType?: TArrowData["lineType"];
  startCap?: TArrowData["startCap"];
  endCap?: TArrowData["endCap"];
}): TElement {
  return {
    id: args?.id ?? "arrow-1",
    x: args?.x ?? 140,
    y: args?.y ?? 90,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 1,
    locked: false,
    parentGroupId: null,
    zIndex: "",
    style: {
      strokeColor: "#0f172a",
      opacity: 0.92,
      strokeWidth: "@stroke-width/medium",
    },
    data: {
      type: "arrow",
      lineType: args?.lineType ?? "straight",
      points: [[0, 0], [100, 50]],
      startBinding: null,
      endBinding: null,
      startCap: args?.startCap ?? "none",
      endCap: args?.endCap ?? "arrow",
    },
  } satisfies TElement;
}

describe("shape1d plugin", () => {
  test("draw-create commits a line to scene and CRDT then returns to select", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const selection = harness.runtime.services.require("selection");

    tool.setActiveTool("line");
    await flushCanvasEffects();

    withDynamicPointer(harness, { x: 120, y: 80 }, () => {
      harness.runtime.hooks.pointerDown.call(createHookPointerEvent("pointerdown", 0.5));
    });
    withDynamicPointer(harness, { x: 220, y: 140 }, () => {
      harness.runtime.hooks.pointerMove.call(createHookPointerEvent("pointermove", 0.5) as Konva.KonvaEventObject<MouseEvent>);
    });

    expect(harness.dynamicLayer.find((node: Konva.Node) => fxIsShape1dNode({}, { node }))).toHaveLength(1);

    harness.runtime.hooks.pointerUp.call(createHookPointerEvent("pointerup", 0.5));
    await flushCanvasEffects();

    const elements = Object.values(harness.docHandle.doc().elements);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.data.type).toBe("line");
    expect(elements[0]?.data.type === "line" && elements[0].data.points.length).toBe(2);
    expect(harness.staticForegroundLayer.find((node: Konva.Node) => fxIsShape1dNode({}, { node }))).toHaveLength(1);
    expect(harness.dynamicLayer.find((node: Konva.Node) => fxIsShape1dNode({}, { node }))).toHaveLength(0);
    expect(tool.activeToolId).toBe("select");
    expect(selection.mode).toBe("select");

    await harness.destroy();
  });

  test("remembered line tool style is used for newly created lines", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const theme = harness.runtime.services.require("theme");

    theme.setRememberedStyle("line", {
      strokeColor: "@blue/700",
      strokeWidth: "2",
      opacity: 0.4,
      lineType: "curved",
    });
    tool.setActiveTool("line");
    await flushCanvasEffects();

    withDynamicPointer(harness, { x: 100, y: 100 }, () => {
      harness.runtime.hooks.pointerDown.call(createHookPointerEvent("pointerdown", 0.5));
    });
    withDynamicPointer(harness, { x: 180, y: 150 }, () => {
      harness.runtime.hooks.pointerMove.call(createHookPointerEvent("pointermove", 0.5) as Konva.KonvaEventObject<MouseEvent>);
    });
    harness.runtime.hooks.pointerUp.call(createHookPointerEvent("pointerup", 0.5));
    await flushCanvasEffects();

    const element = Object.values(harness.docHandle.doc().elements)[0];
    if (!element || element.data.type !== "line") {
      throw new Error("Expected created line element");
    }

    expect(element.style.strokeColor).toBe("@blue/700");
    expect(element.style.strokeWidth).toBe("2");
    expect(element.style.opacity).toBe(0.4);
    expect(element.data.lineType).toBe("curved");

    await harness.destroy();
  });

  test("remembered arrow tool style is used for newly created arrows", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const theme = harness.runtime.services.require("theme");

    theme.setRememberedStyle("arrow", {
      strokeColor: "@red/600",
      strokeWidth: "@stroke-width/thin",
      opacity: 0.6,
      lineType: "curved",
      startCap: "dot",
      endCap: "diamond",
    });
    tool.setActiveTool("arrow");
    await flushCanvasEffects();

    withDynamicPointer(harness, { x: 110, y: 95 }, () => {
      harness.runtime.hooks.pointerDown.call(createHookPointerEvent("pointerdown", 0.5));
    });
    withDynamicPointer(harness, { x: 200, y: 160 }, () => {
      harness.runtime.hooks.pointerMove.call(createHookPointerEvent("pointermove", 0.5) as Konva.KonvaEventObject<MouseEvent>);
    });
    harness.runtime.hooks.pointerUp.call(createHookPointerEvent("pointerup", 0.5));
    await flushCanvasEffects();

    const element = Object.values(harness.docHandle.doc().elements)[0];
    if (!element || element.data.type !== "arrow") {
      throw new Error("Expected created arrow element");
    }

    expect(element.style.strokeColor).toBe("@red/600");
    expect(element.style.strokeWidth).toBe("@stroke-width/thin");
    expect(element.style.opacity).toBe(0.6);
    expect(element.data.lineType).toBe("curved");
    expect(element.data.startCap).toBe("dot");
    expect(element.data.endCap).toBe("diamond");

    await harness.destroy();
  });

  test("scene hydrator mounts persisted shape1d elements through canvas registry", async () => {
    const element = createLineElement({ id: "line-hydrated", lineType: "curved" });
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const node = getShape1dNode(harness, element.id);
    const elementService = harness.runtime.services.require("element");

    expect(node).toBeInstanceOf(Konva.Shape);
    expect(elementService.toElement(node)?.id).toBe(element.id);
    expect(elementService.toElement(node)?.data.type).toBe("line");

    await harness.destroy();
  });

  test("drag updates persisted shape1d position through CRDT builder", async () => {
    const element = createLineElement({ id: "line-drag" });
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const history = harness.runtime.services.require("history");
    const selection = harness.runtime.services.require("selection");
    const node = getShape1dNode(harness, element.id);
    const before = { ...node.absolutePosition() };

    selection.setSelection([node]);
    selection.setFocusedNode(node);
    await flushCanvasEffects();

    node.fire("dragstart", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragstart", { bubbles: true }),
    });
    node.setAbsolutePosition({ x: before.x + 40, y: before.y + 18 });
    node.fire("dragmove", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragmove", { bubbles: true }),
    });
    node.fire("dragend", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragend", { bubbles: true }),
    });
    await flushCanvasEffects();

    expect(docHandle.doc().elements[element.id]?.x).toBeCloseTo(before.x + 40, 6);
    expect(docHandle.doc().elements[element.id]?.y).toBeCloseTo(before.y + 18, 6);
    expect(history.canUndo()).toBe(true);

    await harness.destroy();
  });

  test("selected shape1d can drag from transform proxy and persists move", async () => {
    const element = createArrowElement({ id: "arrow-proxy" });
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const history = harness.runtime.services.require("history");
    const selection = harness.runtime.services.require("selection");
    const node = getShape1dNode(harness, element.id);

    selection.setSelection([node]);
    selection.setFocusedNode(node);
    await flushCanvasEffects();

    const proxy = getTransformDragProxy(harness);
    expect(proxy.visible()).toBe(true);

    const before = { ...node.absolutePosition() };
    proxy.fire("dragstart", {
      target: proxy,
      currentTarget: proxy,
      evt: new MouseEvent("dragstart", { bubbles: true }),
    });
    proxy.setAbsolutePosition({ x: proxy.absolutePosition().x + 30, y: proxy.absolutePosition().y + 12 });
    proxy.fire("dragmove", {
      target: proxy,
      currentTarget: proxy,
      evt: new MouseEvent("dragmove", { bubbles: true }),
    });
    proxy.fire("dragend", {
      target: proxy,
      currentTarget: proxy,
      evt: new MouseEvent("dragend", { bubbles: true }),
    });
    await flushCanvasEffects();

    expect(node.absolutePosition().x).toBeCloseTo(before.x + 30, 6);
    expect(node.absolutePosition().y).toBeCloseTo(before.y + 12, 6);
    expect(docHandle.doc().elements[element.id]?.x).toBeCloseTo(before.x + 30, 6);
    expect(docHandle.doc().elements[element.id]?.y).toBeCloseTo(before.y + 12, 6);
    expect(history.canUndo()).toBe(true);

    await harness.destroy();
  });
});
