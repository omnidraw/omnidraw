import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AiChat } from "../../src/chat/components"
import { createTestApplication, createTestChatBrowser } from "../test-setup"

let disposeRendered: (() => void) | undefined
let container: HTMLDivElement | undefined

type TAiChatProps = Parameters<typeof AiChat>[0]
type TTestAiChatProps = Omit<TAiChatProps, "application" | "browser"> & Partial<Pick<TAiChatProps, "application" | "browser">>

function renderAiChat(props: TTestAiChatProps) {
  const { application = createTestApplication(), browser = createTestChatBrowser(), ...rest } = props
  return AiChat({ ...rest, application, browser })
}

function ensureComponentDomMocks() {
  if (typeof ResizeObserver === "undefined") {
    class MockResizeObserver {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver)
  }

  if (typeof PointerEvent === "undefined") {
    vi.stubGlobal("PointerEvent", MouseEvent)
  }

  if (typeof Range !== "undefined" && typeof Range.prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    })
  }

  if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => {
        const rects = [] as unknown as DOMRectList
        rects.item = () => null
        return rects
      },
    })
  }
}

function createApiService() {
  return {
    api: {
      actors: {
        resources: {
          list: async () => [undefined, []],
        },
        definitions: {
          list: async () => [undefined, []],
        },
      },
      agent: {
        approval: {
          list: async () => [undefined, []],
          resolve: async () => [undefined, { resolved: true }],
        },
        settings: {
          get: async () => [undefined, {
            defaultThinkingLevel: "minimal",
            models: [],
            providers: [],
            providersWithCredentials: ["test-provider"],
          }],
        },
        chat: {
          connect: async () => [undefined, {
            actorCandidate: null,
            editSession: null,
            messageHistory: [],
            vcJson: null,
          }],
          newSession: async () => [undefined, { started: true }],
          resourceBindings: {
            clear: async () => [undefined, { cleared: true }],
          },
        },
        widgetDraft: {
          list: async () => [undefined, []],
          validate: async () => [undefined, null],
        },
        widgetPublish: {
          publish: async () => [undefined, { published: false, message: "not configured" }],
        },
        events: async () => [undefined, {
          async *[Symbol.asyncIterator]() {},
        }],
      },
    },
  }
}

afterEach(() => {
  disposeRendered?.()
  disposeRendered = undefined
  container?.remove()
  container = undefined
  vi.unstubAllGlobals()
})

