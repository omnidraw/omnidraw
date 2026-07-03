import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatTab } from "../../../../src/components/AiWizzard/tabs/ChatTab"

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

function renderChatTab() {
  ensureComponentDomMocks()

  container = document.createElement("div")
  document.body.appendChild(container)
  disposeRendered = render(() => ChatTab({
    isCanceling: false,
    isRunning: false,
    messageHistory: MOCK_MESSAGE_HISTORY,
    onCancel: () => {},
    onNewChat: () => {},
    onPrompt: async () => {},
    settings: { models: [] },
  }), container)

  return container
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

    expect(root.querySelectorAll(".ai-chat-history__message")).toHaveLength(4)
    expect(root.querySelectorAll(".ai-chat-history__image")).toHaveLength(2)
    expect(root.querySelectorAll(".ai-chat-history__markdown table")).toHaveLength(2)
    expect(root.querySelectorAll(".ai-chat-history__message--assistant .ai-chat-history__role")).toHaveLength(0)
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
})
