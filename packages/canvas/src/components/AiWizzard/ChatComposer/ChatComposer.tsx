import type { EditorView } from "prosemirror-view"
import type {
  TChatComposerCommand,
  TChatComposerImage,
  TChatComposerMention,
  TChatComposerModel,
  TChatComposerProps,
  TChatComposerSubmit,
  TChatComposerThinkingLevel,
  TPromptSuggestion,
} from "./interface"
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const MAX_PROMPT_IMAGE_COUNT = 5
const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024
const THINKING_LEVELS: TChatComposerThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"]

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

function createDocFromText(text: string) {
  if (text.length === 0) {
    return createEmptyDoc()
  }

  const nodes = text.split("\n").flatMap((line, index) => {
    const lineNodes = line.length > 0 ? [promptSchema.text(line)] : []

    if (index === 0) {
      return lineNodes
    }

    return [promptSchema.nodes.hard_break.create(), ...lineNodes]
  })

  return promptSchema.nodes.doc.create(null, [promptSchema.nodes.paragraph.create(null, nodes)])
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

function getDefaultThinkingLevel(level: TChatComposerThinkingLevel | undefined) {
  return level ?? "medium"
}

function formatThinkingLevel(level: TChatComposerThinkingLevel | undefined) {
  if (!level) {
    return "Medium"
  }

  return level.charAt(0).toUpperCase() + level.slice(1)
}

function getDefaultModel(models: TChatComposerModel[], defaultModel?: string, defaultProvider?: string) {
  if (defaultModel && defaultProvider) {
    const exactDefaultWithProvider = models.find(
      (model) => model.id === defaultModel && model.provider === defaultProvider,
    )

    if (exactDefaultWithProvider) {
      return exactDefaultWithProvider
    }
  }

  const exactDefault = models.find((model) => model.id === defaultModel)

  if (exactDefault) {
    return exactDefault
  }

  return models.find((model) => model.provider === defaultProvider) ?? models[0]
}

function getModelSelectionKey(model: TChatComposerModel) {
  return `${model.provider}::${model.id}`
}

function getModelBySelectionKey(models: readonly TChatComposerModel[], key?: string) {
  if (!key) {
    return undefined
  }

  return models.find((model) => getModelSelectionKey(model) === key) ?? models.find((model) => model.id === key)
}

function getModelSelectionKeyOrId(models: readonly TChatComposerModel[], key?: string) {
  const resolved = getModelBySelectionKey(models, key)
  return resolved ? getModelSelectionKey(resolved) : undefined
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
  const [selectedThinkingLevel, setSelectedThinkingLevel] = createSignal<TChatComposerThinkingLevel>()
  const [focusedThinkingLevel, setFocusedThinkingLevel] = createSignal<TChatComposerThinkingLevel>()
  const [modelMenuPane, setModelMenuPane] = createSignal<"thinking" | "models">("models")
  const [modelMenuColumn, setModelMenuColumn] = createSignal<"category" | "model" | "thinking">("model")
  const [hasManualModelSelection, setHasManualModelSelection] = createSignal(false)
  const [hasManualThinkingSelection, setHasManualThinkingSelection] = createSignal(false)

  const availableMentions = () => props.mentions ?? []
  const availableCommands = () => props.commands ?? []
  const placeholder = () => props.placeholder ?? "Ask for follow-up changes"
  const models = createMemo(() => props.models ?? [])
  const providers = createMemo(() => Array.from(new Set(models().map((model) => model.provider))))
  const selectedModel = createMemo(() => getModelBySelectionKey(models(), selectedModelId()))
  const activeProviderModels = createMemo(() => models().filter((model) => model.provider === activeProvider()))
  const imageInputEnabled = createMemo(() => selectedModel()?.input.includes("image") ?? false)
  const modelButtonLabel = createMemo(() => selectedModel()?.name.replace(/^GPT-/i, "") ?? "Select model")
  const thinkingLevel = createMemo(() => selectedThinkingLevel() ?? getDefaultThinkingLevel(props.defaultThinkingLevel))
  const focusedModel = createMemo(() => getModelBySelectionKey(models(), focusedModelId()))

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
    const resolvedCurrentSelectionKey = getModelSelectionKeyOrId(models(), current)

    if (!nextDefault) {
      setSelectedModelId(undefined)
      setActiveProvider(undefined)
      setFocusedModelId(undefined)
      return
    }

    const nextDefaultSelectionKey = getModelSelectionKey(nextDefault)

    if (current && resolvedCurrentSelectionKey && resolvedCurrentSelectionKey !== current) {
      setSelectedModelId(resolvedCurrentSelectionKey)
      setFocusedModelId(resolvedCurrentSelectionKey)
    }

    if (!current || !resolvedCurrentSelectionKey) {
      if (!hasManualModelSelection()) {
        setSelectedModelId(nextDefaultSelectionKey)
        setActiveProvider(nextDefault.provider)
        setFocusedModelId(nextDefaultSelectionKey)
      }

      return
    }

    if (!hasManualModelSelection() && resolvedCurrentSelectionKey !== nextDefaultSelectionKey) {
      setSelectedModelId(nextDefaultSelectionKey)
      setActiveProvider(nextDefault.provider)
      setFocusedModelId(nextDefaultSelectionKey)
    }
  })

  createEffect(() => {
    const defaultThinkingLevel = getDefaultThinkingLevel(props.defaultThinkingLevel)

    if (!selectedThinkingLevel() || (!hasManualThinkingSelection() && selectedThinkingLevel() !== defaultThinkingLevel)) {
      setSelectedThinkingLevel(defaultThinkingLevel)
      setFocusedThinkingLevel(defaultThinkingLevel)
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
    props.onDraftTextChange?.("")
  }

  const addImageFiles = (files: File[]) => {
    if (!imageInputEnabled()) {
      return false
    }

    const remainingImageSlots = Math.max(0, MAX_PROMPT_IMAGE_COUNT - images().length)
    const imageFiles = files
      .filter((file) => ALLOWED_IMAGE_MIME_TYPES.has(file.type) && file.size <= MAX_PROMPT_IMAGE_BYTES)
      .slice(0, remainingImageSlots)

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
      thinkingLevel: thinkingLevel(),
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
    setModelMenuPane("models")
    setActiveProvider(currentModel?.provider ?? activeProvider() ?? providers()[0])
    setFocusedModelId(currentModel ? getModelSelectionKey(currentModel) : activeProviderModels()[0] ? getModelSelectionKey(activeProviderModels()[0]) : undefined)
    setModelMenuColumn("model")
    setFocusedThinkingLevel(thinkingLevel())
    setModelMenuOpen(true)
  }

  const menuCategoryItems = () => [
    { kind: "thinking" as const, id: "thinking", label: "Thinking" },
    ...providers().map((provider) => ({ kind: "provider" as const, id: provider, label: providerLabel(provider) })),
  ]

  const moveMenuCategory = (direction: 1 | -1) => {
    const items = menuCategoryItems()
    if (items.length === 0) return

    const currentId = modelMenuPane() === "thinking" ? "thinking" : activeProvider()
    const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId))
    const nextItem = items[(currentIndex + direction + items.length) % items.length]

    if (nextItem.kind === "thinking") {
      setModelMenuPane("thinking")
      setFocusedThinkingLevel(thinkingLevel())
      return
    }

    setModelMenuPane("models")
    setActiveProvider(nextItem.id)
    const nextProviderModel = models().find((model) => model.provider === nextItem.id)
    setFocusedModelId(nextProviderModel ? getModelSelectionKey(nextProviderModel) : undefined)
  }

  const moveFocusedModel = (direction: 1 | -1) => {
    const currentModels = activeProviderModels()
    if (currentModels.length === 0) return

    const currentIndex = Math.max(0, currentModels.findIndex((model) => getModelSelectionKey(model) === focusedModelId()))
    setFocusedModelId(getModelSelectionKey(currentModels[(currentIndex + direction + currentModels.length) % currentModels.length]))
  }

  const setSelectedModel = (model: TChatComposerModel) => {
    const modelSelectionKey = getModelSelectionKey(model)

    batch(() => {
      setHasManualModelSelection(true)
      setSelectedModelId(modelSelectionKey)
      setFocusedModelId(modelSelectionKey)
      setActiveProvider(model.provider)
    })

    props.onPreferenceChange?.({
      model: {
        provider: model.provider,
        modelId: model.id,
      },
    })
    setModelMenuOpen(false)
    view?.focus()
  }

  const setThinkingLevel = (level: TChatComposerThinkingLevel) => {
    batch(() => {
      setSelectedThinkingLevel(level)
      setHasManualThinkingSelection(true)
      setFocusedThinkingLevel(level)
    })

    props.onPreferenceChange?.({ thinkingLevel: level })
    setModelMenuOpen(false)
    view?.focus()
  }

  const moveFocusedThinkingLevel = (direction: 1 | -1) => {
    const currentIndex = Math.max(0, THINKING_LEVELS.indexOf(focusedThinkingLevel() ?? thinkingLevel()))
    setFocusedThinkingLevel(THINKING_LEVELS[(currentIndex + direction + THINKING_LEVELS.length) % THINKING_LEVELS.length])
  }

  const selectFocusedModel = () => {
    const model = focusedModel() ?? activeProviderModels()[0]
    if (!model) return

    setSelectedModel(model)
  }

  const selectFocusedThinkingLevel = () => {
    setThinkingLevel(focusedThinkingLevel() ?? thinkingLevel())
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
      setModelMenuColumn("category")
      return true
    }

    if (event.key === "ArrowRight") {
      if (modelMenuPane() === "thinking") {
        setModelMenuColumn("thinking")
        setFocusedThinkingLevel(focusedThinkingLevel() ?? thinkingLevel())
      } else {
        setModelMenuColumn("model")
        setFocusedModelId(focusedModelId() ?? (activeProviderModels()[0] ? getModelSelectionKey(activeProviderModels()[0]) : undefined))
      }
      return true
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const direction = event.key === "ArrowDown" ? 1 : -1
      if (modelMenuColumn() === "category") moveMenuCategory(direction)
      else if (modelMenuColumn() === "thinking") moveFocusedThinkingLevel(direction)
      else moveFocusedModel(direction)
      return true
    }

    if (event.key === "Enter") {
      if (modelMenuColumn() === "category") {
        if (modelMenuPane() === "thinking") {
          setModelMenuColumn("thinking")
          setFocusedThinkingLevel(focusedThinkingLevel() ?? thinkingLevel())
        } else {
          setModelMenuColumn("model")
          setFocusedModelId(focusedModelId() ?? (activeProviderModels()[0] ? getModelSelectionKey(activeProviderModels()[0]) : undefined))
        }
      } else if (modelMenuColumn() === "thinking") {
        selectFocusedThinkingLevel()
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
      doc: createDocFromText(props.draftText ?? ""),
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
        props.onDraftTextChange?.(getEditorText(view))
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

  createEffect(() => {
    const nextText = props.draftText ?? ""

    if (!view || getEditorText(view) === nextText) {
      return
    }

    const state = EditorState.create({
      doc: createDocFromText(nextText),
      schema: promptSchema,
      plugins: view.state.plugins,
    })
    view.updateState(state)
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
                      props.onNewWidget?.()
                      view?.focus()
                    }}
                  >
                    New widget
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false)
                      props.onEditExistingWidget?.()
                      view?.focus()
                    }}
                  >
                    Edit existing widget
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false)
                      props.onCopyChat?.()
                      view?.focus()
                    }}
                  >
                    Copy chat
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
                <span>{formatThinkingLevel(thinkingLevel())}</span>
                <ChevronDown size={18} />
              </button>

              <Show when={modelMenuOpen()}>
                <div class="ai-chat-composer__model-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                  <div class="ai-chat-composer__model-providers" role="group" aria-label="AI model settings">
                    <For each={menuCategoryItems()}>
                      {(item) => (
                        <button
                          classList={{
                            "ai-chat-composer__model-provider": true,
                            "ai-chat-composer__model-provider--active": item.kind === "thinking" ? modelMenuPane() === "thinking" : modelMenuPane() === "models" && item.id === activeProvider(),
                            "ai-chat-composer__model-provider--focused": (
                              item.kind === "thinking" ? modelMenuPane() === "thinking" : modelMenuPane() === "models" && item.id === activeProvider()
                            ) && modelMenuColumn() === "category",
                          }}
                          type="button"
                          onClick={() => {
                            if (item.kind === "thinking") {
                              setModelMenuPane("thinking")
                              setFocusedThinkingLevel(thinkingLevel())
                              setModelMenuColumn("thinking")
                              return
                            }

                            setModelMenuPane("models")
                            setActiveProvider(item.id)
                            const nextProviderModel = models().find((model) => model.provider === item.id)
                            setFocusedModelId(nextProviderModel ? getModelSelectionKey(nextProviderModel) : undefined)
                            setModelMenuColumn("model")
                          }}
                        >
                          <span>{item.label}</span>
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="ai-chat-composer__model-list" role="group" aria-label="AI models">
                    <Show
                      when={modelMenuPane() === "thinking"}
                      fallback={(
                        <For each={activeProviderModels()}>
                          {(model) => (
                            <button
                              classList={{
                                "ai-chat-composer__model-option": true,
                                "ai-chat-composer__model-option--active": getModelSelectionKey(model) === selectedModelId(),
                                "ai-chat-composer__model-option--focused": getModelSelectionKey(model) === focusedModelId() && modelMenuColumn() === "model",
                              }}
                              type="button"
                              onMouseEnter={() => setFocusedModelId(getModelSelectionKey(model))}
                              onClick={() => {
                                setSelectedModel(model)
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
                      )}
                    >
                      <For each={THINKING_LEVELS}>
                        {(level) => (
                          <button
                            classList={{
                              "ai-chat-composer__model-option": true,
                              "ai-chat-composer__model-option--active": level === thinkingLevel(),
                              "ai-chat-composer__model-option--focused": level === focusedThinkingLevel() && modelMenuColumn() === "thinking",
                            }}
                            type="button"
                            onMouseEnter={() => setFocusedThinkingLevel(level)}
                            onClick={() => {
                              setThinkingLevel(level)
                            }}
                          >
                            <strong>{formatThinkingLevel(level)}</strong>
                          </button>
                        )}
                      </For>
                    </Show>
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
