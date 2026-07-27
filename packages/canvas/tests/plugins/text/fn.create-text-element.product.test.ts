import { describe, expect, it } from "vitest";
import { fnCreateTextElement } from "../../../src/plugins/text/fn.create-text-element";

describe("text product element", () => {
  it("keeps free-text persistence defaults renderer neutral", () => {
    expect(fnCreateTextElement({
      id: "text-1",
      x: 10,
      y: 20,
      createdAt: 30,
      updatedAt: 30,
    })).toMatchObject({
      id: "text-1",
      x: 10,
      y: 20,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      data: {
        type: "text",
        text: "",
        originalText: "",
        containerId: null,
        autoResize: true,
      },
    });
  });
});
