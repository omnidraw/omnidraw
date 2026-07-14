import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AiChat } from "../../../src/components/AiChat"

let disposeRendered: (() => void) | undefined
let container: HTMLDivElement | undefined

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
  it("uses the widget title action for Settings and restores the mounted chat", async () => {
    ensureComponentDomMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    let settingsAction: (() => void) | undefined
    const setActionState = vi.fn()

    disposeRendered = render(() => AiChat({
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
    expect(setActionState).toHaveBeenLastCalledWith("settings", { pressed: true })

    settingsAction?.()

    expect(chatView?.hidden).toBe(false)
    expect(container.querySelector(".ai-chat-view--settings")).toBeNull()
    expect(container.querySelector(".ai-chat-view:not(.ai-chat-view--settings)")).toBe(chatView)
    expect(setActionState).toHaveBeenLastCalledWith("settings", { pressed: false })
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
})
