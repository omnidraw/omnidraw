import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render } from "@solidjs/web"
import { createSignal } from "solid-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatTab } from "../../../src/chat/components/tabs/ChatTab"
import type { TChatComposerModel, TChatComposerThinkingLevel } from "../../../src/chat/components/ChatComposer/interface"
import { createTestChatBrowser } from "../../test-setup"
import { AiChatEffectRuntime } from "../../../src/internal/stream-lifecycle"
import { settleSolidUpdate } from "../../settled"

const AI_CHAT_CSS_PATH = resolve(process.cwd(), "src/styles.css")
const SYNTHETIC_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg=="

type TRenderChatTabSettings = {
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: TChatComposerThinkingLevel
  models: TChatComposerModel[]
  providersWithCredentials: string[]
}

const MOCK_MESSAGE_HISTORY = [
  {
    role: "user",
    content: [
      { type: "text", text: "Create a compact launch dashboard. Include the current risks and use the attached image as the visual reference." },
      {
        type: "image_url",
        image_url: {
          url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='420' viewBox='0 0 720 420'%3E%3Crect width='720' height='420' fill='%23f8efe7'/%3E%3Crect x='54' y='54' width='612' height='312' fill='%23ffffff' stroke='%23111' stroke-width='6'/%3E%3Cpath d='M92 274 L210 185 L314 229 L456 118 L610 173' fill='none' stroke='%23ff7a2f' stroke-width='14' stroke-linejoin='round' stroke-linecap='round'/%3E%3Ccircle cx='210' cy='185' r='18' fill='%23111'/%3E%3Ccircle cx='456' cy='118' r='18' fill='%23111'/%3E%3Ctext x='92' y='116' font-family='ui-monospace,Menlo,monospace' font-size='38' fill='%23111'%3ELaunch Pulse%3C/text%3E%3Ctext x='92' y='334' font-family='ui-monospace,Menlo,monospace' font-size='24' fill='%23666'%3Ereference image%3C/text%3E%3C/svg%3E",
        },
        alt: "Launch dashboard reference",
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "```md\n# Launch Dashboard Draft\n\nThe attached reference suggests a high-contrast operational panel with one strong accent color.\n\n## Proposed Sections\n\n| Section | Purpose | Priority |\n| --- | --- | --- |\n| Launch pulse | Show current status and trend | High |\n| Risk register | Track blockers and owners | High |\n| Recent activity | Keep the team oriented | Medium |\n\n### Risk Notes\n\n- **API quota** needs a clear warning state.\n- **Asset review** should be visible before publish.\n- **Rollback plan** can live in a compact secondary row.\n\n> Keep the layout dense enough for repeat use, not a marketing hero.\n\n```ts\nconst status = \"ready-for-review\"\n```\n\n[Open design brief](https://example.com/design-brief)\n```",
      },
      {
        type: "image",
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23fffaf5'/%3E%3Crect x='32' y='32' width='576' height='296' fill='%23fff' stroke='%23111' stroke-width='5'/%3E%3Crect x='62' y='72' width='170' height='94' fill='%23ffefe3' stroke='%23111' stroke-width='3'/%3E%3Crect x='258' y='72' width='320' height='94' fill='%23f4f6f8' stroke='%23111' stroke-width='3'/%3E%3Crect x='62' y='196' width='516' height='96' fill='%23ffffff' stroke='%23111' stroke-width='3'/%3E%3Ccircle cx='102' cy='119' r='22' fill='%23ff7a2f'/%3E%3Cpath d='M286 133 L346 105 L415 124 L486 88 L548 112' fill='none' stroke='%23ff7a2f' stroke-width='8' stroke-linecap='round'/%3E%3Ctext x='62' y='52' font-family='ui-monospace,Menlo,monospace' font-size='18' fill='%23111'%3EMock rendered image output%3C/text%3E%3Ctext x='92' y='248' font-family='ui-monospace,Menlo,monospace' font-size='24' fill='%23111'%3ERisk table + activity feed%3C/text%3E%3C/svg%3E",
        name: "Dashboard preview",
      },
    ],
  },
  {
    role: "user",
    content: [
      { type: "text", text: "Now make it calmer and show the data as a table first." },
    ],
  },
  {
    role: "toolResult",
    toolCallId: "call_123",
    toolName: "bash",
    content: [
      { type: "text", text: "validated files" },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "## Calmer Revision\n\n| Metric | Current | Target | Status |\n| --- | ---: | ---: | --- |\n| Signups | 1,248 | 1,500 | Behind |\n| Activation | 42% | 45% | Watch |\n| Errors | 0.7% | < 1% | Healthy |\n\nA quieter version should use smaller headings, fewer borders, and keep orange only for state changes.\n\n1. Put the table at the top.\n2. Move chart detail below it.\n3. Keep warnings short and actionable.",
      },
    ],
  },
] as const

let disposeRendered: (() => void) | undefined
let lifecycleRuntime: AiChatEffectRuntime | undefined
let container: HTMLDivElement | undefined

function createEmptyDomRect(): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function createEmptyDomRectList(): DOMRectList {
  const rects = [] as unknown as DOMRectList
  rects.item = () => null
  return rects
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

  if (typeof WheelEvent === "undefined") {
    vi.stubGlobal("WheelEvent", window.WheelEvent ?? MouseEvent)
  }

  if (typeof Range !== "undefined" && typeof Range.prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => createEmptyDomRect(),
    })
  }

  if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => createEmptyDomRectList(),
    })
  }
}

