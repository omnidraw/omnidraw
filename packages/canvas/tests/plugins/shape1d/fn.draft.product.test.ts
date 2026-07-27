import { describe, expect, it } from "vitest";
import { fnCreateDraftElement } from "../../../src/plugins/shape1d/fn.draft";

describe("shape1d product draft", () => {
  it("persists arrow endpoints in local coordinates without renderer state", () => {
    const element = fnCreateDraftElement({
      activeTool: "arrow",
      draftElementId: "arrow-1",
      draftStartPoint: [10, 20],
      draftCurrentPoint: [50, 70],
      createId: () => "unused",
      now: () => 123,
    });

    expect(element).toMatchObject({
      id: "arrow-1",
      x: 10,
      y: 20,
      rotation: 0,
      data: {
        type: "arrow",
        points: [[0, 0], [40, 50]],
        startBinding: null,
        endBinding: null,
        startCap: "none",
        endCap: "arrow",
      },
    });
  });

  it("persists product binding payloads without engine node identities", () => {
    const startBinding = {
      targetId: "source",
      anchor: { x: 1, y: 0.5 },
    };
    const endBinding = {
      targetId: "destination",
      anchor: { x: 0, y: 0.5 },
    };
    const element = fnCreateDraftElement({
      activeTool: "line",
      draftElementId: "line-1",
      draftStartPoint: [100, 50],
      draftCurrentPoint: [300, 50],
      createId: () => "unused",
      now: () => 123,
      startBinding,
      endBinding,
    });

    expect(element?.data).toMatchObject({
      startBinding,
      endBinding,
    });
  });
});
