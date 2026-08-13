import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatComposer } from "../../../src/chat/components/ChatComposer/ChatComposer"
import type {
  TChatComposerCommand,
  TChatComposerMention,
  TChatComposerProps,
  TChatComposerSubmit,
} from "../../../src/chat/components/ChatComposer/interface"
import { createTestChatBrowser } from "../../test-setup"

type TRenderedComposer = {
  root: HTMLDivElement
  editor: HTMLElement
  setMentions: (mentions: TChatComposerMention[]) => void
  triggerResize: () => void
}

let disposeRendered: (() => void) | undefined
let container: HTMLDivElement | undefined

function ensureComposerDomMocks() {
  if (typeof PointerEvent === "undefined") {
    vi.stubGlobal("PointerEvent", MouseEvent)
  }

  if (typeof WheelEvent === "undefined") {
    vi.stubGlobal("WheelEvent", window.WheelEvent ?? MouseEvent)
  }

  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    })
  }

  if (typeof Range.prototype.getClientRects !== "function") {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => Object.assign([], { item: () => null }),
    })
  }
}

function renderComposer(overrides: Partial<TChatComposerProps> = {}): TRenderedComposer {
  ensureComposerDomMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  const [mentions, setMentions] = createSignal(overrides.mentions ?? [])
  let resizeCallback: ResizeObserverCallback | undefined
  const browser = {
    ...createTestChatBrowser(),
    createId: (() => {
      let id = 0
      return () => `test-id-${id += 1}`
    })(),
    createResizeObserver: (callback: ResizeObserverCallback) => {
      resizeCallback = callback
      return {
        observe: () => {},
        disconnect: () => {},
      }
    },
  }

  disposeRendered = render(() => (
    <div class="omnidraw-ai-chat-tab--chat">
      <ChatComposer
        browser={browser}
        mentions={mentions()}
        commands={overrides.commands}
        onDraftTextChange={overrides.onDraftTextChange}
        onSubmit={overrides.onSubmit}
      />
    </div>
  ), container)

  const root = container.querySelector<HTMLDivElement>(".omnidraw-ai-chat-tab--chat")
  const editor = container.querySelector<HTMLElement>(".omnidraw-ai-chat-composer__editor")
  if (!root || !editor) throw new Error("ChatComposer did not render")

  return {
    root,
    editor,
    setMentions,
    triggerResize: () => resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver),
  }
}

function setEditorText(editor: HTMLElement, text: string) {
  editor.focus()
  editor.innerHTML = `<p>${text}</p>`
  const textNode = editor.querySelector("p")?.firstChild
  if (!textNode) throw new Error("Editor text node was not created")

  const range = document.createRange()
  range.setStart(textNode, text.length)
  range.collapse(true)
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
  editor.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    data: text,
    inputType: "insertText",
  }))
}

function dispatchKey(editor: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  editor.dispatchEvent(event)
  return event
}

function constrainSuggestionMenu(root: HTMLElement, visibleRows: number) {
  const menu = root.querySelector<HTMLDivElement>("[role='listbox']")
  if (!menu) throw new Error("Suggestion menu was not rendered")
  const options = Array.from(menu.querySelectorAll<HTMLElement>("[role='option']"))
  const rowHeight = 34
  Object.defineProperties(menu, {
    clientHeight: { configurable: true, value: visibleRows * rowHeight },
    scrollHeight: { configurable: true, value: options.length * rowHeight },
  })
  options.forEach((option, index) => {
    Object.defineProperties(option, {
      offsetTop: { configurable: true, value: index * rowHeight },
      offsetHeight: { configurable: true, value: rowHeight },
    })
  })
  return { menu, options }
}

afterEach(() => {
  disposeRendered?.()
  disposeRendered = undefined
  container?.remove()
  container = undefined
  vi.unstubAllGlobals()
})

