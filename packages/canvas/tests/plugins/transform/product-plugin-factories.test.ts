import { describe, expect, it } from "vitest";
import { createImagePlugin } from "../../../src/plugins/image/Image.plugin";
import { createPenPlugin } from "../../../src/plugins/pen/Pen.plugin";
import { createShape1dPlugin } from "../../../src/plugins/shape1d/Shape1d.plugin";
import { createShape2dPlugin } from "../../../src/plugins/shape2d/Shape2d.plugin";
import { createTextPlugin } from "../../../src/plugins/text/Text.plugin";
import { createTransformPlugin } from "../../../src/plugins/transform/Transform.plugin";

describe("renderer-neutral product plugin factories", () => {
  it("exports the stable plugin identities", () => {
    expect([
      createShape2dPlugin().name,
      createShape1dPlugin().name,
      createPenPlugin().name,
      createTextPlugin().name,
      createImagePlugin().name,
      createTransformPlugin().name,
    ]).toEqual([
      "shape2d",
      "shape1d",
      "pen",
      "text",
      "image",
      "transform",
    ]);
  });
});
