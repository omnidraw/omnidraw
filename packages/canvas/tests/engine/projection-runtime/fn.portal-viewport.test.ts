import type { TPortalGeometry } from "@omnidraw/cangine";
import { describe, expect, it } from "vitest";
import {
  fnCanvasPortalInitialViewportState,
  fnCanvasPortalViewportState,
} from "../../../src/engine/projection-runtime/fn.portal-viewport";

function geometry(
  viewportBounds: TPortalGeometry["viewportBounds"],
): TPortalGeometry {
  return {
    nodeId: "widget:render",
    viewportMatrix: [2, 0, 0, 0, 2, 0, 0, 0, 1],
    viewportBounds,
    visibleWorldBounds: {
      minX: 0,
      minY: 0,
      maxX: 500,
      maxY: 400,
    },
    clipped: true,
    interactive: true,
    devicePixelRatio: 2,
  };
}

describe("fnCanvasPortalViewportState", () => {
  it("derives CSS size, effective scale, distance, and occlusion", () => {
    expect(fnCanvasPortalViewportState({
      geometry: geometry({
        minX: 900,
        minY: 100,
        maxX: 1_100,
        maxY: 300,
      }),
      portalSize: { width: 320, height: 180 },
      canvasSize: { width: 1_000, height: 800 },
      visible: true,
    })).toEqual({
      width: 320,
      height: 180,
      scale: 4,
      visible: true,
      distance: 0,
      occlusion: 0.5,
      interactive: true,
    });

    expect(fnCanvasPortalViewportState({
      geometry: geometry({
        minX: 1_120,
        minY: 900,
        maxX: 1_320,
        maxY: 1_100,
      }),
      portalSize: { width: 320, height: 180 },
      canvasSize: { width: 1_000, height: 800 },
      visible: false,
    })).toMatchObject({
      visible: false,
      distance: Math.hypot(120, 100),
      occlusion: 1,
      interactive: false,
    });
  });

  it("starts hidden without claiming an interactive layout", () => {
    expect(fnCanvasPortalInitialViewportState()).toEqual({
      width: 0,
      height: 0,
      scale: 1,
      visible: false,
      distance: 0,
      occlusion: 1,
      interactive: false,
    });
  });
});
