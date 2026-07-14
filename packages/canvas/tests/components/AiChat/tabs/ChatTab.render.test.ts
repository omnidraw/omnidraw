import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatTab } from "../../../../src/components/AiChat/tabs/ChatTab"
import type { TChatComposerModel, TChatComposerThinkingLevel } from "../../../../src/components/AiChat/ChatComposer/interface"

const AI_CHAT_CSS_PATH = resolve(process.cwd(), "src/components/AiChat/index.css")

type TRenderChatTabSettings = {
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: TChatComposerThinkingLevel
  models: TChatComposerModel[]
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

function renderChatTab(settings: TRenderChatTabSettings = {
  defaultThinkingLevel: "low" as const,
  models: [
    { id: "gpt-test", input: ["text" as const], provider: "openai-codex", name: "GPT Test" },
  ],
}, messageHistory: readonly unknown[] = MOCK_MESSAGE_HISTORY, onInspectActor = () => {}, onPreferenceChange = () => {}, onApproveDbChange: (proposalId: string) => Promise<any> = async () => { throw new Error("not configured") }, onRejectDbChange: (proposalId: string) => Promise<any> = async () => { throw new Error("not configured") }, onClearResourceBindings: () => Promise<void> = async () => {}, onOpenPreview = () => {}) {
  ensureComponentDomMocks()

  container = document.createElement("div")
  document.body.appendChild(container)
  disposeRendered = render(() => ChatTab({
    isCanceling: false,
    isRunning: false,
    messageHistory,
    onCancel: () => {},
    onNewChat: () => {},
    onEditExistingWidget: () => {},
    onClearResourceBindings,
    onPrompt: async () => {},
    onPreferenceChange,
    onInspectActor,
    onOpenPreview,
    onApproveDbChange,
    onRejectDbChange,
    settings,
    mentions: [{ id: "db-1", label: "db", kind: "Database" }],
  }), container)

  return container
}

function readAiChatComposerEditorCssRule() {
  const css = readFileSync(AI_CHAT_CSS_PATH, "utf8")
  return css.match(/\.ai-chat-composer__editor\s*\{[^}]*\}/)?.[0] ?? ""
}

afterEach(() => {
  disposeRendered?.()
  disposeRendered = undefined
  container?.remove()
  container = undefined
})

