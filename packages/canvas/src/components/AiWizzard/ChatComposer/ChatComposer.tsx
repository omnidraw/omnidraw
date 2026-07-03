import type { EditorView } from "prosemirror-view"
import type {
  TChatComposerCommand,
  TChatComposerImage,
  TChatComposerMention,
  TChatComposerModel,
  TChatComposerProps,
  TChatComposerSubmit,
  TPromptSuggestion,
} from "./interface"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import ArrowUp from "lucide-solid/icons/arrow-up"
import ChevronDown from "lucide-solid/icons/chevron-down"
import FileText from "lucide-solid/icons/file-text"
import ImageIcon from "lucide-solid/icons/image"
import Square from "lucide-solid/icons/square"
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

const providerLabel = (provider: string) => provider
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ")

function formatThinkingLevel(level: string | undefined) {
  if (!level) {
    return "Medium"
  }

  return level.charAt(0).toUpperCase() + level.slice(1)
}

function getDefaultModel(models: TChatComposerModel[], defaultModel?: string, defaultProvider?: string) {
  const exactDefault = models.find((model) => model.id === defaultModel)

  if (exactDefault) {
    return exactDefault
  }

  return models.find((model) => model.provider === defaultProvider) ?? models[0]
}

export function ChatComposer(props: TChatComposerProps) {
  let root!: HTMLElement
  let editorRoot!: HTMLDivElement
  let imageInput!: HTMLInputElement
  let view: EditorView | undefined
  let cleanupDocumentKeydown: (() => void) | undefined
  let cleanupDocumentPointerdown: (() => void) | undefined
  const [suggestion, setSuggestion] = createSignal<TPromptSuggestion>()
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [mentions, setMentions] = createSignal<TChatComposerMention[]>([])
  const [command, setCommand] = createSignal<TChatComposerCommand>()
  const [images, setImages] = createSignal<TChatComposerImage[]>([])
  const [hasText, setHasText] = createSignal(false)
  const [hasFocus, setHasFocus] = createSignal(false)
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false)
  const [actionMenuOpen, setActionMenuOpen] = createSignal(false)
  const [selectedModelId, setSelectedModelId] = createSignal<string>()
  const [activeProvider, setActiveProvider] = createSignal<string>()
  const [focusedModelId, setFocusedModelId] = createSignal<string>()
  const [modelMenuColumn, setModelMenuColumn] = createSignal<"provider" | "model">("model")

  const availableMentions = () => props.mentions ?? DEFAULT_MENTIONS
  const availableCommands = () => props.commands ?? DEFAULT_COMMANDS
  const placeholder = () => props.placeholder ?? "Ask for follow-up changes"
  const models = createMemo(() => props.models ?? [])
  const providers = createMemo(() => Array.from(new Set(models().map((model) => model.provider))))
  const selectedModel = createMemo(() => models().find((model) => model.id === selectedModelId()))
  const activeProviderModels = createMemo(() => models().filter((model) => model.provider === activeProvider()))
  const imageInputEnabled = createMemo(() => selectedModel()?.input.includes("image") ?? false)
  const modelButtonLabel = createMemo(() => selectedModel()?.name.replace(/^GPT-/i, "") ?? "Select model")
  const focusedModel = createMemo(() => models().find((model) => model.id === focusedModelId()))

  const suggestions = () => {
    const activeSuggestion = suggestion()

    if (!activeSuggestion) {
      return []
    }

    const query = activeSuggestion.query.toLocaleLowerCase()
    const source = activeSuggestion.kind === "mention" ? availableMentions() : availableCommands()

    return source.filter((item) => item.label.toLocaleLowerCase().includes(query)).slice(0, 6)
  }

  createEffect(() => {
    const nextDefault = getDefaultModel(models(), props.defaultModel, props.defaultProvider)
    const current = selectedModelId()

    if (!nextDefault) {
      setSelectedModelId(undefined)
      setActiveProvider(undefined)
      return
    }

    if (!current || !models().some((model) => model.id === current)) {
      setSelectedModelId(nextDefault.id)
      setActiveProvider(nextDefault.provider)
    }
  })

  createEffect(() => {
    const provider = activeProvider()
    const allProviders = providers()

    if (!provider || !allProviders.includes(provider)) {
      setActiveProvider(selectedModel()?.provider ?? allProviders[0])
    }
  })

  createEffect(() => {
    if (imageInputEnabled()) {
      return
    }

    const currentImages = images()
    if (currentImages.length === 0) {
      return
    }

    currentImages.forEach((image) => URL.revokeObjectURL(image.previewUrl))
    setImages([])
  })

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
    if (!imageInputEnabled()) {
      return false
    }

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
    if (props.isRunning) {
      return
    }

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
      model: selectedModel(),
    }

    props.onSubmit?.(value)
    setCommand(undefined)
    setMentions([])
    setImages([])
    currentImages.forEach((image) => URL.revokeObjectURL(image.previewUrl))
    clearEditor()
  }

  const activatePrimaryAction = () => {
    if (props.isRunning) {
      props.onCancel?.()
      return
    }

    submit()
  }

  const moveSuggestion = (direction: 1 | -1) => {
    const count = suggestions().length

    if (count === 0) {
      return
    }

    setActiveIndex((current) => (current + direction + count) % count)
  }

  const openModelMenu = () => {
    const currentModel = selectedModel()
    setActiveProvider(currentModel?.provider ?? activeProvider() ?? providers()[0])
    setFocusedModelId(currentModel?.id ?? activeProviderModels()[0]?.id)
    setModelMenuColumn("model")
    setModelMenuOpen(true)
  }

  const moveActiveProvider = (direction: 1 | -1) => {
    const allProviders = providers()
    if (allProviders.length === 0) return

    const currentIndex = Math.max(0, allProviders.indexOf(activeProvider() ?? allProviders[0]))
    const nextProvider = allProviders[(currentIndex + direction + allProviders.length) % allProviders.length]
    setActiveProvider(nextProvider)
    setFocusedModelId(models().find((model) => model.provider === nextProvider)?.id)
  }

  const moveFocusedModel = (direction: 1 | -1) => {
    const currentModels = activeProviderModels()
    if (currentModels.length === 0) return

    const currentIndex = Math.max(0, currentModels.findIndex((model) => model.id === focusedModelId()))
    setFocusedModelId(currentModels[(currentIndex + direction + currentModels.length) % currentModels.length].id)
  }

  const selectFocusedModel = () => {
    const model = focusedModel() ?? activeProviderModels()[0]
    if (!model) return

    setSelectedModelId(model.id)
    setActiveProvider(model.provider)
    setFocusedModelId(model.id)
    setModelMenuOpen(false)
    view?.focus()
  }

  const handleModelMenuKey = (event: KeyboardEvent) => {
    if (!modelMenuOpen()) {
      if (actionMenuOpen() && event.key === "Escape") {
        setActionMenuOpen(false)
        return true
      }

      return false
    }

    if (event.key === "Escape") {
      setModelMenuOpen(false)
      setActionMenuOpen(false)
      return true
    }

    if (event.key === "ArrowLeft") {
      setModelMenuColumn("provider")
      return true
    }

    if (event.key === "ArrowRight") {
      setModelMenuColumn("model")
      setFocusedModelId(focusedModelId() ?? activeProviderModels()[0]?.id)
      return true
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const direction = event.key === "ArrowDown" ? 1 : -1
      if (modelMenuColumn() === "provider") moveActiveProvider(direction)
      else moveFocusedModel(direction)
      return true
    }

    if (event.key === "Enter") {
      if (modelMenuColumn() === "provider") {
        setModelMenuColumn("model")
        setFocusedModelId(focusedModelId() ?? activeProviderModels()[0]?.id)
      } else {
        selectFocusedModel()
      }
      return true
    }

    return false
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
      if (handleModelMenuKey(event)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (!handleSuggestionKey(event)) {
        return
      }

      event.stopPropagation()
    }

    const handleDocumentPointerdown = (event: PointerEvent) => {
      if (root?.contains(event.target as Node)) {
        return
      }

      setModelMenuOpen(false)
      setActionMenuOpen(false)
    }

    document.addEventListener("keydown", handleDocumentKeydown, true)
    document.addEventListener("pointerdown", handleDocumentPointerdown, true)
    cleanupDocumentKeydown = () => document.removeEventListener("keydown", handleDocumentKeydown, true)
    cleanupDocumentPointerdown = () => document.removeEventListener("pointerdown", handleDocumentPointerdown, true)

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

          if (files.length > 0 && !imageInputEnabled()) {
            event.preventDefault()
            return true
          }

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
    cleanupDocumentPointerdown?.()
    view?.destroy()
    images().forEach((image) => URL.revokeObjectURL(image.previewUrl))
  })

  return (
    <section ref={root} class="ai-chat-composer" aria-label="Chat prompt composer">
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
            <div class="ai-chat-composer__action-picker">
              <button
                class="ai-chat-composer__icon-button ai-chat-composer__action-button"
                type="button"
                aria-label="Chat actions"
                aria-haspopup="menu"
                aria-expanded={actionMenuOpen()}
                onClick={(event) => {
                  event.stopPropagation()
                  setModelMenuOpen(false)
                  setActionMenuOpen((open) => !open)
                }}
              >
                <span aria-hidden="true">...</span>
              </button>

              <Show when={actionMenuOpen()}>
                <div class="ai-chat-composer__action-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false)
                      props.onNewChat?.()
                      view?.focus()
                    }}
                  >
                    New chat
                  </button>
                </div>
              </Show>
            </div>
            <div class="ai-chat-composer__model-picker">
              <button
                class="ai-chat-composer__pill"
                type="button"
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen()}
                disabled={models().length === 0}
                onClick={(event) => {
                  event.stopPropagation()
                  setActionMenuOpen(false)
                  if (modelMenuOpen()) setModelMenuOpen(false)
                  else openModelMenu()
                }}
              >
                <Zap size={18} />
                <span>{modelButtonLabel()}</span>
                <span>{formatThinkingLevel(props.defaultThinkingLevel)}</span>
                <ChevronDown size={18} />
              </button>

              <Show when={modelMenuOpen()}>
                <div class="ai-chat-composer__model-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                  <div class="ai-chat-composer__model-providers" role="group" aria-label="AI providers">
                    <For each={providers()}>
                      {(provider) => (
                        <button
                          classList={{
                            "ai-chat-composer__model-provider": true,
                            "ai-chat-composer__model-provider--active": provider === activeProvider(),
                            "ai-chat-composer__model-provider--focused": provider === activeProvider() && modelMenuColumn() === "provider",
                          }}
                          type="button"
                          onClick={() => {
                            setActiveProvider(provider)
                            setFocusedModelId(models().find((model) => model.provider === provider)?.id)
                            setModelMenuColumn("model")
                          }}
                        >
                          <span>{providerLabel(provider)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="ai-chat-composer__model-list" role="group" aria-label="AI models">
                    <For each={activeProviderModels()}>
                      {(model) => (
                        <button
                          classList={{
                            "ai-chat-composer__model-option": true,
                            "ai-chat-composer__model-option--active": model.id === selectedModelId(),
                            "ai-chat-composer__model-option--focused": model.id === focusedModelId() && modelMenuColumn() === "model",
                          }}
                          type="button"
                          onMouseEnter={() => setFocusedModelId(model.id)}
                          onClick={() => {
                            setSelectedModelId(model.id)
                            setActiveProvider(model.provider)
                            setFocusedModelId(model.id)
                            setModelMenuOpen(false)
                            view?.focus()
                          }}
                        >
                          <strong>{model.name}</strong>
                          <span class="ai-chat-composer__model-capabilities" aria-label={model.input.includes("image") ? "Text and image input" : "Text input only"}>
                            <FileText size={13} />
                            <Show when={model.input.includes("image")}>
                              <ImageIcon size={13} />
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
            <button
              class="ai-chat-composer__icon-button"
              type="button"
              aria-label={imageInputEnabled() ? "Attach image from file picker" : "Selected model does not support images"}
              disabled={!imageInputEnabled()}
              onClick={() => imageInputEnabled() && imageInput.click()}
            >
              <ImageIcon size={20} />
            </button>
            <button
              class="ai-chat-composer__send"
              type="button"
              aria-label={props.isRunning ? "Stop response" : "Send prompt"}
              aria-busy={props.isCanceling ? "true" : undefined}
              disabled={props.isRunning && props.isCanceling}
              onClick={activatePrimaryAction}
            >
              <Show when={props.isRunning} fallback={<ArrowUp size={25} />}>
                <Square size={18} fill="currentColor" />
              </Show>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
