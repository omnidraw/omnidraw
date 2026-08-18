import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IAiChatActions, IAiChatPort, TAiChatStreamEvent } from "../../src/index.js";
import { AiChat } from "../../src/index.js";
import {
  createTestAiChatPort,
  createTestChatBrowser,
  createTestHostActions,
} from "../test-setup.js";

const SYNTHETIC_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==";

let disposeRendered: (() => void) | undefined;
let container: HTMLDivElement | undefined;

function deferredStream(onReturn: () => void = () => {}): {
  readonly emit: (event: TAiChatStreamEvent) => void;
  readonly stream: IAiChatPort["events"];
} {
  const events: TAiChatStreamEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    emit(event) {
      events.push(event);
      wake?.();
      wake = undefined;
    },
    stream: (_request, options) => ({
      [Symbol.asyncIterator]() {
        options?.signal?.addEventListener("abort", () => {
          closed = true;
          wake?.();
        }, { once: true });
        return {
          async next(): Promise<IteratorResult<TAiChatStreamEvent>> {
            while (events.length === 0 && !closed) {
              await new Promise<void>((resolve) => { wake = resolve; });
            }
            const value = events.shift();
            return value === undefined
              ? { done: true, value: undefined }
              : { done: false, value };
          },
          async return() {
            closed = true;
            onReturn();
            wake?.();
            return { done: true as const, value: undefined };
          },
        };
      },
    }),
  };
}

function mount(port: IAiChatPort, extras: Partial<Parameters<typeof AiChat>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  disposeRendered = render(() => AiChat({
    id: "surface-1",
    canvasId: "canvas-1",
    sessionId: "conversation-1",
    port,
    host: createTestHostActions(),
    browser: createTestChatBrowser(),
    titleBar: { onAction: () => () => {}, setActionState: () => {} },
    onResetSessionId: () => "conversation-2",
    ...extras,
  }), container);
}

afterEach(() => {
  disposeRendered?.();
  disposeRendered = undefined;
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
});

