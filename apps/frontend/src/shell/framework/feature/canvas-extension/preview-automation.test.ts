import { expect, mock, test } from "bun:test";

import { fnPlacedWidgetNode } from "@/core/widgets/fn.placed-widget-node";
import { createWidgetPreviewAutomation } from "./preview-automation";

const catalog = {
  generation: 12,
  entries: [{
    widgetKey: "launch-pulse",
    draft: {
      health: "healthy",
      config: { name: "Launch Pulse", tool: { label: "Launch Pulse" } },
    },
  }],
};

function placedPreview() {
  return fnPlacedWidgetNode({
    id: "preview-1",
    reference: {
      source: "draft",
      widgetKey: "launch-pulse",
      catalogGeneration: 12,
    },
    bounds: { width: 360, height: 320 },
    label: "Launch Pulse",
    position: { x: 0, y: 0 },
    instanceId: "instance-1",
  });
}

function runtime(addToCanvas: ReturnType<typeof mock>) {
  return {
    api: { safeRequest: async () => [null, catalog] },
    widgetPlacement: { addToCanvas },
  } as never;
}

test("automatically places a healthy draft by widget key or display name", async () => {
  const addToCanvas = mock(async () => undefined);
  const automation = createWidgetPreviewAutomation(runtime(addToCanvas));
  const document = { nodes: () => [], setSelection: mock() };
  const unbind = automation.bind(document);

  await automation.ensure("Launch Pulse");

  expect(addToCanvas).toHaveBeenCalledWith({
    reference: {
      source: "draft",
      widgetKey: "launch-pulse",
      catalogGeneration: 12,
    },
    bounds: { width: 360, height: 320 },
    label: "Launch Pulse",
  });
  unbind();
});

test("focuses an existing Preview instead of creating a duplicate", async () => {
  const addToCanvas = mock(async () => undefined);
  const automation = createWidgetPreviewAutomation(runtime(addToCanvas));
  const existing = placedPreview();
  const setSelection = mock();
  const unbind = automation.bind({ nodes: () => [existing], setSelection });

  await automation.ensure("launch-pulse");

  expect(addToCanvas).not.toHaveBeenCalled();
  expect(setSelection).toHaveBeenCalledWith(["preview-1"], { focusedNodeId: "preview-1" });
  unbind();
});

test("places once when concurrent ensure calls race on the same draft", async () => {
  const nodes: ReturnType<typeof placedPreview>[] = [];
  const addToCanvas = mock(async () => {
    nodes.push(placedPreview());
  });
  const automation = createWidgetPreviewAutomation(runtime(addToCanvas));
  const unbind = automation.bind({ nodes: () => nodes, setSelection: mock() });

  await Promise.all([
    automation.ensure("Launch Pulse"),
    automation.ensure("launch-pulse"),
  ]);

  expect(addToCanvas).toHaveBeenCalledTimes(1);
  unbind();
});

test("accepts a later Canvas bind after the previous runtime unbinds", async () => {
  const addToCanvas = mock(async () => undefined);
  const automation = createWidgetPreviewAutomation(runtime(addToCanvas));
  const first = automation.bind({ nodes: () => [], setSelection: mock() });
  first();

  const pending = automation.ensure("Launch Pulse");
  const second = automation.bind({ nodes: () => [], setSelection: mock() });
  await pending;

  expect(addToCanvas).toHaveBeenCalledTimes(1);
  second();
});