describe("ChatTab rendered message history", () => {
  it("renders structured text, images, markdown, tables, and links without JSON payloads", () => {
    const root = renderChatTab()
    const text = root.textContent ?? ""

    expect(root.querySelectorAll(".ai-chat-history__message")).toHaveLength(5)
    expect(root.querySelectorAll(".ai-chat-history__image")).toHaveLength(2)
    expect(root.querySelectorAll(".ai-chat-history__markdown table")).toHaveLength(2)
    expect(root.querySelectorAll(".ai-chat-history__message--assistant .ai-chat-history__role")).toHaveLength(0)
    expect(root.querySelector(".ai-chat-history__message--other .ai-chat-history__role")?.textContent).toBe("toolResult - bash")
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

  it("collapses tool results by default and toggles expanded state on click", () => {
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
    const message = root.querySelector<HTMLElement>(".ai-chat-history__message--tool-result")

    expect(message).not.toBeNull()
    expect(message?.getAttribute("aria-expanded")).toBe("false")
    expect(message?.textContent).toContain("line 1")
    expect(message?.textContent).toContain("line 5")
    expect(message?.textContent).toContain("...")
    expect(message?.textContent).not.toContain("line 6")

    message?.click()

    expect(message?.getAttribute("aria-expanded")).toBe("true")
    expect(message?.textContent).toContain("line 6")
    expect(message?.textContent).toContain("line 7")
    expect(message?.textContent).not.toContain("...")

    message?.click()

    expect(message?.getAttribute("aria-expanded")).toBe("false")
    expect(message?.textContent).toContain("...")
    expect(message?.textContent).not.toContain("line 6")
  })

  it("requires a prominent risk checkbox before approving exact database SQL", async () => {
    const proposal = {
      id: "proposal-1",
      resourceId: "db-1",
      resourceName: "Notes Database",
      sql: "ALTER TABLE notes ADD COLUMN title TEXT;",
      reason: "Store note titles.",
      status: "pending" as const,
    }
    const onApprove = vi.fn(async () => ({ ...proposal, status: "approved" as const }))
    const root = renderChatTab(undefined, [{
      role: "toolResult",
      toolCallId: "call-db",
      toolName: "vc_propose_db_change",
      content: [{ type: "text", text: "No SQL was executed." }],
      details: { kind: "db-change-proposal", proposal },
    }], () => {}, () => {}, onApprove)
    const checkbox = root.querySelector<HTMLInputElement>(".ai-chat-db-proposal__risk input")
    const approve = Array.from(root.querySelectorAll<HTMLButtonElement>(".ai-chat-db-proposal__actions button"))
      .find((button) => button.textContent === "Approve database change")

    expect(root.textContent).toContain(proposal.sql)
    expect(checkbox).not.toBeNull()
    expect(approve?.disabled).toBe(true)
    checkbox?.click()
    expect(approve?.disabled).toBe(false)
    approve?.click()
    await vi.waitFor(() => expect(onApprove).toHaveBeenCalledWith("proposal-1"))
    expect(root.textContent).toContain("approved")
  })

  it("forwards vertical table wheel gestures to the chat scroller", () => {
    const root = renderChatTab()
    const scroller = root.querySelector<HTMLElement>(".ai-chat-content")
    const tableWrap = root.querySelector<HTMLElement>(".ai-chat-history__table-wrap")

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
    const scroller = root.querySelector<HTMLElement>(".ai-chat-content")
    const toolResult = root.querySelector<HTMLElement>(".ai-chat-history__message--tool-result")

    expect(scroller).not.toBeNull()
    expect(toolResult).not.toBeNull()

    const vertical = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 72 })
    const verticalResult = toolResult?.dispatchEvent(vertical)

    expect(verticalResult).toBe(false)
    expect(scroller?.scrollTop).toBe(72)
  })

  it("keeps mention suggestions dismissed until the trigger changes", async () => {
    const root = renderChatTab()
    const editor = root.querySelector<HTMLElement>(".ai-chat-composer__editor")
    const history = root.querySelector<HTMLElement>(".ai-chat-content")
    const controls = root.querySelector<HTMLElement>(".ai-chat-composer__controls")

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

    expect(root.querySelector("[role='listbox']")).toBeNull()

    setEditorText("@d")
    await vi.waitFor(() => expect(root.querySelector("[role='listbox']")).not.toBeNull())

    controls?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    controls?.click()

    await vi.waitFor(() => expect(root.querySelector("[role='listbox']")).toBeNull())
  })

  it("opens a thinking level menu before provider model options", () => {
    const root = renderChatTab()
    const modelButton = root.querySelector<HTMLButtonElement>(".ai-chat-composer__pill")

    expect(modelButton).not.toBeNull()
    expect(modelButton?.textContent).toContain("Low")

    modelButton?.click()

    const menuButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".ai-chat-composer__model-menu button"))
    const thinkingButton = menuButtons.find((button) => button.textContent === "Thinking")

    expect(thinkingButton).not.toBeUndefined()
    expect(menuButtons[0]?.textContent).toBe("Thinking")

    thinkingButton?.click()

    const menuText = root.querySelector(".ai-chat-composer__model-menu")?.textContent ?? ""
    expect(menuText).toContain("Off")
    expect(menuText).toContain("Minimal")
    expect(menuText).toContain("Xhigh")
  })

  it("renders a capped scroll container for long composer input", () => {
    const root = renderChatTab()
    const editor = root.querySelector(".ai-chat-composer__editor")
    const editorRule = readAiChatComposerEditorCssRule()

    expect(editor).not.toBeNull()
    expect(editorRule).toContain("max-height:")
    expect(editorRule).toContain("overflow-y: auto")
    expect(editorRule).toContain("overflow-x: hidden")
    expect(editorRule).toContain("overflow-wrap: anywhere")
  })

  it("exposes an explicit action that clears persistent draft resource bindings", () => {
    const onClearResourceBindings = vi.fn(async () => {})
    const root = renderChatTab(
      undefined,
      MOCK_MESSAGE_HISTORY,
      () => {},
      () => {},
      async () => { throw new Error("not configured") },
      async () => { throw new Error("not configured") },
      onClearResourceBindings,
    )

    root.querySelector<HTMLButtonElement>("[aria-label='Chat actions']")?.click()
    Array.from(root.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent?.trim() === "Clear resource context")
      ?.click()

    expect(onClearResourceBindings).toHaveBeenCalledTimes(1)
  })

  it("forwards selected model changes as chat preference changes", () => {
    const onPreferenceChange = vi.fn()
    const root = renderChatTab({
      defaultModel: "gpt-test",
      defaultProvider: "openai-codex",
      defaultThinkingLevel: "low" as const,
      models: [
        { id: "gpt-test", input: ["text" as const], provider: "openai-codex", name: "GPT Test" },
        { id: "gpt-next", input: ["text" as const], provider: "openai-codex", name: "GPT Next" },
      ],
    }, MOCK_MESSAGE_HISTORY, () => {}, onPreferenceChange)

    root.querySelector<HTMLButtonElement>(".ai-chat-composer__pill")?.click()
    Array.from(root.querySelectorAll<HTMLButtonElement>(".ai-chat-composer__model-option"))
      .find((button) => button.textContent?.includes("GPT Next"))
      ?.click()

    expect(onPreferenceChange).toHaveBeenCalledWith({
      model: {
        provider: "openai-codex",
        modelId: "gpt-next",
      },
    })
  })

  it("forwards selected thinking level changes as chat preference changes", () => {
    const onPreferenceChange = vi.fn()
    const root = renderChatTab(undefined, MOCK_MESSAGE_HISTORY, () => {}, onPreferenceChange)

    root.querySelector<HTMLButtonElement>(".ai-chat-composer__pill")?.click()
    Array.from(root.querySelectorAll<HTMLButtonElement>(".ai-chat-composer__model-provider"))
      .find((button) => button.textContent === "Thinking")
      ?.click()
    Array.from(root.querySelectorAll<HTMLButtonElement>(".ai-chat-composer__model-option"))
      .find((button) => button.textContent === "High")
      ?.click()

    expect(onPreferenceChange).toHaveBeenCalledWith({ thinkingLevel: "high" })
  })

  it("shows Review design for successful vc_set_actor_candidate tool results", () => {
    const onInspectActor = vi.fn()

    const successfulActorToolResult = {
      role: "toolResult",
      toolCallId: "call-ok",
      toolName: "vc_set_actor_candidate",
      content: [
        { type: "text", text: "Actor candidate saved as revision 1." },
      ],
    }

    const root = renderChatTab(undefined, [successfulActorToolResult], onInspectActor)
    const buttons = Array.from(root.querySelectorAll("button")).filter((button) => button.textContent === "Review design")

    expect(buttons).toHaveLength(1)
  })

  it("does not show Review design for failed vc_set_actor_candidate tool results", () => {
    const onInspectActor = vi.fn()

    const failedActorToolResult = {
      role: "toolResult",
      toolCallId: "call-fail",
      toolName: "vc_set_actor_candidate",
      content: [
        { type: "text", text: "Actor candidate is invalid." },
      ],
    }

    const root = renderChatTab(undefined, [failedActorToolResult], onInspectActor)
    const buttons = Array.from(root.querySelectorAll("button")).filter((button) => button.textContent === "Review design")

    expect(buttons).toHaveLength(0)
  })

  it("opens preview from a successful validation tool result", () => {
    const onOpenPreview = vi.fn()
    const validationResult = {
      role: "toolResult",
      toolCallId: "call-preview",
      toolName: "vc_validate_widget_files",
      content: [{ type: "text", text: "Widget files are valid." }],
      details: { ok: true },
    }
    const root = renderChatTab(
      undefined,
      [validationResult],
      () => {},
      () => {},
      async () => { throw new Error("not configured") },
      async () => { throw new Error("not configured") },
      async () => {},
      onOpenPreview,
    )

    Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Open preview")
      ?.click()

    expect(onOpenPreview).toHaveBeenCalledTimes(1)
  })

  it("does not open preview from a failed validation result", () => {
    const onOpenPreview = vi.fn()
    const validationResult = {
      role: "toolResult",
      toolCallId: "call-preview-failed",
      toolName: "vc_validate_widget_files",
      content: [{ type: "text", text: "Widget draft files are invalid." }],
      details: { ok: false, errors: ["widget/main.ts is missing"] },
    }
    const root = renderChatTab(
      undefined,
      [validationResult],
      () => {},
      () => {},
      async () => { throw new Error("not configured") },
      async () => { throw new Error("not configured") },
      async () => {},
      onOpenPreview,
    )

    expect(Array.from(root.querySelectorAll("button")).some((button) => button.textContent === "Open preview")).toBe(false)
    expect(onOpenPreview).not.toHaveBeenCalled()
  })
})
