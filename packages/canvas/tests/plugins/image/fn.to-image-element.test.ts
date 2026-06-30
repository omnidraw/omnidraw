import { describe, expect, test } from "vitest";
import { fnToImageElement } from "../../../src/plugins/image/fn.to-image-element";

describe("fnToImageElement", () => {
  test("maps runtime image fields into a persisted image element", () => {
    const crop = {
      x: 4,
      y: 6,
      width: 320,
      height: 180,
      naturalWidth: 640,
      naturalHeight: 360,
    };

    expect(fnToImageElement({
      id: "image-1",
      x: 10,
      y: 20,
      rotation: 30,
      createdAt: 100,
      updatedAt: 200,
      parentGroupId: "group-1",
      zIndex: "z0001",
      opacity: 0.6,
      scaleX: 1.5,
      scaleY: 0.75,
      url: "https://cdn.test/image.png",
      base64: null,
      width: 320,
      height: 180,
      crop,
    })).toEqual({
      id: "image-1",
      x: 10,
      y: 20,
      rotation: 30,
      scaleX: 1.5,
      scaleY: 0.75,
      bindings: [],
      createdAt: 100,
      updatedAt: 200,
      locked: false,
      parentGroupId: "group-1",
      zIndex: "z0001",
      style: {
        opacity: 0.6,
      },
      data: {
        type: "image",
        url: "https://cdn.test/image.png",
        base64: null,
        w: 320,
        h: 180,
        crop,
      },
    });
  });
});
