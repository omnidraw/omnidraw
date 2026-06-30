import Konva from "konva";
import { JSDOM } from "jsdom";
import { describe, expect, test, vi } from "vitest";
import { txCreateShape2dCloneDrag } from "../../../src/plugins/shape2d/tx.create-clone-drag";
import { createTestContainer } from "../../test-setup";
import { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";

function ensureDom() {
  if (typeof document !== "undefined") {
    return;
  }

  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("MouseEvent", dom.window.MouseEvent);
}

function createRectElement(id: string, x: number, y: number) {
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
    style: { backgroundColor: "#ff0000", opacity: 1, strokeWidth: "@stroke-width/none" },
    data: {
      type: "rect" as const,
      w: 120,
      h: 80,
    },
  };
}

describe("txCreateShape2dCloneDrag", () => {
  test("finalizes a shape2d clone drag and persists created elements through the builder", () => {
    ensureDom();
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const staticForegroundLayer = new Konva.Layer();
    const dynamicLayer = new Konva.Layer();
    stage.add(staticForegroundLayer);
    stage.add(dynamicLayer);

    const sourceNode = new Konva.Rect({ id: "source", x: 40, y: 50, width: 120, height: 80 });
    staticForegroundLayer.add(sourceNode);

    const patchElement = vi.fn();
    const commit = vi.fn(() => ({ redoOps: [{ kind: "redo" }], undoOps: [], rollback: vi.fn() }));
    const setupNode = vi.fn((node: Konva.Shape) => node);
    const selection = {
      setSelection: vi.fn(),
      setFocusedNode: vi.fn(),
      clear: vi.fn(),
    };

    const previewClone = txCreateShape2dCloneDrag({
      Konva,
      element: {
        createNodeFromElement: (element: TElement) => new Konva.Rect({ id: element.id, x: element.x, y: element.y, width: 120, height: 80 }),
        updateElement: vi.fn(() => true),
      } as never,
      crdt: {
        build: () => ({ patchElement, commit }),
        applyOps: vi.fn(),
      } as never,
      history: { record: vi.fn() } as never,
      render: { staticForegroundLayer, dynamicLayer } as never,
      renderOrder: {
        assignOrderOnInsert: vi.fn(),
        getOrderBundle: vi.fn((node) => [node]),
        sortChildren: vi.fn(),
      } as never,
      selection: selection as never,
      createId: () => "clone-preview",
      now: () => 99,
      createNode: (element) => new Konva.Rect({ id: element.id, x: element.x, y: element.y, width: 120, height: 80 }),
      setupNode,
      toElement: (node) => createRectElement(node.id(), node.x(), node.y()),
    }, {
      node: sourceNode,
    });

    expect(previewClone?.getLayer()).toBe(dynamicLayer);

    previewClone?.fire("dragend", {
      target: previewClone,
      currentTarget: previewClone,
      evt: new MouseEvent("dragend", { bubbles: true }),
    });

    expect(previewClone?.getLayer()).toBe(staticForegroundLayer);
    expect(setupNode).toHaveBeenCalledWith(previewClone);
    expect(patchElement).toHaveBeenCalledWith("clone-preview", expect.objectContaining({ id: "clone-preview" }));
    expect(commit).toHaveBeenCalledOnce();
    expect(selection.setSelection).toHaveBeenCalledWith([previewClone]);
    expect(selection.setFocusedNode).toHaveBeenCalledWith(previewClone);

    stage.destroy();
    container.remove();
  });
});
