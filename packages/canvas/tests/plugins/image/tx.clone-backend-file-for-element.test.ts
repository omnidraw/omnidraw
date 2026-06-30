import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { txCloneBackendFileForElement } from "../../../src/plugins/image/tx.clone-backend-file-for-element";

function createImageElement() {
  return {
    id: "image-1",
    x: 10,
    y: 20,
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
      url: "https://cdn.test/original.png",
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

describe("txCloneBackendFileForElement", () => {
  test("clones the backend file, updates the live node, and persists the cloned url", async () => {
    const imageNode = new Konva.Image({ id: "image-1" });
    const patchElement = vi.fn();
    const commit = vi.fn(() => ({ redoOps: [], undoOps: [], rollback: vi.fn() }));
    const updateImageNodeFromElementPortal = {
      setNodeZIndex: vi.fn(),
      syncNodeMetadata: vi.fn(),
      getImageSource: vi.fn(({ url, base64 }: { url: string | null; base64: string | null }) => url ?? base64),
      loadImageIntoNode: vi.fn(),
      batchDraw: vi.fn(),
    };

    txCloneBackendFileForElement({
      cloneImage: vi.fn(async () => ({ url: "https://cdn.test/cloned.png" })),
      crdt: {
        build: () => ({ patchElement, commit }),
      } as never,
      findImageNodeById: (id) => id === "image-1" ? imageNode : null,
      notification: {
        showError: vi.fn(),
      },
      updateImageNodeFromElementPortal,
    }, {
      element: createImageElement(),
      now: 99,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(updateImageNodeFromElementPortal.syncNodeMetadata).toHaveBeenCalledOnce();
    expect(patchElement).toHaveBeenCalledWith("image-1", expect.objectContaining({
      updatedAt: 99,
      data: expect.objectContaining({
        url: "https://cdn.test/cloned.png",
      }),
    }));
    expect(commit).toHaveBeenCalledOnce();
  });
});
