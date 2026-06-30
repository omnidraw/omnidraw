import { describe, expect, test } from "vitest";
import { fnFitImageToViewport } from "../../../src/plugins/image/fn.fit-image-to-viewport";

describe("fnFitImageToViewport", () => {
  test("fits landscape images using half of the smaller viewport dimension", () => {
    expect(fnFitImageToViewport({
      viewportWidth: 1000,
      viewportHeight: 800,
      imageWidth: 1200,
      imageHeight: 600,
    })).toEqual({
      width: 400,
      height: 200,
    });
  });

  test("fits portrait images while preserving aspect ratio", () => {
    expect(fnFitImageToViewport({
      viewportWidth: 1000,
      viewportHeight: 800,
      imageWidth: 600,
      imageHeight: 1200,
    })).toEqual({
      width: 200,
      height: 400,
    });
  });
});
