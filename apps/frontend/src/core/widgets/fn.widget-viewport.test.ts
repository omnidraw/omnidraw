import { describe, expect, test } from "vitest";
import type { TWidgetFrameNode } from "@omnidraw/canvas-contract";
import { fnWidgetViewport } from "./fn.widget-viewport";

function frame(
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
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    visibility,
    extensions: {},
  };
}

const visibleScheduling = Object.freeze({
  eligible: true,
  visible: true,
  priority: 1,
  distance: 0,
  occlusion: 0,
});

describe("fnWidgetViewport", () => {
  test("uses the live host box instead of the authored Canvas size", () => {
    expect(fnWidgetViewport({
      node: frame(),
      width: 1_024,
      height: 768,
      devicePixelRatio: 2,
      scheduling: visibleScheduling,
    })).toMatchObject({
      width: 1_024,
      height: 768,
      scale: 2,
      visibility: "visible",
    });
  });

  test("falls back to the authored size before the host has layout", () => {
    expect(fnWidgetViewport({
      node: frame(),
      width: 0,
      height: Number.NaN,
      devicePixelRatio: 0,
      scheduling: visibleScheduling,
    })).toMatchObject({
      width: 512,
      height: 384,
      scale: 1,
      visibility: "visible",
    });
  });

  test("bounds device pixel density independently of Canvas transforms", () => {
    expect(fnWidgetViewport({
      node: frame(), width: 512, height: 384, devicePixelRatio: 0.1,
      scheduling: visibleScheduling,
    }).scale).toBe(0.25);
    expect(fnWidgetViewport({
      node: frame(), width: 512, height: 384, devicePixelRatio: 20,
      scheduling: visibleScheduling,
    }).scale).toBe(8);
  });

  test("rounds fractional live dimensions to runtime integers", () => {
    expect(fnWidgetViewport({
      node: frame(),
      width: 510.888,
      height: 415.516,
      devicePixelRatio: 1,
      scheduling: visibleScheduling,
    })).toMatchObject({ width: 511, height: 416 });
  });

  test("preserves hidden scheduling state", () => {
    expect(fnWidgetViewport({
      node: frame("hidden"), width: 512, height: 384, devicePixelRatio: 1,
      scheduling: visibleScheduling,
    }).visibility).toBe("hidden");
  });

  test("projects and bounds authoritative host scheduling metadata", () => {
    expect(fnWidgetViewport({
      node: frame(),
      width: 512,
      height: 384,
      devicePixelRatio: 1,
      scheduling: {
        eligible: true,
        visible: false,
        priority: 99,
        distance: Number.POSITIVE_INFINITY,
        occlusion: -2,
      },
    })).toMatchObject({
      visibility: "hidden",
      priority: 4,
      distance: 1_000_000,
      occlusion: 0,
    });
  });
});
