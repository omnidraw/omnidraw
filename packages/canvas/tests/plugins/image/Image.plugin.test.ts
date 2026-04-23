import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function createImageElement(overrides?: Partial<TElement>): TElement {
  return {
    id: "image-1",
    x: 120,
    y: 80,
    rotation: 0,
    bindings: [],
    createdAt: 1,
    updatedAt: 2,
    locked: false,
    parentGroupId: null,
    zIndex: "z0001",
    style: { opacity: 0.7 },
    data: {
      type: "image",
      url: "https://cdn.test/image.png",
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
    ...overrides,
  } as TElement;
}

describe("Image plugin", () => {
  test("registers the image tool and hydrates persisted image elements", async () => {
    const imageElement = createImageElement();
    const harness = await createNewCanvasHarness({
      docHandle: createMockDocHandle({
        elements: {
          [imageElement.id]: imageElement,
        },
      }),
      image: {
        uploadImage: async () => ({ url: "https://cdn.test/uploaded.png" }),
        cloneImage: async ({ url }) => ({ url: `${url}?clone=1` }),
        deleteImage: async () => ({ ok: true }),
      },
    });

    const tool = harness.runtime.services.require("tool");
    const element = harness.runtime.services.require("element");

    expect(tool.getTool("image")?.id).toBe("image");
    expect(element.getSelectionStyleMenuConfigById({ id: "image" })).toBeNull();

    await flushCanvasEffects();

    const node = harness.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Image && candidate.id() === imageElement.id;
    });

    expect(node).toBeInstanceOf(Konva.Image);
    expect(element.toElement(node as Konva.Image)?.data.type).toBe("image");

    await harness.destroy();
  });
});
