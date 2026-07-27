import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, it, vi } from "vitest";
import { txCloneImageAssets } from "../../../src/plugins/transform/tx.clone-image-assets";

function image(id: string, url: string): TElement {
  return {
    id,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: {
      type: "image",
      url,
      base64: null,
      w: 10,
      h: 10,
      crop: {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        naturalWidth: 10,
        naturalHeight: 10,
      },
    },
  };
}

describe("clone image asset transaction", () => {
  it("compensates already cloned assets when a later clone fails", async () => {
    const deleteImage = vi.fn(async () => ({ ok: true as const }));
    const cloneImage = vi.fn()
      .mockResolvedValueOnce({ url: "cloned:first" })
      .mockRejectedValueOnce(new Error("backend unavailable"));

    await expect(txCloneImageAssets({
      cloneImage,
      deleteImage,
    }, {
      elements: [
        image("first", "source:first"),
        image("second", "source:second"),
      ],
    })).rejects.toThrow("backend unavailable");
    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).toHaveBeenCalledWith({ url: "cloned:first" });
  });
});
