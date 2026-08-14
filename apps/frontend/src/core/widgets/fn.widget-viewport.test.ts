import { describe, expect, test } from "vitest";
import type { TWidgetFrameNode } from "@omnidraw/canvas-contract";
import { fnWidgetViewport } from "./fn.widget-viewport";

function frame(
  scale: number,
  visibility: "visible" | "hidden" = "visible",
  size = { width: 512, height: 384 },
): TWidgetFrameNode {
  return {
    id: "widget-frame",
    parentId: null,
    orderKey: "A",
    kind: "widget-frame",
    size,
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: scale, y: scale },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    visibility,
    extensions: {},
  };
}

describe("fnWidgetViewport", () => {
  test("clamps a zoomed-out Canvas frame to the runtime minimum scale", () => {
    expect(fnWidgetViewport(frame(0.1))).toMatchObject({
      width: 512,
      height: 384,
      scale: 0.25,
      visibility: "visible",
    });
  });

  test("normalizes mirrored and oversized Canvas scales", () => {
    expect(fnWidgetViewport(frame(-2)).scale).toBe(2);
    expect(fnWidgetViewport(frame(20)).scale).toBe(8);
  });

  test("rounds fractional Canvas sizes to bounded runtime dimensions", () => {
    expect(fnWidgetViewport(frame(1, "visible", {
      width: 510.888,
      height: 415.516,
    }))).toMatchObject({ width: 511, height: 416 });
  });

  test("preserves hidden scheduling state", () => {
    expect(fnWidgetViewport(frame(1, "hidden")).visibility).toBe("hidden");
  });
});