describe("AiChat shell", () => {
  it("uses an explicit replacement connect only after settings credentials change", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    const apiService = createApiService() as any
    const connect = vi.fn(async () => [undefined, {
      actorCandidate: null,
      editSession: null,
      messageHistory: [],
      vcJson: null,
    }])
    apiService.api.agent.chat.connect = connect
    apiService.api.agent.settings.get = async () => [undefined, {
      defaultThinkingLevel: "minimal",
      models: [],
      providers: ["test-provider"],
      providersWithCredentials: ["test-provider"],
    }]
    apiService.api.agent.auth = {
      apiKey: {
        set: vi.fn(async () => [undefined, { providerId: "test-provider" }]),
        remove: vi.fn(async () => [undefined, { providerId: "test-provider" }]),
      },
    }
    let settingsAction: (() => void) | undefined

    disposeRendered = render(() => renderAiChat({
      apiService: apiService as never,
      id: "surface-1",
      titleBar: {
        onAction: (id, handler) => {
          if (id === "settings") settingsAction = handler
          return () => {}
        },
        setActionState: () => {},
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
    }), container)

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(settingsAction).toBeTypeOf("function"))
    await vi.waitFor(() => expect(container?.querySelector(".ai-chat-tab--chat")).not.toBeNull())
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ mode: "reuse" })
    settingsAction?.()
    await vi.waitFor(() => expect(container?.querySelector(".ai-chat-tab--settings")).not.toBeNull())
    Array.from(container.querySelectorAll<HTMLButtonElement>(".ai-chat-provider-card--api-key button"))
      .find((button) => button.textContent === "Update key")
      ?.click()
    const input = container.querySelector<HTMLInputElement>(".ai-chat-api-key-input")
    if (!input) throw new Error("API key input was not rendered")
    input.value = "replacement-key"
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "replacement-key", inputType: "insertText" }))
    Array.from(container.querySelectorAll<HTMLButtonElement>(".ai-chat-provider-card--api-key button"))
      .find((button) => button.textContent === "Save new key")
      ?.click()

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    expect(connect.mock.calls[1]?.[0]).toMatchObject({
      sessionId: "conversation-1",
      widgetId: "surface-1",
      mode: "replace",
    })
  })

  it("ignores a stale connect completion and refreshes approvals only for the latest exact request", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    const apiService = createApiService() as any
    let resolveFirstConnect: ((value: unknown) => void) | undefined
    const firstConnect = new Promise((resolve) => { resolveFirstConnect = resolve })
    const connect = vi.fn((input: { sessionId: string }) => input.sessionId === "conversation-1"
      ? firstConnect
      : Promise.resolve([undefined, {
        actorCandidate: null,
        editSession: null,
        messageHistory: [{ role: "assistant", content: [{ type: "text", text: "latest session" }] }],
        vcJson: null,
      }]))
    const listApprovals = vi.fn(async () => [undefined, []])
    apiService.api.agent.chat.connect = connect
    apiService.api.agent.approval.list = listApprovals

    disposeRendered = render(() => renderAiChat({
      apiService: apiService as never,
      id: "surface-1",
      titleBar: {
        onAction: () => () => {},
        setActionState: () => {},
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
    }), container)

    await vi.waitFor(() => expect(container?.querySelector(".ai-chat-tab--chat")).not.toBeNull())
    container.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")?.click()
    Array.from(container.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent?.trim() === "New chat")
      ?.click()

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(listApprovals).toHaveBeenCalledTimes(1))
    expect(connect.mock.calls[0]?.[0]).toMatchObject({ sessionId: "conversation-1", mode: "reuse" })
    expect(connect.mock.calls[1]?.[0]).toMatchObject({ sessionId: "conversation-2", mode: "reuse" })
    expect(listApprovals).toHaveBeenCalledWith({ widgetId: "surface-1", sessionId: "conversation-2" })

    resolveFirstConnect?.([undefined, {
      actorCandidate: null,
      editSession: null,
      messageHistory: [{ role: "assistant", content: [{ type: "text", text: "stale session" }] }],
      vcJson: null,
    }])
    await Promise.resolve()

    expect(listApprovals).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("latest session")
    expect(container.textContent).not.toContain("stale session")
  })

  it("suppresses a superseded approval-list failure", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    const apiService = createApiService() as any
    let resolveFirstApprovalList: ((value: unknown) => void) | undefined
    const firstApprovalList = new Promise((resolve) => { resolveFirstApprovalList = resolve })
    apiService.api.agent.chat.connect = async () => [undefined, {
      actorCandidate: null,
      editSession: null,
      messageHistory: [],
      vcJson: null,
    }]
    const listApprovals = vi.fn((input: { sessionId: string }) => input.sessionId === "conversation-1"
      ? firstApprovalList
      : Promise.resolve([undefined, []]))
    apiService.api.agent.approval.list = listApprovals

    disposeRendered = render(() => renderAiChat({
      apiService: apiService as never,
      id: "surface-1",
      titleBar: {
        onAction: () => () => {},
        setActionState: () => {},
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
    }), container)

    await vi.waitFor(() => expect(listApprovals).toHaveBeenCalledTimes(1))
    container.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")?.click()
    Array.from(container.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent?.trim() === "New chat")
      ?.click()
    await vi.waitFor(() => expect(listApprovals).toHaveBeenCalledTimes(2))

    resolveFirstApprovalList?.([{ message: "No connected agent session for stale scope" }, undefined])
    await Promise.resolve()
    expect(container.querySelector(".ai-chat-widget-error")).toBeNull()
  })

  it("surfaces an approval-list failure from the current connection", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    const apiService = createApiService() as any
    apiService.api.agent.approval.list = async () => [{ message: "Approval backend unavailable" }, undefined]

    disposeRendered = render(() => renderAiChat({
      apiService: apiService as never,
      id: "surface-1",
      titleBar: {
        onAction: () => () => {},
        setActionState: () => {},
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
    }), container)

    await vi.waitFor(() => expect(container?.textContent).toContain("Could not load approvals"))
    expect(container.textContent).toContain("Approval backend unavailable")
  })

  it("surfaces a connection failure and retries it from the widget", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    const apiService = createApiService() as any
    const connect = vi.fn()
      .mockResolvedValueOnce([{ message: "WebSocket handshake failed" }, undefined])
      .mockResolvedValueOnce([undefined, {
        actorCandidate: null,
        editSession: null,
        messageHistory: [],
        vcJson: null,
      }])
    apiService.api.agent.chat.connect = connect

    disposeRendered = render(() => renderAiChat({
      apiService: apiService as never,
      id: "surface-1",
      titleBar: {
        onAction: () => () => {},
        setActionState: () => {},
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
    }), container)

    await vi.waitFor(() => expect(container?.textContent).toContain("WebSocket handshake failed"))
    Array.from(container.querySelectorAll<HTMLButtonElement>(".ai-chat-widget-error button"))
      .find((button) => button.textContent === "Try again")
      ?.click()

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(container?.querySelector(".ai-chat-widget-error")).toBeNull())
  })

  it("closes the agent event stream when the chat is disposed", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    const apiService = createApiService() as any
    let resolveNext: ((result: IteratorResult<never>) => void) | undefined
    const returnEventStream = vi.fn(async () => {
      resolveNext?.({ done: true, value: undefined as never })
      return { done: true, value: undefined }
    })
    const eventIterator = {
      next: vi.fn(() => new Promise<IteratorResult<never>>((resolve) => { resolveNext = resolve })),
      return: returnEventStream,
    }
    apiService.api.agent.events = async () => [undefined, {
      [Symbol.asyncIterator]: () => eventIterator,
    }]

    disposeRendered = render(() => renderAiChat({
      apiService: apiService as never,
      id: "surface-1",
      titleBar: {
        onAction: () => () => {},
        setActionState: () => {},
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
    }), container)

    await vi.waitFor(() => expect(eventIterator.next).toHaveBeenCalledTimes(1))
    disposeRendered()
    disposeRendered = undefined

    await vi.waitFor(() => expect(returnEventStream).toHaveBeenCalledTimes(1))
  })

  it("uses the widget title action for Settings and restores the mounted chat", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    let settingsAction: (() => void) | undefined
    const setActionState = vi.fn()

    disposeRendered = render(() => renderAiChat({
      apiService: createApiService() as never,
      id: "surface-1",
      titleBar: {
        onAction: (id, handler) => {
          if (id === "settings") settingsAction = handler
          return () => {
            if (settingsAction === handler) settingsAction = undefined
          }
        },
        setActionState,
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
    }), container)

    await vi.waitFor(() => {
      expect(container?.querySelector(".ai-chat-tab--chat")).not.toBeNull()
    })

    expect(container.querySelector(".ai-chat-header")).toBeNull()
    expect(settingsAction).toBeTypeOf("function")
    const chatView = container.querySelector<HTMLElement>(".ai-chat-view:not(.ai-chat-view--settings)")
    expect(chatView?.hidden).toBe(false)
    expect(container.querySelector(".ai-chat-view--settings")).toBeNull()
    expect(container.querySelector("[role='tablist']")).toBeNull()
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(0)

    settingsAction?.()

    const settingsView = container.querySelector<HTMLElement>(".ai-chat-view--settings")
    expect(chatView?.hidden).toBe(true)
    expect(settingsView).not.toBeNull()
    expect(container.querySelector(".ai-chat-view:not(.ai-chat-view--settings)")).toBe(chatView)
    expect(setActionState).toHaveBeenLastCalledWith("settings", { pressed: true, label: "Back to chat" })

    settingsAction?.()

    expect(chatView?.hidden).toBe(false)
    expect(container.querySelector(".ai-chat-view--settings")).toBeNull()
    expect(container.querySelector(".ai-chat-view:not(.ai-chat-view--settings)")).toBe(chatView)
    expect(setActionState).toHaveBeenLastCalledWith("settings", { pressed: false, label: "Settings" })
    expect(container.textContent).not.toContain("AI Wizard")

    const firstChatTab = container.querySelector(".ai-chat-tab--chat")
    container.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")?.click()
    Array.from(container.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent?.trim() === "New chat")
      ?.click()

    await vi.waitFor(() => {
      expect(container?.querySelector(".ai-chat-tab--chat")).not.toBe(firstChatTab)
    })
  })

  it("refreshes resources after approval and exposes the created resource action", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    const apiService = createApiService() as any
    const listResources = vi.fn(async () => [undefined, [{
      id: "kv-1",
      kind: "kv",
      name: "Cache",
      status: "ready",
    }]]);
    apiService.api.actors.resources.list = listResources
    apiService.api.agent.approval.list = async () => [undefined, [{
      id: "approval-1",
      chatId: "conversation-1",
      toolCallId: "tool-call-1",
      kind: "resource-create",
      summary: "Create kv resource 'Cache'",
      risk: "medium",
      warnings: [],
      details: { kind: "kv", name: "Cache" },
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }]];
    apiService.api.agent.chat.connect = async () => [undefined, {
      actorCandidate: null,
      editSession: null,
      messageHistory: [{
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-call-1", name: "vc_resource_create", arguments: { kind: "kv", name: "Cache" } }],
      }],
      vcJson: null,
    }];
    const onResourceCatalogChanged = vi.fn()
    const onOpenResource = vi.fn()

    disposeRendered = render(() => renderAiChat({
      apiService: apiService as never,
      id: "surface-1",
      titleBar: {
        onAction: () => () => {},
        setActionState: () => {},
      },
      onResetSessionId: () => "conversation-2",
      sessionId: "conversation-1",
      application: {
        invalidateResourceCatalog: onResourceCatalogChanged,
        openResource: onOpenResource,
        logError: () => {},
      },
    }), container)

    await vi.waitFor(() => expect(container?.querySelector(".ai-chat-tool-call .ai-chat-approval")).not.toBeNull())
    Array.from(container.querySelectorAll<HTMLButtonElement>(".ai-chat-tool-call .ai-chat-approval__actions button"))
      .find((button) => button.textContent === "Approve")
      ?.click()

    await vi.waitFor(() => expect(onResourceCatalogChanged).toHaveBeenCalledTimes(1))
    expect(listResources).toHaveBeenCalledTimes(2)
    const openResource = Array.from(container.querySelectorAll<HTMLButtonElement>(".ai-chat-tool-call button"))
      .find((button) => button.textContent === "Open resource")
    expect(openResource).not.toBeUndefined()
    openResource?.click()
    expect(onOpenResource).toHaveBeenCalledWith("kv-1")
  })
})
