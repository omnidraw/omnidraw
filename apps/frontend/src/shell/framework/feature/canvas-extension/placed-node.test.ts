import { expect, test } from "bun:test";
import { CanvasSceneNodeCodec } from "@omnidraw/canvas-contract";
import {
  fnPlacedWidgetNode,
  fnWidgetPreviewActionId,
  WIDGET_PREVIEW_ACTIONS,
} from "@/core/widgets/fn.placed-widget-node";

test("catalog placement builds a fixed-chrome-valid Canvas widget frame", () => {
  const node = fnPlacedWidgetNode({
    id: "node-1",
    reference: { source: "draft", widgetKey: "weather", catalogGeneration: 1 },
    bounds: { width: 360, height: 320 },
    label: "Weather",
    position: { x: 100, y: 50 },
    instanceId: "instance-1",
    titleBarColor: { space: "srgb", r: 1, g: 0.5, b: 0, a: 1 },
  });
  const decoded = CanvasSceneNodeCodec.decode({ ...node, orderKey: "test-order" });
  expect(decoded.kind).toBe("widget-frame");
  if (decoded.kind !== "widget-frame") throw new Error("Expected widget frame.");
  expect(decoded.minSize).toEqual({ width: 160, height: 120 });
  expect(decoded.minSize!.width).toBeGreaterThanOrEqual(116);
  expect(decoded.size.width).toBe(360);
  expect(decoded.title).toBe("Preview: Weather");
  expect(decoded.headerItems).toEqual([{
    type: "dropdown",
    id: "preview-actions",
    label: "Preview actions",
    content: { type: "text", text: "•••" },
    items: WIDGET_PREVIEW_ACTIONS.map((action) => ({ ...action })),
  }]);
  expect(decoded.extensions?.["omnidraw:widget"]).toMatchObject({
    type: "widget-preview",
    widgetKey: "weather",
  });
});

test("Preview action policy accepts the native Canvas dropdown path", () => {
  expect(fnWidgetPreviewActionId("preview-actions/reload")).toBe("reload");
  expect(fnWidgetPreviewActionId("preview-actions/rebuild")).toBe("rebuild");
  expect(fnWidgetPreviewActionId("preview-actions/publish")).toBe("publish");
  expect(fnWidgetPreviewActionId("preview-actions/remove")).toBe("remove");
  expect(fnWidgetPreviewActionId("reload")).toBe("reload");
  expect(fnWidgetPreviewActionId("other/remove")).toBeNull();
});