function pressKey(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

function renderChatTab(settings: TRenderChatTabSettings = {
  defaultThinkingLevel: "low" as const,
  providersWithCredentials: ["openai-codex"],
  models: [
    { id: "gpt-test", input: ["text" as const], provider: "openai-codex", name: "GPT Test" },
  ],
}, messageHistory: readonly unknown[] = MOCK_MESSAGE_HISTORY, overrides: Record<string, unknown> = {}) {
  ensureComponentDomMocks()

  container = document.createElement("div")
  document.body.appendChild(container)
  const historyItems = messageHistory.map((message, index) => ({
    entryId: `test-entry-${index}`,
    message: typeof message === "object" && message !== null
      ? { ...message, __omnidrawMessageFinished: true }
      : message,
  }))
  const chatTabProps = {
    browser: createTestChatBrowser(),
    lifecycle: lifecycleRuntime = new AiChatEffectRuntime(),
    onLogError: () => {},
    isCanceling: false,
    isRunning: false,
    messageHistory: historyItems,
    isEditingHistory: false,
    approvals: [],
    onCancel: () => {},
    onDismissError: () => {},
    onNewChat: () => {},
    onOpenSettings: () => {},
    onReportError: () => {},
    onRetryError: () => {},
    onPrompt: async () => {},
    onEditMessage: async () => true,
    onPreferenceChange: () => {},
    aiChatPreference: { approvalPolicy: { mode: "manual" } },
    onResolveApproval: async () => {},
    settings,
    mentions: [{ id: "db-1", label: "db", kind: "Database" }],
  }
  Object.defineProperties(chatTabProps, Object.getOwnPropertyDescriptors(overrides))
  disposeRendered = render(() => ChatTab(chatTabProps), container)

  return container
}

function readAiChatComposerEditorCssRule() {
  const css = readFileSync(AI_CHAT_CSS_PATH, "utf8")
  return css.match(/\.omnidraw-ai-chat-composer__editor\s*\{[^}]*\}/)?.[0] ?? ""
}

function readAiChatComposerSuggestionCssRule() {
  const css = readFileSync(AI_CHAT_CSS_PATH, "utf8")
  return css.match(/\.omnidraw-ai-chat-composer__suggestions button\s*\{[^}]*\}/)?.[0] ?? ""
}

afterEach(() => {
  disposeRendered?.()
  disposeRendered = undefined
  void lifecycleRuntime?.dispose()
  lifecycleRuntime = undefined
  container?.remove()
  container = undefined
})

