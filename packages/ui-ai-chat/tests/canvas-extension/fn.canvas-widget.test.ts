import { describe, expect, test } from "vitest";
import { CANVAS_WIDGET_EXTENSION_KEY } from "@vibecanvas/canvas-contract/CONSTANTS";
import {
  fnAiWidgetPayload,
  fnCanvasWidgetExtension,
  fnCreateAiWidgetNode,
  fnCreatePublishedWidgetNode,
  fnWithAiWidgetPayload,
} from "../../src/canvas-extension/fn.canvas-widget";

const base = {
  id: "node-1",
  parentId: null,
  orderKey: "a",
  position: { x: 10, y: 20 },
  size: { width: 360, height: 240 },
  title: "Widget",
} as const;

describe("direct Cangine widget nodes", () => {
  test("creates a published widget with exact transactional identity", () => {
    const node = fnCreatePublishedWidgetNode({
      ...base,
      instanceId: "instance-1",
      definitionId: "definition-1",
      revisionId: "revision-1",
    });

    expect(node.kind).toBe("widget-frame");
    expect(node.portal.portalId).toBe("vibecanvas:widget:node-1");
    expect(fnCanvasWidgetExtension(node)).toEqual({
      schemaVersion: 1,
      type: "widget-instance",
      instanceId: "instance-1",
      definitionId: "definition-1",
      revisionId: "revision-1",
    });
  });

  test("keeps AI payload in the namespaced extension", () => {
    const node = fnCreateAiWidgetNode({ ...base, sessionId: "session-1" });
    const changed = fnWithAiWidgetPayload(node, {
      sessionId: "session-1",
      model: { provider: "openai", modelId: "gpt-5" },
      thinkingLevel: "high",
    });

    expect(fnAiWidgetPayload(changed)).toMatchObject({
      sessionId: "session-1",
      thinkingLevel: "high",
    });
    expect(changed.extensions?.[CANVAS_WIDGET_EXTENSION_KEY]).toBeDefined();
  });
});
