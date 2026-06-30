import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { txUpdateImageNodeFromElement } from "../../../src/plugins/image/tx.update-image-node-from-element";

function createImageElement() {
  return {
    id: "image-1",
    x: 120,
    y: 80,
    rotation: 45,
    bindings: [],
    createdAt: 1,
    updatedAt: 2,
    locked: false,
    parentGroupId: null,
    zIndex: "z0002",
    style: { opacity: 0.4 },
    data: {
      type: "image" as const,
      url: "https://cdn.test/next.png",
      base64: null,
      w: 320,
      h: 180,
      crop: {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        naturalWidth: 640,
        naturalHeight: 360,
      },
    },
  };
}

describe("txUpdateImageNodeFromElement", () => {
  test("replays persisted image state onto an existing Konva image node", () => {
    const node = new Konva.Image({
      id: "image-1",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      opacity: 1,
    });
    node.scale({ x: 2, y: 3 });
    node.setAttr("vcImageSource", "https://cdn.test/old.png");

    const setNodeZIndex = vi.fn();
    const syncNodeMetadata = vi.fn();
    const getImageSource = vi.fn(({ url, base64 }: { url: string | null; base64: string | null }) => url ?? base64);
    const loadImageIntoNode = vi.fn();
    const batchDraw = vi.fn();

    txUpdateImageNodeFromElement({
      setNodeZIndex,
      syncNodeMetadata,
      getImageSource,
      loadImageIntoNode,
      batchDraw,
    }, {
      node,
      element: createImageElement(),
    });

    expect(node.position()).toEqual({ x: 120, y: 80 });
    expect(node.rotation()).toBe(45);
    expect(node.width()).toBe(320);
    expect(node.height()).toBe(180);
    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
    expect(node.opacity()).toBe(0.4);
    expect(setNodeZIndex).toHaveBeenCalledWith(node, "z0002");
    expect(syncNodeMetadata).toHaveBeenCalledOnce();
    expect(loadImageIntoNode).toHaveBeenCalledWith(node, "https://cdn.test/next.png");
    expect(batchDraw).toHaveBeenCalledOnce();
  });
});