describe("ChatComposer long suggestion navigation", () => {
  it("keeps every mention reachable, announced, and visible without moving focus", async () => {
    const mentions = Array.from({ length: 10 }, (_, index) => ({
      id: `resource-${index + 1}`,
      label: `Resource ${index + 1}`,
      kind: "Database",
    }))
    const rendered = renderComposer({ mentions })
    setEditorText(rendered.editor, "@")

    await vi.waitFor(() => expect(rendered.root.querySelectorAll("[role='option']")).toHaveLength(10))
    const { menu, options } = constrainSuggestionMenu(rendered.root, 3)
    expect(rendered.editor.getAttribute("role")).toBe("combobox")
    expect(rendered.editor.getAttribute("aria-controls")).toBe(menu.id)
    expect(rendered.editor.getAttribute("aria-activedescendant")).toBe(options[0]?.id)

    for (let index = 0; index < 3; index += 1) {
      expect(dispatchKey(rendered.editor, "ArrowDown").defaultPrevented).toBe(true)
    }
    await vi.waitFor(() => expect(options[3]?.getAttribute("aria-selected")).toBe("true"))
    await vi.waitFor(() => expect(menu.scrollTop).toBe(34))
    expect(rendered.editor.getAttribute("aria-activedescendant")).toBe(options[3]?.id)

    dispatchKey(rendered.editor, "PageDown")
    await vi.waitFor(() => expect(options[6]?.getAttribute("aria-selected")).toBe("true"))
    await vi.waitFor(() => expect(menu.scrollTop).toBe(136))

    dispatchKey(rendered.editor, "End")
    await vi.waitFor(() => expect(options[9]?.getAttribute("aria-selected")).toBe("true"))
    await vi.waitFor(() => expect(menu.scrollTop).toBe(238))

    dispatchKey(rendered.editor, "Home")
    await vi.waitFor(() => expect(options[0]?.getAttribute("aria-selected")).toBe("true"))
    await vi.waitFor(() => expect(menu.scrollTop).toBe(0))

    dispatchKey(rendered.editor, "ArrowUp")
    await vi.waitFor(() => expect(options[9]?.getAttribute("aria-selected")).toBe("true"))
    await vi.waitFor(() => expect(menu.scrollTop).toBe(238))
    dispatchKey(rendered.editor, "ArrowDown")
    await vi.waitFor(() => expect(menu.scrollTop).toBe(0))

    const wheelReachedParent = vi.fn()
    rendered.root.addEventListener("wheel", wheelReachedParent)
    menu.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 34 }))
    expect(wheelReachedParent).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(rendered.editor)
  })

  it("resets filtering and clamps a replaced mention source before accepting with Enter", async () => {
    const mentions = Array.from({ length: 8 }, (_, index) => ({
      id: `resource-${index + 1}`,
      label: `Resource ${index + 1}`,
      kind: "Database",
    }))
    const rendered = renderComposer({ mentions })
    setEditorText(rendered.editor, "@")
    await vi.waitFor(() => expect(rendered.root.querySelectorAll("[role='option']")).toHaveLength(8))
    constrainSuggestionMenu(rendered.root, 2)
    dispatchKey(rendered.editor, "End")

    rendered.setMentions(mentions.slice(0, 2))
    await vi.waitFor(() => expect(rendered.root.querySelectorAll("[role='option']")).toHaveLength(2))
    let options = Array.from(rendered.root.querySelectorAll<HTMLElement>("[role='option']"))
    expect(options[1]?.getAttribute("aria-selected")).toBe("true")
    expect(rendered.editor.getAttribute("aria-activedescendant")).toBe(options[1]?.id)

    rendered.setMentions(mentions)
    setEditorText(rendered.editor, "@8")
    await vi.waitFor(() => expect(rendered.root.querySelectorAll("[role='option']")).toHaveLength(1))
    options = Array.from(rendered.root.querySelectorAll<HTMLElement>("[role='option']"))
    expect(options[0]?.textContent).toContain("Resource 8")
    expect(options[0]?.getAttribute("aria-selected")).toBe("true")

    dispatchKey(rendered.editor, "Enter")
    await vi.waitFor(() => expect(rendered.root.querySelector("[role='listbox']")).toBeNull())
    expect(rendered.editor.querySelector("[data-id='resource-8']")).not.toBeNull()
    expect(rendered.editor.getAttribute("aria-expanded")).toBe("false")
    expect(rendered.editor.hasAttribute("aria-controls")).toBe(false)
    expect(rendered.editor.hasAttribute("aria-activedescendant")).toBe(false)
    expect(document.activeElement).toBe(rendered.editor)
  })

  it("pages through long slash commands and accepts the announced command with Tab", async () => {
    const commands: TChatComposerCommand[] = Array.from({ length: 9 }, (_, index) => ({
      id: `command-${index + 1}`,
      label: `Command ${index + 1}`,
      description: `Run command ${index + 1}`,
    }))
    const onSubmit = vi.fn<(value: TChatComposerSubmit) => void>()
    const onDraftTextChange = vi.fn<(text: string) => void>()
    const rendered = renderComposer({ commands, onDraftTextChange, onSubmit })
    setEditorText(rendered.editor, "/")
    await vi.waitFor(() => expect(rendered.root.querySelectorAll("[role='option']")).toHaveLength(9))
    const { menu, options } = constrainSuggestionMenu(rendered.root, 2)

    dispatchKey(rendered.editor, "End")
    await vi.waitFor(() => expect(options[8]?.getAttribute("aria-selected")).toBe("true"))
    await vi.waitFor(() => expect(menu.scrollTop).toBe(238))
    dispatchKey(rendered.editor, "PageUp")
    await vi.waitFor(() => expect(options[6]?.getAttribute("aria-selected")).toBe("true"))
    await vi.waitFor(() => expect(menu.scrollTop).toBe(204))
    dispatchKey(rendered.editor, "End")
    await vi.waitFor(() => expect(rendered.editor.getAttribute("aria-activedescendant")).toBe(options[8]?.id))

    dispatchKey(rendered.editor, "Tab")
    await vi.waitFor(() => expect(rendered.root.querySelector("[role='listbox']")).toBeNull())
    setEditorText(rendered.editor, "execute")
    await vi.waitFor(() => expect(onDraftTextChange).toHaveBeenCalledWith("execute"))
    rendered.root.querySelector<HTMLButtonElement>("[aria-label='Send prompt']")?.click()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: "execute",
      command: commands[8],
    }))
    expect(document.activeElement).toBe(rendered.editor)
  })

  it("recomputes the menu height when its contained chat surface resizes", async () => {
    const rendered = renderComposer({
      mentions: [{ id: "resource-1", label: "Resource 1", kind: "Database" }],
    })
    setEditorText(rendered.editor, "@")
    await vi.waitFor(() => expect(rendered.root.querySelector("[role='listbox']")).not.toBeNull())
    const menu = rendered.root.querySelector<HTMLDivElement>("[role='listbox']")
    if (!menu) throw new Error("Suggestion menu was not rendered")
    rendered.root.getBoundingClientRect = () => ({ top: 200 } as DOMRect)
    menu.getBoundingClientRect = () => ({ bottom: 350 } as DOMRect)

    rendered.triggerResize()

    await vi.waitFor(() => expect(menu.style.maxBlockSize).toBe("142px"))
  })
})
