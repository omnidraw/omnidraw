import { describe, expect, it } from "vitest";
import { fnMergeProductSelectionTransformPolicy } from "../../../src/plugins/transform/fn.selection-policy";

describe("mixed product transform policy", () => {
  it("uses only common handles and the safest mixed-selection constraints", () => {
    expect(fnMergeProductSelectionTransformPolicy({
      policies: [
        {
          handles: ["move", "rotate", "resize-e", "resize-w"],
          keepAspectRatio: false,
          allowFlip: true,
          allowRotate: true,
          minSize: { width: 10, height: 10 },
          snapRotationDegrees: 15,
        },
        {
          handles: ["move", "rotate", "resize-e"],
          keepAspectRatio: true,
          allowFlip: false,
          allowRotate: true,
          minSize: { width: 80, height: 60 },
          snapRotationDegrees: 15,
        },
      ],
      includeSizeConstraints: false,
      forceAspectRatio: false,
    })).toEqual({
      handles: ["move", "rotate", "resize-e"],
      keepAspectRatio: true,
      allowFlip: false,
      allowRotate: true,
      snapRotationDegrees: 15,
    });
  });

  it("disables unsafe actions when any selected product vetoes them", () => {
    expect(fnMergeProductSelectionTransformPolicy({
      policies: [
        { handles: ["move", "rotate"], allowRotate: true },
        { handles: [], allowRotate: false },
      ],
      includeSizeConstraints: false,
      forceAspectRatio: true,
    })).toMatchObject({
      handles: [],
      allowRotate: false,
      keepAspectRatio: true,
    });
  });
});
