import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { txInsertImage } from "../../../src/plugins/image/tx.insert-image";
import { createTestContainer } from "../../test-setup";

function createRuntimeImageNode(element: {
  id: string;
  x: number;
  y: number;
  rotation: number;
  style: { opacity?: number };
  data: { w: number; h: number };
}) {
  return new Konva.Image({
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    width: element.data.w,
    height: element.data.h,
    opacity: element.style.opacity ?? 1,
  });
}

describe("txInsertImage", () => {
  test("uploads an image, inserts a node, and persists the created element through CRDT builder", async () => {
    const container = createTestContainer();
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const staticForegroundLayer = new Konva.Layer();
    stage.add(staticForegroundLayer);

    const patchElement = vi.fn();
    const commit = vi.fn(() => ({ redoOps: [{ kind: "redo" }], undoOps: [], rollback: vi.fn() }));
    const selection = {
      setSelection: vi.fn(),
      setFocusedNode: vi.fn(),
    };
    const createdNodes: Konva.Image[] = [];

    await txInsertImage({
      crdt: {
        build: () => ({ patchElement, commit }),
        applyOps: vi.fn(),
      } as never,
      history: { record: vi.fn() } as never,
      render: { staticForegroundLayer } as never,
      renderOrder: {
        assignOrderOnInsert: vi.fn(),
        setNodeZIndex: vi.fn(),
        sortChildren: vi.fn(),
      } as never,
      selection: selection as never,
      uploadImage: vi.fn(async () => ({ url: "https://cdn.test/image.png" })),
      notification: { showError: vi.fn() },
      createId: () => "image-1",
      now: () => 100,
      fileToDataUrl: vi.fn(async () => "data:image/png;base64,ZmFrZQ=="),
      parseDataUrl: vi.fn(() => ({ format: "image/png", base64: "ZmFrZQ==" })),
      getImageDimensions: vi.fn(async () => ({ width: 1200, height: 600 })),
      getViewportCenter: () => ({ x: 300, y: 200 }),
      getViewportWorldSize: () => ({ width: 800, height: 600 }),
      createRuntimeNode: (element) => {
        const node = createRuntimeImageNode(element);
        createdNodes.push(node);
        return node;
      },
      toElement: (node) => ({
        id: node.id(),
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        bindings: [],
        createdAt: 100,
        updatedAt: 100,
        locked: false,
        parentGroupId: null,
        zIndex: "",
        style: { opacity: node.opacity() },
        data: {
          type: "image" as const,
          url: "https://cdn.test/image.png",
          base64: null,
          w: node.width(),
          h: node.height(),
          crop: {
            x: 0,
            y: 0,
            width: 1200,
            height: 600,
            naturalWidth: 1200,
            naturalHeight: 600,
          },
        },
      }),
    }, {
      file: new File(["fake"], "image.png", { type: "image/png" }),
    });

    expect(createdNodes).toHaveLength(1);
    expect(staticForegroundLayer.getChildren()).toHaveLength(1);
    expect(patchElement).toHaveBeenCalledWith("image-1", expect.objectContaining({
      id: "image-1",
      data: expect.objectContaining({
        type: "image",
        w: 300,
        h: 150,
      }),
    }));
    expect(commit).toHaveBeenCalledOnce();
    expect(selection.setSelection).toHaveBeenCalledWith([createdNodes[0]]);
    expect(selection.setFocusedNode).toHaveBeenCalledWith(createdNodes[0]);

    stage.destroy();
    container.remove();
  });
});
