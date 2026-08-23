import { expect, test } from "bun:test";
import { CanvasSceneNodeCodec, fnReadCanvasWidgetExtension } from "@omnidraw/canvas-contract";
import {
  fnPlacedWidgetNode,
  fnReplacePreviewWithPublishedWidget,
  fnWidgetPreviewActionId,
  fnWidgetPreviewHeaderItems,
  fnWidgetPreviewWithPublishedActionAvailability,
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
  expect(decoded.headerItems).toEqual(fnWidgetPreviewHeaderItems(false));
  expect(decoded.extensions?.["omnidraw:widget"]).toMatchObject({
    type: "widget-preview",
    widgetKey: "weather",
  });
});

test("Preview action policy accepts the native Canvas dropdown path", () => {
  expect(fnWidgetPreviewActionId("preview-actions/reload")).toBe("reload");
  expect(fnWidgetPreviewActionId("preview-actions/rebuild")).toBe("rebuild");
  expect(fnWidgetPreviewActionId("preview-actions/publish")).toBe("publish");
  expect(fnWidgetPreviewActionId("preview-actions/replace-with-published"))
    .toBe("replace-with-published");
  expect(fnWidgetPreviewActionId("preview-actions/remove")).toBe("remove");
  expect(fnWidgetPreviewActionId("reload")).toBe("reload");
  expect(fnWidgetPreviewActionId("other/remove")).toBeNull();
});

test("Preview replacement availability is projected into the one native action menu", () => {
  const placed = fnPlacedWidgetNode({
    id: "node-1",
    reference: { source: "draft", widgetKey: "weather", catalogGeneration: 1 },
    bounds: { width: 360, height: 320 },
    label: "Weather",
    position: { x: 100, y: 50 },
    instanceId: "preview-1",
  });
  const node = CanvasSceneNodeCodec.decode({ ...placed, orderKey: "test-order" });
  if (node.kind !== "widget-frame") throw new Error("Expected widget frame.");

  const available = CanvasSceneNodeCodec.decode(
    fnWidgetPreviewWithPublishedActionAvailability(node, true),
  );
  expect(available.kind === "widget-frame" ? available.headerItems : null)
    .toEqual(fnWidgetPreviewHeaderItems(true));
  const unavailable = CanvasSceneNodeCodec.decode(
    fnWidgetPreviewWithPublishedActionAvailability(
      available.kind === "widget-frame" ? available : node,
      false,
    ),
  );
  expect(unavailable.kind === "widget-frame" ? unavailable.headerItems : null)
    .toEqual(fnWidgetPreviewHeaderItems(false));
});

test("Preview replacement preserves layout and ordinary props while projecting exact published identity", () => {
  const placed = fnPlacedWidgetNode({
    id: "node-1",
    reference: { source: "draft", widgetKey: "weather", catalogGeneration: 1 },
    bounds: { width: 360, height: 320 },
    label: "Draft Weather",
    position: { x: 100, y: 50 },
    instanceId: "preview-1",
    titleBarColor: { space: "srgb", r: 1, g: 0.5, b: 0, a: 1 },
  });
  const basePreview = CanvasSceneNodeCodec.decode({ ...placed, orderKey: "test-order" });
  const baseExtension = fnReadCanvasWidgetExtension(basePreview);
  if (baseExtension?.type !== "widget-preview") throw new Error("Expected Preview extension.");
  const preview = CanvasSceneNodeCodec.decode({
    ...basePreview,
    visibility: "hidden",
    pointerEvents: "none",
    metadata: { locked: true },
    opacity: 0.6,
    extensions: {
      ...basePreview.extensions,
      "example:ordinary": { retained: true },
      "omnidraw:widget": {
        ...baseExtension,
        uiProps: { count: 4 },
      },
    },
  });
  if (preview.kind !== "widget-frame") throw new Error("Expected widget frame.");

  const published = CanvasSceneNodeCodec.decode(fnReplacePreviewWithPublishedWidget({
    node: preview,
    widgetKey: "weather",
    instanceId: "published-1",
    publishedTitle: "Published Weather",
  }));
  const {
    titleBarColor: _titleBarColor,
    headerItems: _headerItems,
    ...ordinaryPreview
  } = preview;
  expect(published).toEqual({
    ...ordinaryPreview,
    title: "Published Weather",
    headerItems: [],
    extensions: {
      ...preview.extensions,
      "omnidraw:widget": {
        schemaVersion: 1,
        type: "widget-instance",
        instanceId: "published-1",
        widgetKey: "weather",
        uiProps: { count: 4 },
      },
    },
  });
  expect(published).not.toHaveProperty("titleBarColor");
});