describe("ChatTab rendered message history", () => {
  it("renders a validated tool PNG once with tool-specific accessible metadata", () => {
    const root = renderChatTab(undefined, [{
      role: "toolResult",
      toolCallId: "call_preview",
      toolName: "od_widget_preview_inspect",
      content: [
        { type: "text", text: "Synthetic image transport proof." },
        { type: "image", mimeType: "image/png", data: SYNTHETIC_PNG_BASE64 },
      ],
      details: { width: 2, height: 2 },
    }])

    const image = root.querySelector<HTMLImageElement>(".omnidraw-ai-chat-history__image")
    expect(image?.alt).toBe("Image result from od_widget_preview_inspect")
    expect(image?.getAttribute("width")).toBe("2")
    expect(image?.getAttribute("height")).toBe("2")
    expect(image?.dataset.byteSize).toBe("76")
    expect(image?.dataset.mimeType).toBe("image/png")
    expect(image?.src).toBe(`data:image/png;base64,${SYNTHETIC_PNG_BASE64}`)
    expect(root.textContent).toContain("Synthetic image transport proof.")
    expect(root.textContent).not.toContain(SYNTHETIC_PNG_BASE64)
  })

  it("renders partial assistant content followed by a durable Pi error without exposing diagnostics", () => {
    const onOpenSettings = vi.fn()
    const root = renderChatTab(undefined, [{
      role: "assistant",
      content: [{ type: "text", text: "I started the response." }],
      stopReason: "error",
      errorMessage: "No API key for provider: openai-codex",
      provider: "openai-codex",
      model: "gpt-test",
      diagnostics: [{
        type: "provider-error",
        error: { code: "AUTH_1", stack: "secret stack", message: "internal" },
        details: { token: "must-not-render" },
      }],
    }], { onOpenSettings })

    const errorCard = root.querySelector<HTMLElement>(".omnidraw-ai-chat-message-error")
    expect(root.textContent).toContain("I started the response.")
    expect(errorCard?.textContent).toContain("AI response failed")
    expect(errorCard?.textContent).toContain("No API key for provider: openai-codex")
    expect(errorCard?.textContent).toContain("openai-codex / gpt-test")
    expect(errorCard?.textContent).toContain("AUTH_1")
    expect(errorCard?.textContent).not.toContain("secret stack")
    expect(errorCard?.textContent).not.toContain("must-not-render")

    Array.from(errorCard?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Open settings")
      ?.click()
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it("does not present an aborted assistant turn as an error", () => {
    const root = renderChatTab(undefined, [{
      role: "assistant",
      content: [],
      stopReason: "aborted",
      errorMessage: "Canceled by user",
    }])

    expect(root.querySelector(".omnidraw-ai-chat-message-error")).toBeNull()
    expect(root.textContent).not.toContain("AI response failed")
  })

  it("does not render hidden custom context messages", () => {
    const root = renderChatTab(undefined, [{
      role: "custom",
      customType: "omnidraw.widgetMentions",
      display: false,
      content: "hidden widget identity",
    }])

    expect(root.textContent).not.toContain("hidden widget identity")
    expect(root.querySelectorAll(".omnidraw-ai-chat-history__message")).toHaveLength(0)
    expect(root.textContent).toContain("Ask about your canvas")
  })

  it("renders transient widget errors with retry and dismiss actions", () => {
    const onDismissError = vi.fn()
    const onRetryError = vi.fn()
    const root = renderChatTab(undefined, [], {
      widgetError: {
        kind: "connection",
        title: "Could not connect to AI chat",
        message: "WebSocket unavailable",
        isAuthenticationError: false,
      },
      onDismissError,
      onRetryError,
    })

    const banner = root.querySelector<HTMLElement>(".omnidraw-ai-chat-widget-error")
    expect(banner?.getAttribute("role")).toBe("alert")
    expect(banner?.textContent).toContain("WebSocket unavailable")
    Array.from(banner?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent === "Try again")
      ?.click()
    banner?.querySelector<HTMLButtonElement>("[aria-label='Dismiss error']")?.click()
    expect(onRetryError).toHaveBeenCalledTimes(1)
    expect(onDismissError).toHaveBeenCalledTimes(1)
  })

  it("renders structured text, images, markdown, tables, and links without JSON payloads", () => {
    const root = renderChatTab()
    const text = root.textContent ?? ""

    expect(root.querySelectorAll(".omnidraw-ai-chat-history__message")).toHaveLength(5)
    expect(root.querySelectorAll(".omnidraw-ai-chat-history__image")).toHaveLength(2)
    expect(root.querySelectorAll(".omnidraw-ai-chat-history__markdown table")).toHaveLength(2)
    expect(root.querySelectorAll(".omnidraw-ai-chat-history__message--assistant .omnidraw-ai-chat-history__role")).toHaveLength(0)
    expect(root.querySelector(".omnidraw-ai-chat-history__message--other .omnidraw-ai-chat-history__role")?.textContent).toBe("toolResult - bash")
    expect(root.querySelector("h1")?.textContent).toBe("Launch Dashboard Draft")
    expect(root.querySelector("h2")?.textContent).toBe("Proposed Sections")
    expect(root.querySelector("code")?.textContent).toContain("ready-for-review")
    expect(text).toContain("Create a compact launch dashboard")
    expect(text).toContain("Calmer Revision")
    expect(text).toContain("Signups")
    expect(text).not.toContain("\"type\"")
    expect(text).not.toContain("image_url")

    const link = root.querySelector<HTMLAnchorElement>("a[href='https://example.com/design-brief']")
    expect(link?.target).toBe("_blank")
    expect(link?.rel).toContain("noopener")
    expect(link?.rel).toContain("noreferrer")
  })

  it("collapses tool results by default and toggles expanded state on click", async () => {
    const root = renderChatTab(undefined, [
      {
        role: "toolResult",
        toolCallId: "call_web",
        toolName: "web_fetch",
        content: [
          { type: "text", text: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7" },
        ],
      },
    ])
    const message = root.querySelector<HTMLElement>(".omnidraw-ai-chat-history__message--tool-result")
    const toggle = () => root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-history__tool-result-toggle")

    expect(message).not.toBeNull()
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false")
    expect(message?.textContent).toContain("line 1")
    expect(message?.textContent).toContain("line 5")
    expect(message?.textContent).toContain("...")
    expect(message?.textContent).not.toContain("line 6")

    toggle()?.click()
    await settleSolidUpdate()

    expect(toggle()?.getAttribute("aria-expanded")).toBe("true")
    expect(message?.textContent).toContain("line 6")
    expect(message?.textContent).toContain("line 7")
    expect(message?.textContent).not.toContain("...")

    toggle()?.click()
    await settleSolidUpdate()

    expect(toggle()?.getAttribute("aria-expanded")).toBe("false")
    expect(message?.textContent).toContain("...")
    expect(message?.textContent).not.toContain("line 6")
  })

  it("keeps a tool-result screenshot visible when preceding text is collapsed", () => {
    const root = renderChatTab(undefined, [
      {
        role: "toolResult",
        toolCallId: "call_inspect",
        toolName: "od_widget_preview_inspect",
        content: [
          { type: "text", text: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7" },
          { type: "image", mimeType: "image/png", data: SYNTHETIC_PNG_BASE64 },
        ],
      },
    ])

    const message = root.querySelector<HTMLElement>(".omnidraw-ai-chat-history__message--tool-result")
    const image = message?.querySelector<HTMLImageElement>(".omnidraw-ai-chat-history__image")
    expect(message?.textContent).not.toContain("line 6")
    expect(image?.getAttribute("alt")).toBe("Image result from od_widget_preview_inspect")
    expect(image?.getAttribute("data-mime-type")).toBe("image/png")
  })

  it("copies image history as metadata without PNG bytes or data URLs", async () => {
    const writeClipboardText = vi.fn(async () => {})
    const root = renderChatTab(undefined, [{
      role: "toolResult",
      toolCallId: "call_inspect",
      toolName: "od_widget_preview_inspect",
      content: [
        { type: "text", text: "Preview complete." },
        { type: "image", mimeType: "image/png", data: SYNTHETIC_PNG_BASE64 },
      ],
    }], {
      browser: { ...createTestChatBrowser(), writeClipboardText },
    })

    root.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")?.click()
    await settleSolidUpdate()
    Array.from(root.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent?.trim() === "Copy chat")
      ?.click()

    expect(writeClipboardText).toHaveBeenCalledOnce()
    const markdown = writeClipboardText.mock.calls[0]?.[0] ?? ""
    expect(markdown).toContain("[Tool-result image: image/png, 2x2, 76 bytes]")
    expect(markdown).not.toContain(SYNTHETIC_PNG_BASE64)
    expect(markdown).not.toContain("data:image")
  })

  it("renders one inline action surface for a manual approval with a visible tool call", async () => {
    const onResolveApproval = vi.fn(async () => {})
    const root = renderChatTab(undefined, [{
      role: "assistant",
      content: [{ type: "toolCall", id: "tool-call-1", name: "od_resource_data_write", arguments: {} }],
    }], {
      approvals: [{
        id: "approval-1",
        chatId: "chat-1",
        toolCallId: "tool-call-1",
        kind: "resource-data-write",
        summary: "Write deployment configuration",
        risk: "high",
        warnings: ["This changes shared data."],
        details: { resource: "Production", value: "must-not-render", operation: "set" },
        createdAt: new Date(0).toISOString(),
        policyMode: "manual",
        status: "pending",
      }],
      onResolveApproval,
    })

    expect(root.textContent).toContain("Write deployment configuration")
    expect(root.querySelectorAll(".omnidraw-ai-chat-tool-call .omnidraw-ai-chat-approval")).toHaveLength(1)
    expect(root.querySelectorAll(".omnidraw-ai-chat-approvals--floating .omnidraw-ai-chat-approval")).toHaveLength(0)
    expect(root.querySelectorAll(".omnidraw-ai-chat-approval__actions")).toHaveLength(1)
    root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-tool-call .omnidraw-ai-chat-approval__details-toggle")?.click()
    await settleSolidUpdate()
    expect(root.textContent).toContain("[redacted]")
    expect(root.textContent).not.toContain("must-not-render")
    Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-approval__actions button"))
      .find((button) => button.textContent === "Approve")
      ?.click()
    await vi.waitFor(() => expect(onResolveApproval).toHaveBeenCalledWith("approval-1", "approve"))
  })

  it("uses the floating action surface only when a pending approval has no visible tool call", () => {
    const root = renderChatTab(undefined, [], {
      approvals: [{
        id: "approval-floating",
        chatId: "chat-1",
        toolCallId: "tool-call-not-visible",
        kind: "resource-delete",
        summary: "Delete archived cache",
        risk: "high",
        warnings: [],
        details: { resourceId: "cache-1" },
        createdAtSec: new Date(0).toISOString(),
        policyMode: "manual",
        status: "pending",
      }],
    })

    expect(root.querySelectorAll(".omnidraw-ai-chat-tool-call .omnidraw-ai-chat-approval")).toHaveLength(0)
    expect(root.querySelectorAll(".omnidraw-ai-chat-approvals--floating .omnidraw-ai-chat-approval")).toHaveLength(1)
    expect(root.querySelectorAll(".omnidraw-ai-chat-approval__actions")).toHaveLength(1)
  })

  it("opens the resource detail page from a resource tool result", () => {
    const onOpenResource = vi.fn()
    const root = renderChatTab(undefined, [{
      role: "toolResult",
      toolCallId: "call-create",
      toolName: "od_resource_create",
      content: [{ type: "text", text: "Created resource 'Cache'." }],
      details: { resource: { id: "kv-1", kind: "kv", name: "Cache" } },
      isError: false,
    }], { onOpenResource })

    const openButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__resource-action button"))
      .find((button) => button.textContent === "Open Cache")
    expect(openButton).not.toBeUndefined()
    openButton?.click()
    expect(onOpenResource).toHaveBeenCalledWith("kv-1")
  })

  it("does not render the removed widget draft strip", () => {
    const root = renderChatTab()
    expect(root.querySelector(".omnidraw-ai-chat-drafts")).toBeNull()
    expect(root.textContent).not.toContain("Widget drafts")
  })

  it("automatically opens a successful widget create result and keeps a focus action", async () => {
    const onOpenWidgetPreview = vi.fn()
    const root = renderChatTab(undefined, [{
      role: "toolResult",
      toolCallId: "call-widget-create",
      toolName: "od_widget_create",
      content: [{ type: "text", text: "Created and mounted runnable unpublished plain DOM widget draft 'Shared Timer'." }],
      details: {
        name: "Shared Timer",
        mountPath: "widgets/Shared Timer",
        source: "draft",
        draft: true,
        template: "plain",
        server: false,
        files: ["omnidraw.json", "ui/main.ts"],
      },
      isError: false,
    }], { onOpenWidgetPreview })

    const openButton = root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-history__preview-action button")
    expect(openButton).not.toBeUndefined()
    await vi.waitFor(() => expect(onOpenWidgetPreview).toHaveBeenCalledWith({ name: "Shared Timer" }))
  })

  it("automatically opens a successful widget validate result but not failures or prose", async () => {
    const onOpenWidgetPreview = vi.fn()
    const root = renderChatTab(undefined, [
      {
        role: "toolResult",
        toolCallId: "call-widget-validate",
        toolName: "od_widget_validate",
        content: [{ type: "text", text: "Widget 'Shared Timer' construction is valid and the Preview build passed." }],
        details: {
          name: "Shared Timer",
          mountPath: "widgets/Shared Timer",
          source: "draft",
          ok: true,
          draft: true,
          previewExecution: "passed",
        },
        isError: false,
      },
      {
        role: "toolResult",
        toolCallId: "call-widget-validate-failed",
        toolName: "od_widget_validate",
        content: [{ type: "text", text: "Widget 'Shared Timer' Preview build failed." }],
        details: {
          name: "Shared Timer",
          source: "draft",
          ok: false,
          draft: true,
          previewExecution: "failed",
        },
        isError: true,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Your draft 'Shared Timer' is ready. Open Preview whenever you like." }],
      },
    ], { onOpenWidgetPreview })

    const buttons = root.querySelectorAll(".omnidraw-ai-chat-history__preview-action button")
    expect(buttons).toHaveLength(1)
    await vi.waitFor(() => expect(onOpenWidgetPreview).toHaveBeenCalledWith({ name: "Shared Timer" }))
  })

  it("opens one Preview per draft when create and validate both succeed", async () => {
    const onOpenWidgetPreview = vi.fn()
    renderChatTab(undefined, [
      {
        role: "toolResult",
        toolCallId: "call-widget-create",
        toolName: "od_widget_create",
        content: [{ type: "text", text: "Created widget draft 'Shared Timer'." }],
        details: {
          name: "Shared Timer",
          mountPath: "widgets/Shared Timer",
          source: "draft",
          draft: true,
          template: "plain",
          server: false,
          files: ["omnidraw.json", "ui/main.ts"],
        },
        isError: false,
      },
      {
        role: "toolResult",
        toolCallId: "call-widget-validate",
        toolName: "od_widget_validate",
        content: [{ type: "text", text: "Widget 'Shared Timer' construction is valid." }],
        details: {
          name: "Shared Timer",
          mountPath: "widgets/Shared Timer",
          source: "draft",
          ok: true,
          draft: true,
          previewExecution: "passed",
        },
        isError: false,
      },
    ], { onOpenWidgetPreview })

    await vi.waitFor(() => expect(onOpenWidgetPreview).toHaveBeenCalledWith({ name: "Shared Timer" }))
    expect(onOpenWidgetPreview).toHaveBeenCalledTimes(1)
  })

  it("forwards vertical table wheel gestures to the chat scroller", () => {
    const root = renderChatTab()
    const scroller = root.querySelector<HTMLElement>(".omnidraw-ai-chat-content")
    const tableWrap = root.querySelector<HTMLElement>(".omnidraw-ai-chat-history__table-wrap")

    expect(scroller).not.toBeNull()
    expect(tableWrap).not.toBeNull()

    const vertical = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 64 })
    const verticalResult = tableWrap?.dispatchEvent(vertical)

    expect(verticalResult).toBe(false)
    expect(scroller?.scrollTop).toBe(64)

    if (scroller) {
      scroller.scrollTop = 0
    }

    const horizontal = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 64, deltaY: 4 })
    const horizontalResult = tableWrap?.dispatchEvent(horizontal)

    expect(horizontalResult).toBe(true)
    expect(scroller?.scrollTop).toBe(0)
  })

  it("forwards vertical tool-result wheel gestures to the chat scroller", () => {
    const root = renderChatTab(undefined, [
      {
        role: "toolResult",
        toolCallId: "call_read",
        toolName: "read",
        content: [{ type: "text", text: "read result" }],
      },
    ])
    const scroller = root.querySelector<HTMLElement>(".omnidraw-ai-chat-content")
    const toolResult = root.querySelector<HTMLElement>(".omnidraw-ai-chat-history__message--tool-result")

    expect(scroller).not.toBeNull()
    expect(toolResult).not.toBeNull()

    const vertical = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 72 })
    const verticalResult = toolResult?.dispatchEvent(vertical)

    expect(verticalResult).toBe(false)
    expect(scroller?.scrollTop).toBe(72)
  })

  it("keeps mention suggestions dismissed until the trigger changes", async () => {
    const root = renderChatTab()
    const editor = root.querySelector<HTMLElement>(".omnidraw-ai-chat-composer__editor")
    const history = root.querySelector<HTMLElement>(".omnidraw-ai-chat-content")
    const controls = root.querySelector<HTMLElement>(".omnidraw-ai-chat-composer__controls")

    expect(editor).not.toBeNull()
    expect(history).not.toBeNull()
    expect(controls).not.toBeNull()

    const setEditorText = (textValue: string) => {
      if (!editor) return

      editor.innerHTML = `<p>${textValue}</p>`
      const text = editor.querySelector("p")?.firstChild
      if (text) {
        const range = document.createRange()
        range.setStart(text, textValue.length)
        range.collapse(true)
        document.getSelection()?.removeAllRanges()
        document.getSelection()?.addRange(range)
      }
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: textValue, inputType: "insertText" }))
    }

    editor?.focus()
    setEditorText("@")
    await vi.waitFor(() => expect(root.querySelector("[role='listbox']")).not.toBeNull())

    history?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await settleSolidUpdate()

    expect(root.querySelector("[role='listbox']")).toBeNull()

    setEditorText("@d")
    await vi.waitFor(() => expect(root.querySelector("[role='listbox']")).not.toBeNull())

    controls?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    controls?.click()

    await vi.waitFor(() => expect(root.querySelector("[role='listbox']")).toBeNull())
  })

  it("renders typed mention icons, preserves keyboard navigation, and submits widget identity", async () => {
    const onPrompt = vi.fn(async () => {})
    const root = renderChatTab(undefined, [], {
      onPrompt,
      mentions: [
        {
          id: "widget:draft:Weather",
          label: "Weather",
          kind: "Draft widget",
          target: { type: "widget", name: "Weather", source: "draft" },
          icon: { type: "widget", icon: { svgIcon: "<svg viewBox='0 0 10 10'><circle cx='5' cy='5' r='4'/></svg>" } },
        },
        {
          id: "resource:db-1",
          label: "Weather",
          kind: "Database resource",
          target: { type: "resource", resourceId: "db-1" },
          icon: { type: "resource", kind: "db" },
        },
      ],
    })
    const editor = root.querySelector<HTMLElement>(".omnidraw-ai-chat-composer__editor")
    expect(editor).not.toBeNull()
    editor?.focus()
    if (editor) {
      editor.innerHTML = "<p>@</p>"
      const text = editor.querySelector("p")?.firstChild
      if (text) {
        const range = document.createRange()
        range.setStart(text, 1)
        range.collapse(true)
        document.getSelection()?.removeAllRanges()
        document.getSelection()?.addRange(range)
      }
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: "@", inputType: "insertText" }))
    }

    await vi.waitFor(() => expect(root.querySelectorAll("[role='option']")).toHaveLength(2))
    const options = Array.from(root.querySelectorAll<HTMLButtonElement>("[role='option']"))
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "Weather, Draft widget",
      "Weather, Database resource",
    ])
    expect(options[0]?.querySelector(".omnidraw-ai-chat-composer__suggestion-icon svg")).not.toBeNull()
    expect(options[0]?.getAttribute("aria-selected")).toBe("true")

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    await settleSolidUpdate()
    expect(options[1]?.getAttribute("aria-selected")).toBe("true")
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
    await settleSolidUpdate()
    expect(options[0]?.getAttribute("aria-selected")).toBe("true")

    options[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    root.querySelector<HTMLButtonElement>("[aria-label='Send prompt']")?.click()
    await vi.waitFor(() => expect(onPrompt).toHaveBeenCalledOnce())
    expect(onPrompt).toHaveBeenCalledWith(expect.objectContaining({
      widgetRefs: [{ name: "Weather", source: "draft" }],
    }))
  })

  it("keeps suggestion rows on one compact line", () => {
    const rule = readAiChatComposerSuggestionCssRule()
    expect(rule).toContain("display: flex")
    expect(rule).toContain("align-items: center")
    expect(rule).toContain("white-space: nowrap")
  })

  it("opens and traverses the action menu from its trigger and restores trigger focus on Escape", async () => {
    const root = renderChatTab()
    await settleSolidUpdate()
    const trigger = root.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")!

    expect(pressKey(trigger, "ArrowDown").defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe("New chat"))
    pressKey(document.activeElement as HTMLElement, "ArrowDown")
    expect(document.activeElement?.textContent?.trim()).toBe("Copy chat")
    pressKey(document.activeElement as HTMLElement, "Home")
    expect(document.activeElement?.textContent?.trim()).toBe("New chat")
    pressKey(document.activeElement as HTMLElement, "End")
    expect(document.activeElement?.textContent?.trim()).toBe("Copy chat")
    pressKey(document.activeElement as HTMLElement, "Escape")
    await settleSolidUpdate()

    expect(root.querySelector(".omnidraw-ai-chat-composer__action-menu")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("moves real DOM focus through the model menu and restores its trigger on Escape", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const root = renderChatTab()
      await settleSolidUpdate()
      const trigger = root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")!

      expect(pressKey(trigger, "ArrowDown").defaultPrevented).toBe(true)
      await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe("Thinking"))
      expect((document.activeElement as HTMLElement).getAttribute("role")).toBe("menuitem")

      pressKey(document.activeElement as HTMLElement, "End")
      await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe("Openai Codex"))
      pressKey(document.activeElement as HTMLElement, "ArrowRight")
      await vi.waitFor(() => expect(document.activeElement?.textContent).toContain("GPT Test"))
      expect((document.activeElement as HTMLElement).getAttribute("role")).toBe("menuitemradio")

      pressKey(document.activeElement as HTMLElement, "Escape")
      await settleSolidUpdate()
      expect(root.querySelector(".omnidraw-ai-chat-composer__model-menu")).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(warn.mock.calls.flat().map(String).join("\n")).not.toContain("STRICT_READ_UNTRACKED")
    } finally {
      warn.mockRestore()
    }
  })

  it("closes each composer menu when pointer or focus leaves its own trigger-menu pair", async () => {
    const root = renderChatTab()
    await settleSolidUpdate()
    const editor = root.querySelector<HTMLElement>(".ProseMirror")!

    root.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")!.click()
    await settleSolidUpdate()
    expect(root.querySelector(".omnidraw-ai-chat-composer__action-menu")).not.toBeNull()
    editor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
    await settleSolidUpdate()
    expect(root.querySelector(".omnidraw-ai-chat-composer__action-menu")).toBeNull()

    root.querySelector<HTMLButtonElement>("[aria-label^='Protected operations approval mode']")!.click()
    await settleSolidUpdate()
    expect(root.querySelector(".omnidraw-ai-chat-composer__approval-menu")).not.toBeNull()
    editor.focus()
    await settleSolidUpdate()
    expect(root.querySelector(".omnidraw-ai-chat-composer__approval-menu")).toBeNull()

    root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")!.click()
    await settleSolidUpdate()
    expect(root.querySelector(".omnidraw-ai-chat-composer__model-menu")).not.toBeNull()
    root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__send")!.focus()
    await settleSolidUpdate()
    expect(root.querySelector(".omnidraw-ai-chat-composer__model-menu")).toBeNull()
  })

  it("uses an explicitly focused model category as the Enter activation identity", async () => {
    const root = renderChatTab({
      defaultModel: "gpt-test",
      defaultProvider: "openai-codex",
      defaultThinkingLevel: "low",
      providersWithCredentials: ["openai-codex", "anthropic"],
      models: [
        { id: "gpt-test", input: ["text"], provider: "openai-codex", name: "GPT Test" },
        { id: "claude-test", input: ["text"], provider: "anthropic", name: "Claude Test" },
      ],
    })
    await settleSolidUpdate()
    root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")!.click()
    await settleSolidUpdate()
    const anthropic = [...root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-composer__model-provider")]
      .find((button) => button.textContent?.trim() === "Anthropic")!

    anthropic.focus()
    await settleSolidUpdate()
    pressKey(anthropic, "Enter")
    await vi.waitFor(() => expect(document.activeElement?.textContent).toContain("Claude Test"))
    expect((document.activeElement as HTMLElement).getAttribute("role")).toBe("menuitemradio")
  })

  it("opens a thinking level menu before provider model options", async () => {
    const root = renderChatTab()
    const modelButton = root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")

    expect(modelButton).not.toBeNull()
    expect(modelButton?.textContent).toContain("Low")

    modelButton?.click()
    await settleSolidUpdate()

    const menuButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-composer__model-menu button"))
    const thinkingButton = menuButtons.find((button) => button.textContent === "Thinking")
    const optionGroup = root.querySelector<HTMLElement>(".omnidraw-ai-chat-composer__model-list")

    expect(thinkingButton).not.toBeUndefined()
    expect(menuButtons[0]?.textContent).toBe("Thinking")
    expect(optionGroup?.getAttribute("aria-label")).toBe("AI models")

    thinkingButton?.click()
    await settleSolidUpdate()

    expect(optionGroup?.getAttribute("aria-label")).toBe("Thinking levels")
    const menuText = root.querySelector(".omnidraw-ai-chat-composer__model-menu")?.textContent ?? ""
    expect(menuText).toContain("Off")
    expect(menuText).toContain("Minimal")
    expect(menuText).toContain("Xhigh")
  })

  it("opens the configured model provider when clicked before its selection effect settles", async () => {
    const [settings, setSettings] = createSignal<TRenderChatTabSettings>({
      defaultThinkingLevel: "minimal" as const,
      providersWithCredentials: [],
      models: [],
    })
    const overrides: Record<string, unknown> = {}
    Object.defineProperty(overrides, "settings", { enumerable: true, get: settings })
    const root = renderChatTab(undefined, [], overrides)
    await settleSolidUpdate()

    setSettings({
      defaultThinkingLevel: "minimal" as const,
      providersWithCredentials: ["browser-local"],
      models: [
        { id: "other-model", input: ["text" as const], provider: "other-provider", name: "Other Model" },
        { id: "browser-streaming", input: ["text" as const], provider: "browser-local", name: "Browser Streaming Model" },
      ],
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    const modelButton = root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")

    expect(modelButton?.disabled).toBe(false)
    modelButton?.click()
    await settleSolidUpdate()

    const modelOptions = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-composer__model-option"),
    )
    expect(modelOptions.map((option) => option.textContent?.trim())).toEqual(["Browser Streaming Model"])
  })

  it("portals the model menu above clipped Canvas widget chrome without losing interaction", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const root = renderChatTab()
    const canvasHost = document.createElement("div")
    const widgetShell = document.createElement("div")
    const portal = document.createElement("div")
    canvasHost.dataset.omnidrawThemeScope = ""
    widgetShell.dataset.vibecanvasWidgetShell = "widget-1"
    portal.dataset.vibecanvasPortalId = "omnidraw:widget:widget-1"
    widgetShell.append(portal)
    canvasHost.append(widgetShell)
    document.body.append(canvasHost)
    portal.append(root)
    vi.spyOn(canvasHost, "getBoundingClientRect").mockReturnValue({
      ...createEmptyDomRect(),
      bottom: 600,
      height: 600,
      right: 800,
      width: 800,
    })
    const trigger = root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")!
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      ...createEmptyDomRect(),
      bottom: 530,
      height: 30,
      left: 300,
      right: 430,
      top: 500,
      width: 130,
      x: 300,
      y: 500,
    })

    try {
      trigger.click()
      await settleSolidUpdate()
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

      const menu = canvasHost.querySelector<HTMLDivElement>(".omnidraw-ai-chat-composer__model-menu")
      expect(menu).not.toBeNull()
      expect(root.contains(menu)).toBe(false)
      expect(menu?.dataset.vibecanvasPortalId).toBe("omnidraw:widget:widget-1")
      expect(menu?.dataset.omnidrawAiChatMenuPositioned).toBe("true")
      expect(menu?.style.zIndex).toBe("2147483647")

      menu?.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__model-option")?.click()
      await settleSolidUpdate()
      expect(canvasHost.querySelector(".omnidraw-ai-chat-composer__model-menu")).toBeNull()
      expect(warn.mock.calls.flat().map(String).join("\n")).not.toContain("STRICT_READ_UNTRACKED")
    } finally {
      warn.mockRestore()
      canvasHost.remove()
    }
  })

  it("does not read the reactive browser port from the scroll effect apply phase", async () => {
    const requestAnimationFrame = vi.fn(() => 1)
    const [browser] = createSignal({
      ...createTestChatBrowser(),
      requestAnimationFrame,
      cancelAnimationFrame: vi.fn(),
    })
    const overrides: Record<string, unknown> = {}
    Object.defineProperty(overrides, "browser", { enumerable: true, get: browser })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    try {
      renderChatTab(undefined, [], overrides)
      await settleSolidUpdate()

      expect(requestAnimationFrame).toHaveBeenCalled()
      expect(warn.mock.calls.flat().map(String).join("\n")).not.toContain("[STRICT_READ_UNTRACKED]")
    } finally {
      warn.mockRestore()
    }
  })

  it("renders a capped scroll container for long composer input", () => {
    const root = renderChatTab()
    const editor = root.querySelector(".omnidraw-ai-chat-composer__editor")
    const editorRule = readAiChatComposerEditorCssRule()

    expect(editor).not.toBeNull()
    expect(editorRule).toContain("max-height:")
    expect(editorRule).toContain("overflow-y: auto")
    expect(editorRule).toContain("overflow-x: hidden")
    expect(editorRule).toContain("overflow-wrap: anywhere")
  })

  it("does not expose the removed persistent resource-context action", () => {
    const root = renderChatTab()
    root.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")?.click()

    expect(Array.from(root.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .some((button) => button.textContent?.trim() === "Clear resource context"))
      .toBe(false)
  })

  it("forwards selected model changes as chat preference changes", async () => {
    const onPreferenceChange = vi.fn()
    const root = renderChatTab({
      defaultModel: "gpt-test",
      defaultProvider: "openai-codex",
      defaultThinkingLevel: "low" as const,
      providersWithCredentials: ["openai-codex"],
      models: [
        { id: "gpt-test", input: ["text" as const], provider: "openai-codex", name: "GPT Test" },
        { id: "gpt-next", input: ["text" as const], provider: "openai-codex", name: "GPT Next" },
      ],
    }, MOCK_MESSAGE_HISTORY, { onPreferenceChange })

    root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")?.click()
    await settleSolidUpdate()
    Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-composer__model-option"))
      .find((button) => button.textContent?.includes("GPT Next"))
      ?.click()
    await settleSolidUpdate()

    expect(onPreferenceChange).toHaveBeenCalledWith({
      model: {
        provider: "openai-codex",
        modelId: "gpt-next",
      },
    })
  })

  it("forwards selected thinking level changes as chat preference changes", async () => {
    const onPreferenceChange = vi.fn()
    const root = renderChatTab(undefined, MOCK_MESSAGE_HISTORY, { onPreferenceChange })

    root.querySelector<HTMLButtonElement>(".omnidraw-ai-chat-composer__pill")?.click()
    await settleSolidUpdate()
    Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-composer__model-provider"))
      .find((button) => button.textContent === "Thinking")
      ?.click()
    await settleSolidUpdate()
    Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-composer__model-option"))
      .find((button) => button.textContent === "High")
      ?.click()
    await settleSolidUpdate()

    expect(onPreferenceChange).toHaveBeenCalledWith({ thinkingLevel: "high" })
  })

  it("edits one historical user box at a time and restores it on Escape", async () => {
    const root = renderChatTab()
    const editButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__edit-action"))
    expect(editButtons).toHaveLength(2)

    editButtons[0]?.click()
    await vi.waitFor(() => expect(root.querySelectorAll(".omnidraw-ai-chat-history__editor")).toHaveLength(1))
    expect(root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")?.value).toContain("Create a compact launch dashboard")

    editButtons[1]?.click()
    await settleSolidUpdate()
    expect(root.querySelectorAll(".omnidraw-ai-chat-history__editor")).toHaveLength(1)
    const editor = root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")
    expect(editor?.value).toContain("Now make it calmer")
    editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await vi.waitFor(() => expect(root.querySelector(".omnidraw-ai-chat-history__editor")).toBeNull())
    expect(root.textContent).toContain("Now make it calmer")
  })

  it("keeps Enter multiline and sends an inline edit with Cmd/Ctrl+Enter", async () => {
    const onEditMessage = vi.fn(async () => true)
    const root = renderChatTab(undefined, MOCK_MESSAGE_HISTORY, { onEditMessage })
    const editButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__edit-action"))
    editButtons[1]?.click()
    await settleSolidUpdate()
    const editor = root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")
    if (!editor) throw new Error("Inline editor did not open")
    editor.value = "line one\nline two"
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }))
    await settleSolidUpdate()
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(onEditMessage).not.toHaveBeenCalled()
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }))

    await vi.waitFor(() => expect(onEditMessage).toHaveBeenCalledWith({
      entryId: "test-entry-2",
      text: "line one\nline two",
      model: { provider: "openai-codex", modelId: "gpt-test" },
      thinkingLevel: "low",
    }))
    await vi.waitFor(() => expect(root.querySelector(".omnidraw-ai-chat-history__editor")).toBeNull())
  })

  it("preserves the caret position when editing text in the middle", async () => {
    const root = renderChatTab()
    const editButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__edit-action"))
    editButtons[1]?.click()
    await settleSolidUpdate()
    const editor = root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")
    if (!editor) throw new Error("Inline editor did not open")
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

    editor.value = "Now\n make it calmer"
    editor.setSelectionRange(4, 4)
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak" }))
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

    expect(editor.selectionStart).toBe(4)
    expect(editor.selectionEnd).toBe(4)
  })

  it("allows empty edits only when the historical message preserves an image", async () => {
    const root = renderChatTab()
    const editButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__edit-action"))
    editButtons[0]?.click()
    await settleSolidUpdate()
    const imageEditor = root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")
    if (!imageEditor) throw new Error("Image message editor did not open")
    imageEditor.value = ""
    imageEditor.dispatchEvent(new InputEvent("input", { bubbles: true }))
    await settleSolidUpdate()
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__editor-actions button"))
      .find((button) => button.textContent === "Send")?.disabled).toBe(false)

    Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__editor-actions button"))
      .find((button) => button.textContent === "Cancel")?.click()
    await settleSolidUpdate()
    editButtons[1]?.click()
    await settleSolidUpdate()
    const textEditor = root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")
    if (!textEditor) throw new Error("Text message editor did not open")
    textEditor.value = ""
    textEditor.dispatchEvent(new InputEvent("input", { bubbles: true }))
    await settleSolidUpdate()
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__editor-actions button"))
      .find((button) => button.textContent === "Send")?.disabled).toBe(true)
  })

  it("keeps an open edit draft when another prompt starts or the edit is rejected", async () => {
    const [isRunning, setIsRunning] = createSignal(false)
    const onEditMessage = vi.fn(async () => false)
    const root = renderChatTab(undefined, MOCK_MESSAGE_HISTORY, {
      get isRunning() { return isRunning() },
      onEditMessage,
    })
    const editButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__edit-action"))
    editButtons[1]?.click()
    await settleSolidUpdate()
    const editor = root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")
    if (!editor) throw new Error("Inline editor did not open")
    editor.value = "keep this correction"
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }))
    await settleSolidUpdate()

    setIsRunning(true)
    const send = Array.from(root.querySelectorAll<HTMLButtonElement>(".omnidraw-ai-chat-history__editor-actions button"))
      .find((button) => button.textContent === "Send")
    await vi.waitFor(() => expect(send?.disabled).toBe(true))
    send?.click()
    expect(onEditMessage).not.toHaveBeenCalled()
    expect(editor.value).toBe("keep this correction")

    setIsRunning(false)
    await vi.waitFor(() => expect(send?.disabled).toBe(false))
    send?.click()
    await vi.waitFor(() => expect(onEditMessage).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(root.querySelector(".omnidraw-ai-chat-history__editor")).not.toBeNull())
    expect(root.querySelector<HTMLTextAreaElement>(".omnidraw-ai-chat-history__editor textarea")?.value).toBe("keep this correction")
  })

})
