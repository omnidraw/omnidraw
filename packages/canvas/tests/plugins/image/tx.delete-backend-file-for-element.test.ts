import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, test, vi } from "vitest";
import { txDeleteBackendFileForElement } from "../../../src/plugins/image/tx.delete-backend-file-for-element";

function createImageElement(url: string | null): TElement {
  return {
    id: "image-1",
    x: 0,
    y: 0,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 1,
    locked: false,
    parentGroupId: null,
    zIndex: "z1",
    style: {},
    data: {
      type: "image",
      url,
      base64: null,
      w: 100,
      h: 50,
      crop: { x: 0, y: 0, width: 100, height: 50, naturalWidth: 100, naturalHeight: 50 },
    },
  };
}

describe("txDeleteBackendFileForElement", () => {
  test("deletes the persisted media file by image URL", async () => {
    const deleteImage = vi.fn(async () => ({ ok: true as const }));

    await txDeleteBackendFileForElement({ deleteImage }, {
      element: createImageElement("/files/123e4567-e89b-12d3-a456-426614174000.png"),
    });

    expect(deleteImage).toHaveBeenCalledWith({
      url: "/files/123e4567-e89b-12d3-a456-426614174000.png",
    });
  });

  test("skips source-less images and reports backend deletion errors", async () => {
    const deleteImage = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const notification = { showError: vi.fn() };

    await txDeleteBackendFileForElement({ deleteImage, notification }, {
      element: createImageElement(null),
    });
    expect(deleteImage).not.toHaveBeenCalled();

    await txDeleteBackendFileForElement({ deleteImage, notification }, {
      element: createImageElement("/files/123e4567-e89b-12d3-a456-426614174000.png"),
    });
    expect(notification.showError).toHaveBeenCalledWith(
      "Failed to delete image file",
      "database unavailable",
    );
  });
});
