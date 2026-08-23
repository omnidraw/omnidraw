import { describe, expect, it, vi } from "vitest";
import {
  CANVAS_WIDGET_EXTENSION_KEY,
  fnReadCanvasWidgetExtension,
  type TCanvasWidgetHostRegistration,
  type TWidgetFrameNode,
} from "@omnidraw/canvas";
import { createAiChatCanvasExtension } from "../src/canvas-extension";
import {
  createTestAiChatPort,
  createTestChatBrowser,
  createTestHostActions,
} from "./test-setup";

function extension() {
  return createAiChatCanvasExtension({
    port: { actions: {}, events: vi.fn() } as never,
    browser: {} as never,
    host: {} as never,
    createSessionId: () => "session-1",
  });
}

describe("AI Chat Canvas extension", () => {
  it("clamps a short drag to the durable widget minimum without moving its origin", () => {
    const nodes = extension().createWidgetNodes?.({
      kind: "widget",
      nodeId: "chat-1",
      parentId: null,
      draft: {
        worldBounds: { x: 10, y: 20, width: 80, height: 60 },
        belowThreshold: false,
      },
    });

    expect(nodes).toHaveLength(1);
    const node = nodes?.[0];
    expect(node?.kind).toBe("widget-frame");
    if (node?.kind !== "widget-frame") throw new Error("AI Chat did not create a widget frame.");
    expect(node.transform.position).toEqual({ x: 10, y: 20 });
    expect(node.size).toEqual({ width: 240, height: 160 });
    expect(node.minSize).toEqual({ width: 240, height: 160 });
    expect(fnReadCanvasWidgetExtension(node)).toEqual({
      schemaVersion: 1,
      type: "ui-widget",
      kind: "ai-chat",
      payload: { sessionId: "session-1", approvalPolicy: { mode: "manual" } },
    });
  });

  it("preserves a user drag that is already larger than the minimum", () => {
    const node = extension().createWidgetNodes?.({
      kind: "widget",
      nodeId: "chat-2",
      parentId: null,
      draft: {
        worldBounds: { x: -5, y: 8, width: 640, height: 480 },
        belowThreshold: false,
      },
    })?.[0];
    expect(node?.kind === "widget-frame" ? node.size : null).toEqual({ width: 640, height: 480 });
  });

  it("persists New Chat state through one Canvas upsert without duplicate titlebar chrome", async () => {
    let registration: TCanvasWidgetHostRegistration | undefined;
    const commit = vi.fn();
    const connect = vi.fn(async () => ({ history: [] }));
    const contribution = createAiChatCanvasExtension({
      port: createTestAiChatPort({ connect }),
      browser: createTestChatBrowser(),
      host: createTestHostActions(),
      createSessionId: () => "session-next",
    });
    const install = await contribution.install({
      config: {
        canvasId: "canvas-a",
        container: document.createElement("div"),
        notification: {
          showError: vi.fn(),
          showInfo: vi.fn(),
          showSuccess: vi.fn(),
        },
      },
      document: {
        item: () => null,
        items: () => [],
        node: () => null,
        nodes: () => [],
        childrenOf: () => [],
        query: async () => ({ items: [], nextCursor: null }),
        commit,
        setSelection: vi.fn(),
        subscribe: () => () => undefined,
      },
      placement: {} as never,
      widgets: {
        register(next) {
          registration = next;
          return () => { registration = undefined; };
        },
      },
      trace: null,
      shell: {} as never,
    });
    const created = contribution.createWidgetNodes?.({
      kind: "widget",
      nodeId: "chat-persisted",
      parentId: null,
      draft: {
        worldBounds: { x: 0, y: 0, width: 360, height: 280 },
        belowThreshold: false,
      },
    })?.[0];
    if (created?.kind !== "widget-frame") throw new Error("AI Chat node missing.");
    const node: TWidgetFrameNode = {
      ...created,
      extensions: {
        ...created.extensions,
        [CANVAS_WIDGET_EXTENSION_KEY]: {
          schemaVersion: 1,
          type: "ui-widget",
          kind: "ai-chat",
          payload: {
            sessionId: "session-current",
            approvalPolicy: {
              mode: "ai-review",
              reviewerModel: { provider: "openai", modelId: "reviewer-test" },
            },
            model: { provider: "openai", modelId: "gpt-test" },
            thinkingLevel: "xhigh",
          },
        },
      },
    };
    let host = document.createElement("div");
    document.body.append(host);
    const setTitlebar = vi.fn();
    let cleanup = await registration?.mount({
      node,
      container: host,
      signal: new AbortController().signal,
      setTitlebar,
      onNodeChange: () => () => undefined,
    });

    await vi.waitFor(() => expect(connect).toHaveBeenCalledWith({
      canvasId: "canvas-a",
      componentId: "chat-persisted",
      sessionId: "session-current",
      approvalPolicy: {
        mode: "ai-review",
        reviewerModel: { provider: "openai", modelId: "reviewer-test" },
      },
      mode: "reuse",
    }));
    if (typeof cleanup === "function") cleanup();
    host.remove();

    host = document.createElement("div");
    document.body.append(host);
    cleanup = await registration?.mount({
      node,
      container: host,
      signal: new AbortController().signal,
      setTitlebar,
      onNodeChange: () => () => undefined,
    });
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    expect(connect).toHaveBeenLastCalledWith(expect.objectContaining({
      componentId: "chat-persisted",
      sessionId: "session-current",
      approvalPolicy: {
        mode: "ai-review",
        reviewerModel: { provider: "openai", modelId: "reviewer-test" },
      },
    }));

    const actions = await vi.waitFor(() => {
      const button = host.querySelector<HTMLButtonElement>(
        "button[aria-label='Chat actions']",
      );
      expect(button).not.toBeNull();
      return button!;
    });
    actions.click();
    const newChat = await vi.waitFor(() => {
      const button = [...host.querySelectorAll<HTMLButtonElement>("[role='menuitem']")]
        .find((candidate) => candidate.textContent?.trim() === "New chat");
      expect(button).not.toBeUndefined();
      return button!;
    });
    newChat.click();

    expect(setTitlebar).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith({
      source: "omnidraw.ai-chat.state",
      coalesceKey: "omnidraw.ai-chat.state:chat-persisted",
      commands: [{
        type: "upsert",
        node: expect.objectContaining({
          id: "chat-persisted",
          headerItems: [expect.objectContaining({ id: "settings" })],
          extensions: expect.objectContaining({
            [CANVAS_WIDGET_EXTENSION_KEY]: expect.objectContaining({
              kind: "ai-chat",
              payload: {
                sessionId: "session-next",
                approvalPolicy: { mode: "manual" },
                model: { provider: "openai", modelId: "gpt-test" },
                thinkingLevel: "xhigh",
              },
            }),
          }),
        }),
      }],
    });

    if (typeof cleanup === "function") cleanup();
    host.remove();
    await install.dispose?.();
  });
});
