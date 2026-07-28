import { describe, expect, test } from "vitest";
import { CANVAS_WIDGET_EXTENSION_KEY } from "@vibecanvas/canvas-contract/CONSTANTS";
import {
  fnAiWidgetPayloadEquals,
  fnAiWidgetPayload,
  fnCanvasWidgetExtension,
  fnCreateAiWidgetNode,
  fnCreatePreviewWidgetNode,
  fnCreatePublishedWidgetNode,
  fnPreviewWidgetPayload,
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
      autoOpenedPreviewDraftIds: [
        "10000000-0000-4000-8000-000000000001",
      ],
      model: { provider: "openai", modelId: "gpt-5" },
      thinkingLevel: "high",
    });

    expect(fnAiWidgetPayload(changed)).toMatchObject({
      sessionId: "session-1",
      autoOpenedPreviewDraftIds: [
        "10000000-0000-4000-8000-000000000001",
      ],
      thinkingLevel: "high",
    });
    expect(changed.extensions?.[CANVAS_WIDGET_EXTENSION_KEY]).toBeDefined();
    expect(fnAiWidgetPayloadEquals(changed, {
      autoOpenedPreviewDraftIds: [
        "10000000-0000-4000-8000-000000000001",
      ],
      thinkingLevel: "high",
      model: { modelId: "gpt-5", provider: "openai" },
      sessionId: "session-1",
    })).toBe(true);
    expect(fnAiWidgetPayloadEquals(changed, {
      sessionId: "session-2",
    })).toBe(false);
  });

  test("creates a Preview node with only durable identity in its payload", () => {
    const node = fnCreatePreviewWidgetNode({
      ...base,
      title: "Weather Preview",
      previewId: "preview-1",
      draftId: "draft-1",
      originChatId: "chat-1",
      role: "companion",
    });

    expect(node).toMatchObject({
      kind: "widget-frame",
      title: "Weather Preview",
      portal: {
        portalId: "vibecanvas:widget:node-1",
        interactive: true,
      },
      headerItems: [
        { type: "button", id: "live-updates", label: "Pause Live Updates" },
        { type: "button", id: "cancel-build", label: "Cancel Build" },
        { type: "button", id: "retry", label: "Retry" },
        { type: "button", id: "reset", label: "Reset" },
        { type: "button", id: "publish", label: "Publish" },
      ],
    });
    expect(fnCanvasWidgetExtension(node)).toEqual({
      schemaVersion: 1,
      type: "ui-widget",
      kind: "preview",
      payload: {
        previewId: "preview-1",
        draftId: "draft-1",
        originChatId: "chat-1",
        role: "companion",
      },
    });
    expect(fnPreviewWidgetPayload(node)).toEqual({
      previewId: "preview-1",
      draftId: "draft-1",
      originChatId: "chat-1",
      role: "companion",
    });
  });

  test.each([
    undefined,
    null,
    [],
    {},
    {
      previewId: "",
      draftId: "draft-1",
      originChatId: "chat-1",
      role: "companion",
    },
    {
      previewId: "preview-1",
      draftId: " ",
      originChatId: "chat-1",
      role: "companion",
    },
    {
      previewId: "preview-1",
      draftId: "draft-1",
      originChatId: "",
      role: "companion",
    },
    {
      previewId: "preview-1",
      draftId: "draft-1",
      originChatId: "chat-1",
      role: "published",
    },
    {
      previewId: "preview-1",
      draftId: "draft-1",
      originChatId: "chat-1",
      role: "placed",
      activeRevisionId: "revision-1",
    },
  ])("rejects an invalid durable Preview payload %#", (payload) => {
    const node = fnCreateAiWidgetNode({ ...base, sessionId: "session-1" });
    const extension = {
      schemaVersion: 1,
      type: "ui-widget",
      kind: "preview",
      payload,
    };
    const changed = {
      ...node,
      extensions: {
        ...node.extensions,
        [CANVAS_WIDGET_EXTENSION_KEY]: extension,
      },
    } as never;

    expect(fnPreviewWidgetPayload(changed)).toBeNull();
  });
});