describe("AiChat portable shell", () => {
  it("renders streamed PNG tool output and reconciles canonical history", async () => {
    const message = {
      role: "toolResult",
      toolCallId: "tool-call-image",
      toolName: "synthetic_image_transport_proof",
      content: [
        { type: "text", text: "Synthetic image transport proof." },
        { type: "image", mimeType: "image/png", data: SYNTHETIC_PNG_BASE64 },
      ],
      timestamp: 1,
    };
    const getHistory = vi.fn(async () => [{ entryId: "tool-entry-image", message }]);
    const stream = deferredStream();
    mount(createTestAiChatPort({ getHistory }, stream.stream));

    stream.emit({
      kind: "session",
      componentId: "surface-1",
      sessionId: "conversation-1",
      event: { type: "message-end", message },
    });

    await vi.waitFor(() => expect(container?.querySelectorAll(".omnidraw-ai-chat-history__image")).toHaveLength(1));
    expect(container?.querySelector<HTMLImageElement>(".omnidraw-ai-chat-history__image")?.alt)
      .toBe("Image result from synthetic_image_transport_proof");
    expect(container?.textContent).not.toContain(SYNTHETIC_PNG_BASE64);
  });

  it.each(["widgets", "resources"] as const)(
    "refreshes mentions and invalidates the host catalog for %s events",
    async (catalog) => {
      const getContextCatalog = vi.fn(async () => ({ mentions: [], resources: [] }));
      const invalidateCatalog = vi.fn();
      const stream = deferredStream();
      mount(createTestAiChatPort({ getContextCatalog }, stream.stream), {
        host: createTestHostActions({ invalidateCatalog }),
      });
      await vi.waitFor(() => expect(getContextCatalog).toHaveBeenCalledOnce());
      getContextCatalog.mockClear();

      stream.emit({ kind: "catalog", catalog });

      await vi.waitFor(() => expect(invalidateCatalog).toHaveBeenCalledWith(catalog));
      await vi.waitFor(() => expect(getContextCatalog).toHaveBeenCalledOnce());
    },
  );

  it("keeps the event stream alive when host catalog invalidation throws", async () => {
    const logError = vi.fn();
    const stream = deferredStream();
    mount(createTestAiChatPort({}, stream.stream), {
      host: createTestHostActions({
        invalidateCatalog: () => { throw new Error("host invalidation failed"); },
        logError,
      }),
    });

    stream.emit({ kind: "catalog", catalog: "widgets" });
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "host invalidation failed" }),
    ));
    stream.emit({
      kind: "session",
      componentId: "surface-1",
      sessionId: "conversation-1",
      event: { type: "agent-start" },
    });

    await vi.waitFor(() => expect(container?.querySelector(
      "[aria-label='Stop response']",
    )).not.toBeNull());
  });

  it("renders a resolved policy approval as executed without manual action buttons", async () => {
    const toolCallMessage = {
      role: "assistant",
      content: [{
        type: "toolCall",
        id: "tool-call-policy",
        name: "od_resource_create",
        arguments: {},
      }],
    };
    const stream = deferredStream();
    mount(createTestAiChatPort({
      connect: async () => ({
        history: [{ entryId: "assistant-policy", message: toolCallMessage }],
      }),
    }, stream.stream));

    stream.emit({
      kind: "approval",
      componentId: "surface-1",
      sessionId: "conversation-1",
      type: "resolved",
      decision: "approve",
      approval: {
        id: "approval-policy",
        chatId: "conversation-1",
        toolCallId: "tool-call-policy",
        kind: "resource-create",
        summary: "Create cache",
        risk: "medium",
        warnings: [],
        details: { resourceId: "cache-1" },
        createdAtSec: "2026-08-16T10:00:00.000Z",
        policyMode: "always-approve",
        decisionSource: "policy",
      },
    });

    const approval = await vi.waitFor(() => {
      const card = container?.querySelector<HTMLElement>(
        ".omnidraw-ai-chat-tool-call .omnidraw-ai-chat-approval",
      );
      expect(card).not.toBeNull();
      return card!;
    });
    expect(approval.dataset.status).toBe("executed");
    expect(approval.textContent).toContain("Decision: policy");
    expect(approval.textContent).not.toContain("Reject");
    expect(approval.textContent).not.toContain("Approve");
    expect(container?.querySelectorAll(".omnidraw-ai-chat-approval__actions")).toHaveLength(0);
    expect(container?.querySelectorAll(".omnidraw-ai-chat-approvals--floating .omnidraw-ai-chat-approval")).toHaveLength(0);
  });

  it("cancels with the portable session scope and restores canonical history", async () => {
    const message = { role: "assistant", content: "Completed before cancellation.", timestamp: 1 };
    const cancel = vi.fn(async () => ({ canceled: true, running: false }));
    const getHistory = vi.fn(async () => [{ entryId: "assistant-1", message }]);
    const stream = deferredStream();
    mount(createTestAiChatPort({ cancel, getHistory }, stream.stream));
    stream.emit({
      kind: "session",
      componentId: "surface-1",
      sessionId: "conversation-1",
      event: { type: "agent-start" },
    });

    const stopButton = await vi.waitFor(() => {
      const button = container?.querySelector<HTMLButtonElement>("[aria-label='Stop response']");
      expect(button).not.toBeNull();
      return button!;
    });
    stopButton.click();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith({
      componentId: "surface-1",
      sessionId: "conversation-1",
    }));
    await vi.waitFor(() => expect(container?.textContent).toContain("Completed before cancellation."));
  });

  it("uses injected titlebar actions without rendering an application header", async () => {
    let settingsAction: (() => void) | undefined;
    const setActionState = vi.fn();
    mount(createTestAiChatPort(), {
      titleBar: {
        onAction: (id, handler) => {
          if (id === "settings") settingsAction = handler;
          return () => { if (settingsAction === handler) settingsAction = undefined; };
        },
        setActionState,
      },
    });

    await vi.waitFor(() => expect(settingsAction).toBeTypeOf("function"));
    expect(container?.querySelector(".omnidraw-ai-chat-header")).toBeNull();
    settingsAction?.();
    await vi.waitFor(() => expect(container?.querySelector(".omnidraw-ai-chat-view--settings")).not.toBeNull());
    expect(container?.textContent).not.toContain("Approval policy");
    expect(container?.textContent).not.toContain("Always approve");
    expect(setActionState).toHaveBeenLastCalledWith("settings", { pressed: true, label: "Back to chat" });
  });

  it("aborts its Effect-owned stream when disposed", async () => {
    let streamSignal: AbortSignal | undefined;
    const stream = deferredStream();
    const events: IAiChatPort["events"] = (request, options) => {
      streamSignal = options?.signal;
      return stream.stream(request, options);
    };
    mount(createTestAiChatPort({}, events));
    await vi.waitFor(() => expect(streamSignal).toBeDefined());
    disposeRendered?.();
    disposeRendered = undefined;
    expect(streamSignal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container?.textContent ?? "").not.toContain("Chat updates disconnected");
  });

  it("reuses the mounted session and restarts events on host reconnect", async () => {
    let reconnect: (() => void) | undefined;
    const unsubscribeReconnect = vi.fn();
    const connect = vi.fn(async () => ({ history: [] }));
    const events = vi.fn<IAiChatPort["events"]>((_request, options) => ({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    }));
    const base = createTestAiChatPort({ connect }, events);
    mount({
      ...base,
      subscribeReconnect(listener) {
        reconnect = listener;
        return unsubscribeReconnect;
      },
    });

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(1));
    reconnect?.();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(2));
    expect(connect).toHaveBeenLastCalledWith({
      canvasId: "canvas-1",
      componentId: "surface-1",
      sessionId: "conversation-1",
      approvalPolicy: { mode: "manual" },
      mode: "reuse",
    });

    disposeRendered?.();
    disposeRendered = undefined;
    expect(unsubscribeReconnect).toHaveBeenCalledOnce();
  });

  it("publishes New Chat session, model, and thinking as one durable state", async () => {
    const onStateChange = vi.fn();
    mount(createTestAiChatPort(), {
      preference: {
        approvalPolicy: { mode: "always-approve" },
        model: { provider: "openai", modelId: "gpt-test" },
        thinkingLevel: "high",
      },
      onStateChange,
    });

    const actions = await vi.waitFor(() => {
      const button = container?.querySelector<HTMLButtonElement>(
        "button[aria-label='Chat actions']",
      );
      expect(button).not.toBeNull();
      return button!;
    });
    actions.click();
    const newChat = await vi.waitFor(() => {
      const button = [...container?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitem']",
      ) ?? []].find((candidate) => candidate.textContent?.trim() === "New chat");
      expect(button).not.toBeUndefined();
      return button!;
    });
    newChat.click();

    expect(onStateChange).toHaveBeenCalledOnce();
    expect(onStateChange).toHaveBeenCalledWith({
      sessionId: "conversation-2",
      preference: {
        approvalPolicy: { mode: "manual" },
        model: { provider: "openai", modelId: "gpt-test" },
        thinkingLevel: "high",
      },
    });
  });

  it("persists a composer policy change through only the mounted chat scope", async () => {
    const setApprovalPolicy = vi.fn<IAiChatActions["setApprovalPolicy"]>(
      async (request) => request.policy,
    );
    const onStateChange = vi.fn();
    mount(createTestAiChatPort({ setApprovalPolicy }), {
      preference: { approvalPolicy: { mode: "manual" } },
      onStateChange,
    });

    const trigger = await vi.waitFor(() => {
      const button = container?.querySelector<HTMLButtonElement>(
        "button[aria-label^='Protected operations approval mode']",
      );
      expect(button).not.toBeNull();
      return button!;
    });
    trigger.click();
    const automatic = await vi.waitFor(() => {
      const button = [...container?.querySelectorAll<HTMLButtonElement>(
        "[role='menuitemradio']",
      ) ?? []].find((candidate) => candidate.textContent?.includes("Always approve"));
      expect(button).not.toBeUndefined();
      return button!;
    });
    automatic.click();

    await vi.waitFor(() => expect(setApprovalPolicy).toHaveBeenCalledWith({
      componentId: "surface-1",
      sessionId: "conversation-1",
      policy: { mode: "always-approve" },
    }));
    await vi.waitFor(() => expect(onStateChange).toHaveBeenCalledWith({
      sessionId: "conversation-1",
      preference: { approvalPolicy: { mode: "always-approve" } },
    }));
    expect(trigger.dataset.mode).toBe("always-approve");
    expect(trigger.getAttribute("aria-label")).toContain("Always approve");
  });

  it("submits with an unchanged durable preference without emitting a no-op state write", async () => {
    if (typeof Range.prototype.getBoundingClientRect !== "function") {
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0,
          toJSON: () => ({}),
        }),
      });
    }
    if (typeof Range.prototype.getClientRects !== "function") {
      Object.defineProperty(Range.prototype, "getClientRects", {
        configurable: true,
        value: () => Object.assign([], { item: () => null }),
      });
    }
    const onStateChange = vi.fn();
    const prompt = vi.fn(async () => undefined);
    mount(createTestAiChatPort({
      prompt,
      getSettings: async () => ({
        defaultModel: "gpt-test",
        defaultProvider: "openai",
        defaultThinkingLevel: "xhigh",
        models: [{
          id: "gpt-test",
          input: ["text"],
          name: "GPT Test",
          provider: "openai",
        }],
        providers: ["openai"],
        providersWithCredentials: ["openai"],
      }),
    }), {
      preference: {
        approvalPolicy: { mode: "manual" },
        model: { provider: "openai", modelId: "gpt-test" },
        thinkingLevel: "xhigh",
      },
      onStateChange,
    });

    const editor = await vi.waitFor(() => {
      const element = container?.querySelector<HTMLElement>(
        ".omnidraw-ai-chat-composer__editor",
      );
      expect(element).not.toBeNull();
      return element!;
    });
    editor.innerHTML = "<p>Send the durable prompt.</p>";
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "Send the durable prompt.",
      inputType: "insertText",
    }));
    await vi.waitFor(() => {
      expect(container?.querySelector<HTMLButtonElement>(
        "[aria-label='Send prompt']",
      )).not.toBeNull();
    });
    container?.querySelector<HTMLButtonElement>("[aria-label='Send prompt']")!.click();

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      text: "Send the durable prompt.",
      model: { provider: "openai", modelId: "gpt-test" },
      thinkingLevel: "xhigh",
    }));
    expect(onStateChange).not.toHaveBeenCalled();
  });
});
