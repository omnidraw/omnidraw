import type { EditorView } from "prosemirror-view"
import type {
  TChatComposerCommand,
  TChatComposerImage,
  TChatComposerMention,
  TChatComposerProps,
  TChatComposerSubmit,
  TPromptSuggestion,
} from "./interface"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import ArrowUp from "lucide-solid/icons/arrow-up"
import ChevronDown from "lucide-solid/icons/chevron-down"
import ImageIcon from "lucide-solid/icons/image"
import X from "lucide-solid/icons/x"
import Zap from "lucide-solid/icons/zap"
import { baseKeymap } from "prosemirror-commands"
import { history } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { Schema } from "prosemirror-model"
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state"
import { EditorView as ProseMirrorEditorView } from "prosemirror-view"
import { fnFindPromptTrigger } from "./fn.trigger"

const DEFAULT_MENTIONS: TChatComposerMention[] = [
  { id: "canvas", label: "Canvas selection", kind: "context" },
  { id: "style", label: "Style guide", kind: "context" },
  { id: "actor", label: "Active actor", kind: "actor" },
]

const DEFAULT_COMMANDS: TChatComposerCommand[] = [
  { id: "create-widget", label: "Create widget", description: "Draft a new canvas widget" },
  { id: "edit-selection", label: "Edit selection", description: "Change selected canvas items" },
  { id: "explain", label: "Explain", description: "Summarize the current design" },
]

const promptSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    hard_break: {
      group: "inline",
      inline: true,
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    mention: {
      attrs: {
        id: {},
        label: {},
        kind: {},
      },
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      toDOM: (node) => [
        "span",
        {
          class: "ai-chat-composer__mention",
          "data-id": node.attrs.id,
          "data-kind": node.attrs.kind,
        },
        `@${node.attrs.label}`,
      ],
      parseDOM: [
        {
          tag: "span[data-id][data-kind]",
          getAttrs: (dom) => {
            if (!(dom instanceof HTMLElement)) {
              return false
            }

            return {
              id: dom.getAttribute("data-id"),
              label: dom.textContent?.replace(/^@/, "") ?? "",
              kind: dom.getAttribute("data-kind"),
            }
          },
        },
      ],
    },
  },
})

const suggestionKey = new PluginKey<TPromptSuggestion | undefined>("ai-chat-composer-suggestion")

function createSuggestionPlugin(onSuggestionChange: (suggestion: TPromptSuggestion | undefined) => void) {
  return new Plugin<TPromptSuggestion | undefined>({
    key: suggestionKey,
    state: {
      init: () => undefined,
      apply: (_transaction, _previous, _oldState, newState) => {
        const selection = newState.selection

        if (!selection.empty) {
          return undefined
        }

        const textBeforeCursor = newState.doc.textBetween(0, selection.from, "\n", "\n")
        const trigger = fnFindPromptTrigger(textBeforeCursor)

        if (!trigger) {
          return undefined
        }

        return {
          kind: trigger.kind,
          from: selection.from - (trigger.to - trigger.from),
          to: selection.from,
          query: trigger.query,
        }
      },
    },
    view: () => ({
      update: (view) => onSuggestionChange(suggestionKey.getState(view.state)),
      destroy: () => onSuggestionChange(undefined),
    }),
  })
}

function createEmptyDoc() {
  return promptSchema.nodes.doc.create(null, [promptSchema.nodes.paragraph.create()])
}

function getEditorText(view: EditorView | undefined) {
  if (!view) {
    return ""
  }

  return view.state.doc.textBetween(0, view.state.doc.content.size, "\n", (node) => {
    if (node.type.name === "mention") {
      return `@${node.attrs.label}`
    }

    return ""
  }).trim()
}

function hasEditorContent(view: EditorView | undefined) {
  if (!view) {
    return false
  }

  let hasContent = false
  view.state.doc.descendants((node) => {
    if (node.isText && node.textContent.trim().length > 0) {
      hasContent = true
      return false
    }

    if (node.type.name === "mention") {
      hasContent = true
      return false
    }

    return true
  })

  return hasContent
}

function insertHardBreak(view: EditorView) {
  const { state } = view
  const hardBreak = promptSchema.nodes.hard_break.create()
  view.dispatch(state.tr.replaceSelectionWith(hardBreak).scrollIntoView())
}

function getImageFilesFromClipboard(data: DataTransfer | null) {
  if (!data) {
    return []
  }

  const directFiles = Array.from(data.files).filter((file) => file.type.startsWith("image/"))

  if (directFiles.length > 0) {
    return directFiles
  }

  return Array.from(data.items).flatMap((item) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      return []
    }

    const file = item.getAsFile()
    return file ? [file] : []
  })
}

