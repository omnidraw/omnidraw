import { describe, expect, test } from "vitest";
import {
  fnClampWidgetFrameToViewport,
  fnHasWidgetDragThreshold,
  fnWidgetDropGhostProjection,
} from "../../../src/services/widget-placement/fn.widget-placement";

describe("widget drop placement core", () => {
  test("distinguishes clicks from deliberate pointer drags", () => {
    expect(fnHasWidgetDragThreshold({ origin: { x: 10, y: 10 }, point: { x: 15, y: 12 }, threshold: 6 })).toBe(false);
    expect(fnHasWidgetDragThreshold({ origin: { x: 10, y: 10 }, point: { x: 16, y: 10 }, threshold: 6 })).toBe(true);
  });

  test("keeps a frame visible and anchors oversized frames at the viewport origin", () => {
    expect(fnClampWidgetFrameToViewport({
      point: { x: 390, y: 280 },
      bounds: { width: 100, height: 80 },
      viewport: { x: 0, y: 0, width: 400, height: 300 },
    })).toEqual({ x: 300, y: 220, width: 100, height: 80 });
    expect(fnClampWidgetFrameToViewport({
      point: { x: 100, y: 100 },
      bounds: { width: 500, height: 400 },
      viewport: { x: 20, y: 30, width: 400, height: 300 },
    })).toEqual({ x: 20, y: 30, width: 500, height: 400 });
  });

  test("projects a portal-free widget frame and strengthens it while committing", () => {
    const request = {
      reference: {
        source: "draft" as const,
        name: "Weather",
        revision: "revision-1",
      },
      bounds: { width: 360, height: 320 },
      label: "Weather",
    };
    const positioning = fnWidgetDropGhostProjection({
      request,
      position: { x: 20, y: 30 },
      zoom: 2,
      state: "positioning",
    });
    const committing = fnWidgetDropGhostProjection({
      request,
      position: { x: 20, y: 30 },
      zoom: 2,
      state: "committing",
    });

    expect(positioning.band).toBe("world-overlay");
    expect(positioning.hitTest).toBe("none");
    expect(positioning.nodes[0]).toMatchObject({
      kind: "widget-frame",
      title: "Weather · Draft",
      pointerEvents: "none",
      transform: { position: { x: 20, y: 30 } },
    });
    expect(committing.nodes[0]).toMatchObject({
      kind: "widget-frame",
      title: "Building Weather Preview…",
    });
    expect(committing.nodes[0]).not.toHaveProperty("portal");
  });
});
