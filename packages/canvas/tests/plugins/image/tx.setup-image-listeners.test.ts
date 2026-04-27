import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { txSetupImageListeners } from "../../../src/plugins/image/tx.setup-image-listeners";
import { createTestContainer } from "../../test-setup";

function createImageElement(id: string, x: number, y: number) {
  return {
    id,
    x,
    y,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 2,
    locked: false,
    parentGroupId: null,
    zIndex: "",
    style: { opacity: 1 },
    data: {
      type: "image" as const,
      url: `https://cdn.test/${id}.png`,
      base64: null,
      w: 100,
      h: 80,
      crop: {
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        naturalWidth: 100,
        naturalHeight: 80,
      },
    },
  };
}

describe("txSetupImageListeners", () => {
  test("alt-drag delegates clone startup through the canvas registry clone path", () => {
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    stage.add(layer);

    const node = new Konva.Image({ id: "image-1", x: 10, y: 20 });
    layer.add(node);

    const startDragClone = vi.fn();

    txSetupImageListeners({
      elementService: { toElement: vi.fn(() => createImageElement("image-1", 10, 20)) } as never,
      crdt: { build: vi.fn() } as never,
      history: { record: vi.fn() } as never,
      render: { staticForegroundLayer: layer } as never,
      selection: { mode: "select", selection: [node] } as never,
      hooks: {
        elementPointerClick: { call: vi.fn() },
        elementPointerDown: { call: vi.fn(() => false) },
        elementPointerDoubleClick: { call: vi.fn(() => false) },
      } as never,
      startDragClone,
      applyElement: vi.fn(),
      updateImageNodeFromElementPortal: {
        setNodeZIndex: vi.fn(),
        syncNodeMetadata: vi.fn(),
        getImageSource: vi.fn(),
        loadImageIntoNode: vi.fn(),
        batchDraw: vi.fn(),
      },
      filterSelection: (selection) => selection,
      safeStopDrag: vi.fn(),
      toElement: () => createImageElement("image-1", 10, 20),
      createThrottledPatch: () => vi.fn(),
    }, {
      node,
    });

    node.fire("dragstart", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragstart", { bubbles: true, altKey: true }),
    });

    expect(startDragClone).toHaveBeenCalledWith({
      node,
      selection: [node],
    });

    stage.destroy();
    container.remove();
  });

  test("dragend batches image move writes and records history", () => {
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    stage.add(layer);

    const node = new Konva.Image({ id: "image-1", x: 10, y: 20 });
    const passenger = new Konva.Rect({ id: "shape-2", x: 40, y: 60 });
    layer.add(node);
    layer.add(passenger);

    const patchElement = vi.fn();
    const rollback = vi.fn();
    const commit = vi.fn(() => ({ redoOps: [{ kind: "op" }], undoOps: [], rollback }));
    const historyRecord = vi.fn();
    const applyElement = vi.fn();

    txSetupImageListeners({
      elementService: {
        toElement: (candidate: Konva.Node) => {
          if (candidate.id() === "shape-2") {
            return createImageElement("shape-2", 45, 75);
          }

          return createImageElement(candidate.id(), candidate.x(), candidate.y());
        },
      } as never,
      crdt: {
        build: () => ({ patchElement, commit }),
        applyOps: vi.fn(),
      } as never,
      history: { record: historyRecord } as never,
      render: { staticForegroundLayer: layer } as never,
      selection: { mode: "select", selection: [node, passenger] } as never,
      hooks: {
        elementPointerClick: { call: vi.fn() },
        elementPointerDown: { call: vi.fn(() => false) },
        elementPointerDoubleClick: { call: vi.fn(() => false) },
      } as never,
      startDragClone: vi.fn(),
      applyElement,
      updateImageNodeFromElementPortal: {
        setNodeZIndex: vi.fn(),
        syncNodeMetadata: vi.fn(),
        getImageSource: vi.fn(),
        loadImageIntoNode: vi.fn(),
        batchDraw: vi.fn(),
      },
      filterSelection: (selection) => selection,
      safeStopDrag: vi.fn(),
      toElement: (candidate) => createImageElement(candidate.id(), candidate.x(), candidate.y()),
      createThrottledPatch: () => vi.fn(),
    }, {
      node,
    });

    node.fire("dragstart", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragstart", { bubbles: true }),
    });

    node.absolutePosition({ x: 70, y: 95 });
    passenger.absolutePosition({ x: 100, y: 115 });

    node.fire("dragend", {
      target: node,
      currentTarget: node,
      evt: new MouseEvent("dragend", { bubbles: true }),
    });

    expect(patchElement).toHaveBeenCalledTimes(2);
    expect(patchElement).toHaveBeenNthCalledWith(1, "image-1", expect.objectContaining({ x: 70, y: 95 }));
    expect(patchElement).toHaveBeenNthCalledWith(2, "shape-2", expect.objectContaining({ x: 45, y: 75 }));
    expect(commit).toHaveBeenCalledOnce();
    expect(historyRecord).toHaveBeenCalledOnce();

    const recorded = historyRecord.mock.calls[0]?.[0];
    expect(recorded?.label).toBe("drag-image");

    recorded?.undo();
    expect(applyElement).toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();

    stage.destroy();
    container.remove();
  });
});