function isKeyboardEvent(event: Event): event is KeyboardEvent {
  return "key" in event
}

export function ChatComposer(props: TChatComposerProps) {
  let editorRoot!: HTMLDivElement
  let imageInput!: HTMLInputElement
  let view: EditorView | undefined
  let cleanupDocumentKeydown: (() => void) | undefined
  const [suggestion, setSuggestion] = createSignal<TPromptSuggestion>()
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [mentions, setMentions] = createSignal<TChatComposerMention[]>([])
  const [command, setCommand] = createSignal<TChatComposerCommand>()
  const [images, setImages] = createSignal<TChatComposerImage[]>([])
  const [hasText, setHasText] = createSignal(false)
  const [hasFocus, setHasFocus] = createSignal(false)

  const availableMentions = () => props.mentions ?? DEFAULT_MENTIONS
  const availableCommands = () => props.commands ?? DEFAULT_COMMANDS
  const placeholder = () => props.placeholder ?? "Ask for follow-up changes"

  const suggestions = () => {
    const activeSuggestion = suggestion()

    if (!activeSuggestion) {
      return []
    }

    const query = activeSuggestion.query.toLocaleLowerCase()
    const source = activeSuggestion.kind === "mention" ? availableMentions() : availableCommands()

    return source.filter((item) => item.label.toLocaleLowerCase().includes(query)).slice(0, 6)
  }

  const syncHasText = () => setHasText(hasEditorContent(view))
  const shouldShowPlaceholder = () => !hasText() && !hasFocus() && !suggestion()

  const clearEditor = () => {
    if (!view) {
      return
    }

    const state = EditorState.create({
      doc: createEmptyDoc(),
      schema: promptSchema,
      plugins: view.state.plugins,
    })
    view.updateState(state)
    syncHasText()
  }

  const addImageFiles = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"))

    if (imageFiles.length === 0) {
      return false
    }

    setImages((current) => [
      ...current,
      ...imageFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])

    return true
  }

  const removeImage = (image: TChatComposerImage) => {
    URL.revokeObjectURL(image.previewUrl)
    setImages((current) => current.filter((item) => item.id !== image.id))
  }

  const acceptSuggestion = (index = activeIndex()) => {
    const activeSuggestion = suggestion()
    const item = suggestions()[index]

    if (!activeSuggestion || !item || !view) {
      return false
    }

    if (activeSuggestion.kind === "mention") {
      const mention = item as TChatComposerMention
      const node = promptSchema.nodes.mention.create(mention)
      const tr = view.state.tr.replaceWith(activeSuggestion.from, activeSuggestion.to, node).insertText(" ")
      tr.setSelection(TextSelection.near(tr.doc.resolve(activeSuggestion.from + node.nodeSize + 1)))

      view.dispatch(tr.scrollIntoView())
      setMentions((current) => current.some((existing) => existing.id === mention.id) ? current : [...current, mention])
    } else {
      const nextCommand = item as TChatComposerCommand
      view.dispatch(view.state.tr.delete(activeSuggestion.from, activeSuggestion.to).scrollIntoView())
      setCommand(nextCommand)
    }

    setSuggestion(undefined)
    setActiveIndex(0)
    view.focus()
    syncHasText()
    return true
  }

  const submit = () => {
    const text = getEditorText(view)
    const currentImages = images()

    if (text.length === 0 && currentImages.length === 0) {
      return
    }

    const value: TChatComposerSubmit = {
      text,
      mentions: mentions(),
      command: command(),
      images: currentImages,
    }

    props.onSubmit?.(value)
    setCommand(undefined)
    setMentions([])
    setImages([])
    currentImages.forEach((image) => URL.revokeObjectURL(image.previewUrl))
    clearEditor()
  }

  const moveSuggestion = (direction: 1 | -1) => {
    const count = suggestions().length

    if (count === 0) {
      return
    }

    setActiveIndex((current) => (current + direction + count) % count)
  }

  const handleSuggestionKey = (event: KeyboardEvent) => {
    if (!hasFocus() || !suggestion()) {
      return false
    }

    if (event.key === "Escape") {
      event.preventDefault()
      setSuggestion(undefined)
      setActiveIndex(0)
      return true
    }

    if (suggestions().length === 0) {
      return false
    }

    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveSuggestion(1)
      return true
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      moveSuggestion(-1)
      return true
    }

    return false
  }

  onMount(() => {
    const handleDocumentKeydown = (event: KeyboardEvent) => {
      if (!handleSuggestionKey(event)) {
        return
      }

      event.stopPropagation()
    }

    document.addEventListener("keydown", handleDocumentKeydown, true)
    cleanupDocumentKeydown = () => document.removeEventListener("keydown", handleDocumentKeydown, true)

    const state = EditorState.create({
      doc: createEmptyDoc(),
      schema: promptSchema,
      plugins: [
        history(),
        createSuggestionPlugin((nextSuggestion) => {
          setSuggestion((previousSuggestion) => {
            if (
              previousSuggestion?.kind !== nextSuggestion?.kind ||
              previousSuggestion?.from !== nextSuggestion?.from ||
              previousSuggestion?.to !== nextSuggestion?.to ||
              previousSuggestion?.query !== nextSuggestion?.query
            ) {
              setActiveIndex(0)
            }

            return nextSuggestion
          })
        }),
        keymap({
          "Mod-Enter": () => {
            submit()
            return true
          },
          "Shift-Enter": () => {
            if (!view) {
              return false
            }

            insertHardBreak(view)
            return true
          },
          Enter: () => {
            if (suggestion() && acceptSuggestion()) {
              return true
            }

            submit()
            return true
          },
          Tab: () => suggestion() ? acceptSuggestion() : false,
        }),
        keymap(baseKeymap),
      ],
    })

    view = new ProseMirrorEditorView(editorRoot, {
      state,
      dispatchTransaction: (transaction) => {
        if (!view) {
          return
        }

        view.updateState(view.state.apply(transaction))
        syncHasText()
      },
      handleDOMEvents: {
        keydown: (_editorView, event) => isKeyboardEvent(event) && handleSuggestionKey(event),
        focus: () => {
          setHasFocus(true)
          return false
        },
        blur: () => {
          setHasFocus(false)
          return false
        },
        paste: (_editorView, event) => {
          const files = getImageFilesFromClipboard(event.clipboardData)

          if (addImageFiles(files)) {
            event.preventDefault()
            return true
          }

          return false
        },
      },
      attributes: {
        "aria-label": placeholder(),
        class: "ai-chat-composer__editor",
      },
    })

    syncHasText()
  })

  onCleanup(() => {
    cleanupDocumentKeydown?.()
    view?.destroy()
    images().forEach((image) => URL.revokeObjectURL(image.previewUrl))
  })

  return (
    <section class="ai-chat-composer" aria-label="Chat prompt composer">
      <div class="ai-chat-composer__body" onClick={() => view?.focus()}>
        <Show when={shouldShowPlaceholder()}>
          <div class="ai-chat-composer__placeholder">{placeholder()}</div>
        </Show>
        <div ref={editorRoot} class="ai-chat-composer__editor-root" />

        <Show when={images().length > 0}>
          <div class="ai-chat-composer__attachments" aria-label="attached images">
            <For each={images()}>
              {(image) => (
                <div class="ai-chat-composer__attachment">
                  <img src={image.previewUrl} alt="" />
                  <span>{image.file.name}</span>
                  <button type="button" aria-label={`Remove ${image.file.name}`} onClick={() => removeImage(image)}>
                    <X size={14} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={suggestion() && suggestions().length > 0}>
          <div class="ai-chat-composer__suggestions" role="listbox">
            <For each={suggestions()}>
              {(item, index) => (
                <button
                  type="button"
                  classList={{ "ai-chat-composer__suggestion--active": index() === activeIndex() }}
                  data-active={index() === activeIndex() ? "true" : undefined}
                  role="option"
                  aria-selected={index() === activeIndex()}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    acceptSuggestion(index())
                  }}
                >
                  <span>{suggestion()?.kind === "mention" ? "@" : "/"}</span>
                  <strong>{item.label}</strong>
                  <small>{suggestion()?.kind === "mention" ? (item as TChatComposerMention).kind : (item as TChatComposerCommand).description}</small>
                </button>
              )}
            </For>
          </div>
        </Show>

        <input
          ref={imageInput}
          class="ai-chat-composer__file-input"
          type="file"
          accept="image/*"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            addImageFiles(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ""
          }}
        />

        <div class="ai-chat-composer__controls">
          <div class="ai-chat-composer__controls-right">
            <button class="ai-chat-composer__pill" type="button">
              <Zap size={18} />
              <span>5.5</span>
              <span>Medium</span>
              <ChevronDown size={18} />
            </button>
            <button class="ai-chat-composer__icon-button" type="button" aria-label="Attach image from file picker" onClick={() => imageInput.click()}>
              <ImageIcon size={20} />
            </button>
            <button class="ai-chat-composer__send" type="button" aria-label="Send prompt" onClick={submit}>
              <ArrowUp size={25} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
