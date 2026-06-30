import Konva from "konva";
import type { TElement, TPenData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test, vi } from "vitest";
import { fnCreatePenDataFromStrokePoints, type TStrokePoint } from "../../../src/plugins/pen/fn.math";
import { THEME_ID_DARK } from "@vibecanvas/service-theme";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function createPenElement(args?: {
  id?: string;
  rotation?: number;
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
    rotation: args?.rotation ?? 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 1,
    locked: false,
    parentGroupId: null,
    zIndex: "",
    style: {
      backgroundColor: "#0f172a",
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

function getPersistedPenElement(docHandle: ReturnType<typeof createMockDocHandle>, id: string) {
  const element = docHandle.doc().elements[id];
  if (!element || element.data.type !== "pen") {
    throw new Error(`Expected persisted pen element '${id}'`);
  }

  return element as TElement & { data: TPenData };
}

function getTransformDragProxy(harness: Awaited<ReturnType<typeof createNewCanvasHarness>>) {
  const proxy = harness.staticForegroundLayer.findOne((node: Konva.Node) => {
    return node instanceof Konva.Rect && node.name() === "transform-drag-proxy";
  });

  if (!(proxy instanceof Konva.Rect)) {
    throw new Error("Expected transform drag proxy rect");
  }

  return proxy;
}

function altDragProxy(
  proxy: Konva.Rect,
  args: {
    dx: number;
    dy: number;
    findPreviewClone: () => Konva.Node | undefined;
  },
) {
  proxy.fire("dragstart", {
    target: proxy,
    currentTarget: proxy,
    evt: new MouseEvent("dragstart", { bubbles: true, altKey: true }),
  });

  const previewClone = args.findPreviewClone();
  if (!previewClone) {
    throw new Error("Expected preview clone after alt-drag from proxy");
  }

  const before = previewClone.absolutePosition();
  previewClone.setAbsolutePosition({ x: before.x + args.dx, y: before.y + args.dy });
  previewClone.fire("dragend", {
    target: previewClone,
    currentTarget: previewClone,
    evt: new MouseEvent("dragend", { bubbles: true, altKey: true }),
  });
}

function altDragPen(node: Konva.Path, args: { dx: number; dy: number }) {
  const beforeNodeIds = new Set(
    node.getStage()?.getLayers().flatMap((layer) => layer.getChildren()).map((child) => child._id) ?? [],
  );

  node.fire("dragstart", {
    target: node,
    currentTarget: node,
    evt: new MouseEvent("dragstart", { bubbles: true, altKey: true }),
  });

  const previewClone = node.getStage()?.getLayers()
    .flatMap((layer) => layer.getChildren())
    .find((child) => !beforeNodeIds.has(child._id) && child instanceof Konva.Path) as Konva.Path | undefined;

  if (!previewClone) {
    throw new Error("Expected preview clone after alt-drag start");
  }

  const before = previewClone.absolutePosition();
  previewClone.setAbsolutePosition({ x: before.x + args.dx, y: before.y + args.dy });
  previewClone.fire("dragend", {
    target: previewClone,
    currentTarget: previewClone,
    evt: new MouseEvent("dragend", { bubbles: true, altKey: true }),
  });
}

function simulateTransformerRotate(transformer: Konva.Transformer, node: Konva.Path, args: { rotation: number }) {
  const originalGetActiveAnchor = transformer.getActiveAnchor.bind(transformer);
  transformer.getActiveAnchor = () => "rotater";
  transformer.fire("transformstart", {
    target: node,
    currentTarget: transformer,
    evt: new MouseEvent("transformstart", { bubbles: true }),
  });
  node.rotation(args.rotation);
  node.fire("transform", {
    target: node,
    currentTarget: node,
    evt: new MouseEvent("transform", { bubbles: true }),
  });
  transformer.fire("transformend", {
    target: node,
    currentTarget: transformer,
    evt: new MouseEvent("transformend", { bubbles: true }),
  });
  transformer.getActiveAnchor = originalGetActiveAnchor;
}

describe("new Pen plugin", () => {
  test("Escape cancels an in-progress pen preview", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const selection = harness.runtime.services.require("selection");

    tool.setActiveTool("pen");
    await flushCanvasEffects();

    withDynamicPointer(harness, { x: 120, y: 80 }, () => {
      harness.runtime.hooks.pointerDown.call(createHookPointerEvent("pointerdown", 0.4));
    });
    withDynamicPointer(harness, { x: 180, y: 120 }, () => {
      harness.runtime.hooks.pointerMove.call(createHookPointerEvent("pointermove", 0.6) as Konva.KonvaEventObject<MouseEvent>);
    });

    expect(harness.dynamicLayer.find((node: Konva.Node) => node instanceof Konva.Path)).toHaveLength(1);

    harness.runtime.hooks.keydown.call(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    harness.runtime.hooks.pointerUp.call(createHookPointerEvent("pointerup", 0.5));
    await flushCanvasEffects();

    expect(harness.dynamicLayer.find((node: Konva.Node) => node instanceof Konva.Path)).toHaveLength(0);
    expect(harness.staticForegroundLayer.find((node: Konva.Node) => node instanceof Konva.Path)).toHaveLength(0);
    expect(Object.keys(harness.docHandle.doc().elements)).toHaveLength(0);
    expect(tool.activeToolId).toBe("select");
    expect(selection.mode).toBe("select");

    await harness.destroy();
  });

  test("remembered pen tool style is used for the next stroke", async () => {
    const harness = await createNewCanvasHarness();
    const tool = harness.runtime.services.require("tool");
    const theme = harness.runtime.services.require("theme");

    theme.setRememberedStyle("pen", {
      strokeColor: "@blue/700",
      strokeWidth: "@stroke-width/heavy",
      opacity: 0.5,
    });
    tool.setActiveTool("pen");
    await flushCanvasEffects();

    withDynamicPointer(harness, { x: 120, y: 80 }, () => {
      harness.runtime.hooks.pointerDown.call(createHookPointerEvent("pointerdown", 0.4));
    });
    withDynamicPointer(harness, { x: 170, y: 115 }, () => {
      harness.runtime.hooks.pointerMove.call(createHookPointerEvent("pointermove", 0.6) as Konva.KonvaEventObject<MouseEvent>);
    });
    withDynamicPointer(harness, { x: 210, y: 145 }, () => {
      harness.runtime.hooks.pointerMove.call(createHookPointerEvent("pointermove", 0.5) as Konva.KonvaEventObject<MouseEvent>);
    });

    harness.runtime.hooks.pointerUp.call(createHookPointerEvent("pointerup", 0.5));
    await flushCanvasEffects();

    const docElements = Object.values(harness.docHandle.doc().elements);
    expect(docElements).toHaveLength(1);
    if (docElements[0]?.data.type !== "pen") {
      throw new Error("Expected created document element to be a pen");
    }

    expect(docElements[0].style.backgroundColor).toBe("@blue/700");
    expect(docElements[0].style.strokeWidth).toBe("@stroke-width/heavy");
    expect(docElements[0].style.opacity).toBe(0.5);

    await harness.destroy();
  });

  test("SceneHydratorPlugin mounts persisted pen elements", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: element,
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const node = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`);

    expect(node).toBeInstanceOf(Konva.Path);
    expect(node?.data().length).toBeGreaterThan(0);
    expect(node?.fill()).toBe(element.style.backgroundColor);

    await harness.destroy();
  });

  test("drag updates pen position in CRDT", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const history = harness.runtime.services.require("history");
    const selection = harness.runtime.services.require("selection");
    const node = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;
    const before = { ...node.absolutePosition() };

    selection.setSelection([node]);
    selection.setFocusedNode(node);
    await flushCanvasEffects();

    node.fire("dragstart", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragstart", { bubbles: true }),
    });
    node.setAbsolutePosition({ x: before.x + 45, y: before.y + 20 });
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

    expect(node.absolutePosition().x).toBeCloseTo(before.x + 45, 6);
    expect(node.absolutePosition().y).toBeCloseTo(before.y + 20, 6);
    expect(docHandle.doc().elements[element.id]?.x).toBeCloseTo(before.x + 45, 6);
    expect(docHandle.doc().elements[element.id]?.y).toBeCloseTo(before.y + 20, 6);

    expect(history.canUndo()).toBe(true);

    await harness.destroy();
  });

  test("marquee selection ignores transform drag proxy for selected pen", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");
    const node = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;

    selection.setSelection([node]);
    selection.setFocusedNode(node);
    await flushCanvasEffects();

    const proxy = getTransformDragProxy(harness);
    expect(proxy.visible()).toBe(true);

    withDynamicPointer(harness, { x: 80, y: 60 }, () => {
      harness.runtime.hooks.pointerDown.call({
        target: harness.stage,
        currentTarget: harness.stage,
        evt: new PointerEvent("pointerdown"),
        cancelBubble: false,
      } as unknown as Konva.KonvaEventObject<PointerEvent>);
    });
    withDynamicPointer(harness, { x: 260, y: 190 }, () => {
      harness.runtime.hooks.pointerMove.call(createHookPointerEvent("pointermove", 0.5) as Konva.KonvaEventObject<MouseEvent>);
    });
    await flushCanvasEffects();

    expect(selection.selection.map((selectedNode) => selectedNode.getClassName())).toEqual(["Path"]);
    expect(selection.selection.map((selectedNode) => selectedNode.id())).toEqual([node.id()]);

    await harness.destroy();
  });

  test("selected pen can drag from transform proxy area", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const history = harness.runtime.services.require("history");
    const selection = harness.runtime.services.require("selection");
    const node = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;

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
    proxy.setAbsolutePosition({ x: proxy.absolutePosition().x + 35, y: proxy.absolutePosition().y + 18 });
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

    expect(node.absolutePosition().x).toBeCloseTo(before.x + 35, 6);
    expect(node.absolutePosition().y).toBeCloseTo(before.y + 18, 6);
    expect(docHandle.doc().elements[element.id]?.x).toBeCloseTo(before.x + 35, 6);
    expect(docHandle.doc().elements[element.id]?.y).toBeCloseTo(before.y + 18, 6);

    expect(history.canUndo()).toBe(true);

    await harness.destroy();
  });

  test("selected pen keeps transform drag proxy attached after scene reload and can still drag", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    }) as ReturnType<typeof createMockDocHandle> & { __emitChange: () => void };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");
    const history = harness.runtime.services.require("history");
    const originalNode = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;

    selection.setSelection([originalNode]);
    selection.setFocusedNode(originalNode);
    await flushCanvasEffects();

    expect(getTransformDragProxy(harness).getParent()).toBe(harness.staticForegroundLayer);

    docHandle.change((doc) => {
      doc.elements[element.id] = {
        ...doc.elements[element.id]!,
        updatedAt: doc.elements[element.id]!.updatedAt + 1,
      };
    });
    docHandle.__emitChange();
    await flushCanvasEffects();

    const hydratedNode = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;
    expect(hydratedNode).toBeTruthy();
    expect(selection.selection[0]).toBe(hydratedNode);

    const proxy = getTransformDragProxy(harness);
    expect(proxy.getParent()).toBe(harness.staticForegroundLayer);
    expect(proxy.visible()).toBe(true);

    const before = { ...hydratedNode.absolutePosition() };
    proxy.fire("dragstart", {
      target: proxy,
      currentTarget: proxy,
      evt: new MouseEvent("dragstart", { bubbles: true }),
    });
    proxy.setAbsolutePosition({ x: proxy.absolutePosition().x + 28, y: proxy.absolutePosition().y + 14 });
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

    expect(hydratedNode.absolutePosition().x).toBeCloseTo(before.x + 28, 6);
    expect(hydratedNode.absolutePosition().y).toBeCloseTo(before.y + 14, 6);
    expect(docHandle.doc().elements[element.id]?.x).toBeCloseTo(before.x + 28, 6);
    expect(docHandle.doc().elements[element.id]?.y).toBeCloseTo(before.y + 14, 6);
    expect(history.canUndo()).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Node has no parent. zIndex parameter is ignored."));

    warnSpy.mockRestore();
    await harness.destroy();
  });

  test("alt-drag clone also works from transform proxy", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");
    const sourceNode = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;

    selection.setSelection([sourceNode]);
    selection.setFocusedNode(sourceNode);
    await flushCanvasEffects();

    const proxy = getTransformDragProxy(harness);
    const beforeNodeIds = new Set(
      sourceNode.getStage()?.getLayers().flatMap((layer) => layer.getChildren()).map((child) => child._id) ?? [],
    );

    altDragProxy(proxy, {
      dx: 70,
      dy: 30,
      findPreviewClone: () => {
        return sourceNode.getStage()?.getLayers()
          .flatMap((layer) => layer.getChildren())
          .find((child) => !beforeNodeIds.has(child._id) && child instanceof Konva.Path);
      },
    });
    await flushCanvasEffects();

    const persistedPenElements = Object.values(docHandle.doc().elements).filter((candidate) => candidate.data.type === "pen");
    expect(persistedPenElements).toHaveLength(2);

    const createdClone = persistedPenElements.find((candidate) => candidate.id !== element.id);
    expect(createdClone).toBeTruthy();
    if (!createdClone || createdClone.data.type !== "pen") {
      throw new Error("Expected cloned document element to be a pen");
    }

    expect(selection.selection[0]?.id()).toBe(createdClone.id);

    await harness.destroy();
  });

  test("alt-drag clone creates a second persisted pen element", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");
    const sourceNode = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;

    selection.setSelection([sourceNode]);
    selection.setFocusedNode(sourceNode);
    await flushCanvasEffects();

    altDragPen(sourceNode, { dx: 70, dy: 30 });
    await flushCanvasEffects();

    const persistedPenElements = Object.values(docHandle.doc().elements).filter((candidate) => candidate.data.type === "pen");
    expect(persistedPenElements).toHaveLength(2);

    const createdClone = persistedPenElements.find((candidate) => candidate.id !== element.id);
    expect(createdClone).toBeTruthy();
    if (!createdClone || createdClone.data.type !== "pen") {
      throw new Error("Expected cloned document element to be a pen");
    }

    const clonedPenData = createdClone.data as TPenData;
    const sourcePenData = element.data as TPenData;
    expect(clonedPenData.points).toEqual(sourcePenData.points);
    expect(clonedPenData.pressures).toEqual(sourcePenData.pressures);
    expect(selection.selection[0]?.id()).toBe(createdClone.id);

    await harness.destroy();
  });

  test("pen token fill resolves on mount and round-trips token style", async () => {
    const element = createPenElement({ id: "pen-token" });
    element.style.backgroundColor = "@green/500";
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const theme = harness.runtime.services.require("theme");
    const elementService = harness.runtime.services.require("element");
    const node = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;

    expect(node.fill()).toBe("#22c55e");
    expect(elementService.toElement(node)?.style.backgroundColor).toBe("@green/500");

    theme.setTheme(THEME_ID_DARK);
    await flushCanvasEffects();

    expect(node.fill()).toBe("#16a34a");
    expect(elementService.toElement(node)?.style.backgroundColor).toBe("@green/500");

    await harness.destroy();
  });

  test("shared transformer rotate persists pen rotation and undo restores original values", async () => {
    const element = createPenElement();
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: structuredClone(element),
      },
    });

    const harness = await createNewCanvasHarness({ docHandle });
    const history = harness.runtime.services.require("history");
    const selection = harness.runtime.services.require("selection");
    const node = harness.staticForegroundLayer.findOne<Konva.Path>(`#${element.id}`)!;
    const transformer = harness.dynamicLayer.find((candidate: Konva.Node) => candidate instanceof Konva.Transformer)[0] as Konva.Transformer;

    selection.setSelection([node]);
    selection.setFocusedNode(node);
    await flushCanvasEffects();

    simulateTransformerRotate(transformer, node, { rotation: 28 });
    await flushCanvasEffects();

    expect(docHandle.doc().elements[element.id]?.rotation).toBeCloseTo(28, 6);
    expect(node.rotation()).toBeCloseTo(28, 6);

    history.undo();
    await flushCanvasEffects();
    expect(docHandle.doc().elements[element.id]?.rotation).toBeCloseTo(0, 6);
    expect(node.rotation()).toBeCloseTo(0, 6);

    await harness.destroy();
  });

});
