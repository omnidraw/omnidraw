import { describe, expect, test } from "vitest";
import { fnCreateImageElement } from "../../../src/plugins/image/fn.create-image-element";

describe("fnCreateImageElement", () => {
  test("creates a centered image element with default crop metadata", () => {
    const element = fnCreateImageElement({
      id: "image-1",
      center: { x: 300, y: 200 },
      width: 160,
      height: 90,
      sourceUrl: "https://cdn.test/image.png",
      naturalWidth: 1920,
      naturalHeight: 1080,
      now: 123,
    });

    expect(element).toEqual({
      id: "image-1",
      x: 220,
      y: 155,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      bindings: [],
      createdAt: 123,
      locked: false,
      parentGroupId: null,
      updatedAt: 123,
      zIndex: "",
      style: { opacity: 1 },
      data: {
        type: "image",
        url: "https://cdn.test/image.png",
        base64: null,
        w: 160,
        h: 90,
        crop: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          naturalWidth: 1920,
          naturalHeight: 1080,
        },
      },
    });
  });
});
