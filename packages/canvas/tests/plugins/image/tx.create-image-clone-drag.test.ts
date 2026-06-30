import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { txCreateImageCloneDrag } from "../../../src/plugins/image/tx.create-image-clone-drag";
import { createTestContainer } from "../../test-setup";

function createImageElement(id: string) {
  return {
    id,
    x: 40,
    y: 50,
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
      w: 120,
      h: 80,
      crop: {
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        naturalWidth: 240,
        naturalHeight: 160,
      },
    },
  };
}

describe("txCreateImageCloneDrag", () => {
  test("finalizes an image clone drag into the scene and persists it", () => {
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const staticForegroundLayer = new Konva.Layer();
    const dynamicLayer = new Konva.Layer();
    stage.add(staticForegroundLayer);
    stage.add(dynamicLayer);

    const sourceNode = new Konva.Image({ id: "source", x: 40, y: 50, width: 120, height: 80 });
    staticForegroundLayer.add(sourceNode);

    const patchElement = vi.fn();
    const commit = vi.fn(() => ({ redoOps: [{ kind: "redo" }], undoOps: [], rollback: vi.fn() }));
    const setupNode = vi.fn((node: Konva.Image) => node);
    const selection = {
      setSelection: vi.fn(),
      setFocusedNode: vi.fn(),
      clear: vi.fn(),
    };

    const previewClone = txCreateImageCloneDrag({
      cloneBackendFileForElementPortal: {
        cloneImage: undefined,
        crdt: { build: vi.fn() } as never,
        findImageNodeById: vi.fn(() => null),
        notification: { showError: vi.fn() },
        updateImageNodeFromElementPortal: {
          setNodeZIndex: vi.fn(),
          syncNodeMetadata: vi.fn(),
          getImageSource: vi.fn(),
          loadImageIntoNode: vi.fn(),
          batchDraw: vi.fn(),
        },
      },
      crdt: {
        build: () => ({ patchElement, commit }),
        applyOps: vi.fn(),
      } as never,
      history: { record: vi.fn() } as never,
      render: { staticForegroundLayer, dynamicLayer } as never,
      renderOrder: {
        assignOrderOnInsert: vi.fn(),
        setNodeZIndex: vi.fn(),
        sortChildren: vi.fn(),
      } as never,
      selection: selection as never,
      createPreviewClone: () => new Konva.Image({ id: "clone-preview", x: 60, y: 70, width: 120, height: 80 }),
      createImageNode: (element) => new Konva.Image({ id: element.id, x: element.x, y: element.y, width: 120, height: 80 }),
      setupNode,
      toElement: (node) => createImageElement(node.id()),
      now: () => 99,
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
