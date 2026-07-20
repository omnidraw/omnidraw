import { describe, expect, test } from "vitest";
import {
  fnClampWidgetFrameToViewport,
  fnClientPointToWidgetWorldPoint,
  fnHasWidgetDragThreshold,
  fnWidgetVisibleWorldViewport,
} from "../../../src/services/widget-placement/fn.widget-placement";

describe("widget drop placement core", () => {
  test("distinguishes clicks from deliberate pointer drags", () => {
    expect(fnHasWidgetDragThreshold({ origin: { x: 10, y: 10 }, point: { x: 15, y: 12 }, threshold: 6 })).toBe(false);
    expect(fnHasWidgetDragThreshold({ origin: { x: 10, y: 10 }, point: { x: 16, y: 10 }, threshold: 6 })).toBe(true);
  });

  test("converts viewport client coordinates through pan and zoom exactly once", () => {
    expect(fnClientPointToWidgetWorldPoint({
      clientPoint: { x: 450, y: 260 },
      canvasClientOrigin: { x: 100, y: 50 },
      camera: { x: -50, y: 10, zoom: 2 },
    })).toEqual({ x: 200, y: 100 });
    expect(fnWidgetVisibleWorldViewport({
      camera: { x: -50, y: 10, zoom: 2 },
      viewportWidth: 800,
      viewportHeight: 600,
    })).toEqual({ x: 25, y: -5, width: 400, height: 300 });
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
});
