import type { TChatComposerImage, TChatComposerModel, TChatComposerSubmit, TChatComposerThinkingLevel, TChatPromptImage } from "../ChatComposer/interface"
import type { TChatMessagePart } from "./fn.chat-message-parts"
import type { TMarkdownBlock, TMarkdownInline } from "./fn.markdown-blocks"
import { For, createEffect, onCleanup, onMount, Show } from "solid-js"
import { ChatComposer } from "../ChatComposer/ChatComposer"
import { fnGetChatMessageLabel, fnGetChatMessageRole } from "./fn.chat-message-label"
import { fnGetChatMessageParts } from "./fn.chat-message-parts"
import { fnSerializeChatMessagesAsMarkdown } from "./fn.chat-message-markdown"
import { fnParseMarkdownBlocks } from "./fn.markdown-blocks"
import { fnNormalizeAssistantMarkdown } from "./fn.markdown"

type TAgentSettings = {
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: TChatComposerThinkingLevel
  models: TChatComposerModel[]
}

type TAiWizardPreference = {
  model?: {
    provider: string
    modelId: string
  }
  thinkingLevel?: TChatComposerThinkingLevel
}

const ALLOWED_IMAGE_MIME_TYPES = new Set<TChatPromptImage["mimeType"]>(["image/png", "image/jpeg", "image/gif", "image/webp"])
const MAX_PROMPT_IMAGE_COUNT = 5
const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024

interface IProps {
  settings?: TAgentSettings
  aiWizardPreference?: TAiWizardPreference
  messageHistory: readonly unknown[]
  isRunning: boolean
  isCanceling: boolean
  draftText?: string
  onDraftTextChange?: (text: string) => void
  onPrompt: (args: { text: string; images: TChatPromptImage[]; model?: TChatComposerModel; thinkingLevel: TChatComposerThinkingLevel }) => Promise<void>
  onCancel: () => void
  onNewWidget: () => void
  onEditExistingWidget: () => void
  onInspectActor: () => void
}

function getMessageKind(role: string) {
  if (role === "assistant") {
    return "assistant"
  }

  if (role === "user") {
    return "user"
  }

  return "other"
}

function getMessageObject(message: unknown) {
  return typeof message === "object" && message !== null
    ? message as Record<string, unknown>
    : undefined
}

function isSetActorCandidateToolResult(message: unknown) {
  const object = getMessageObject(message)

  return object?.role === "toolResult"
    && typeof object.toolName === "string"
    && object.toolName.toLowerCase() === "vc_set_actor_candidate"
    && object.isError !== true
}

function isScrolledToBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24
}

function getChatHistoryScrollKey(messageHistory: readonly unknown[]) {
  try {
    return JSON.stringify(messageHistory)
  } catch {
    return String(messageHistory.length)
  }
}

function isAllowedPromptImageMimeType(mimeType: string): mimeType is TChatPromptImage["mimeType"] {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType as TChatPromptImage["mimeType"])
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image file did not produce a data URL"))
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image file"))
    reader.readAsDataURL(file)
  })
}

async function encodePromptImage(image: TChatComposerImage): Promise<TChatPromptImage | undefined> {
  const file = image.file

  if (!isAllowedPromptImageMimeType(file.type) || file.size > MAX_PROMPT_IMAGE_BYTES) {
    return undefined
  }

  const dataUrl = await readFileAsDataUrl(file)
  const [, data = ""] = dataUrl.split(",", 2)

  if (!data) {
    return undefined
  }

  return {
    name: file.name || undefined,
    mimeType: file.type,
    data,
  }
}

async function encodePromptImages(images: TChatComposerImage[]) {
  const limitedImages = images.slice(0, MAX_PROMPT_IMAGE_COUNT)
  const encoded = await Promise.all(limitedImages.map((image) => encodePromptImage(image)))

  return encoded.filter((image): image is TChatPromptImage => image !== undefined)
}

function ChatMessageImage(props: { part: Extract<TChatMessagePart, { kind: "image" }> }) {
  return (
    <img
      class="ai-chat-history__image"
      src={props.part.src}
      alt={props.part.alt}
      loading="lazy"
    />
  )
}

function MarkdownInline(props: { part: TMarkdownInline }) {
  switch (props.part.kind) {
    case "code":
      return <code>{props.part.text}</code>
    case "strong":
      return <strong>{props.part.text}</strong>
    case "link":
      return <a href={props.part.href} target="_blank" rel="noopener noreferrer">{props.part.text}</a>
    case "text":
      return props.part.text
  }
}

function MarkdownInlines(props: { parts: TMarkdownInline[] }) {
  return (
    <For each={props.parts}>
      {(part) => <MarkdownInline part={part} />}
    </For>
  )
}

function MarkdownHeading(props: { block: Extract<TMarkdownBlock, { kind: "heading" }> }) {
  switch (props.block.level) {
    case 1:
      return <h1><MarkdownInlines parts={props.block.children} /></h1>
    case 2:
      return <h2><MarkdownInlines parts={props.block.children} /></h2>
    case 3:
      return <h3><MarkdownInlines parts={props.block.children} /></h3>
    case 4:
      return <h4><MarkdownInlines parts={props.block.children} /></h4>
    case 5:
      return <h5><MarkdownInlines parts={props.block.children} /></h5>
    case 6:
      return <h6><MarkdownInlines parts={props.block.children} /></h6>
  }
}

function onHorizontalScrollBlockWheel(event: WheelEvent, block: HTMLElement) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
    return
  }

  const scrollTarget = block.closest(".ai-chat-content")

  if (scrollTarget === null) {
    return
  }

  scrollTarget.scrollTop += event.deltaY
  event.preventDefault()
  event.stopPropagation()
}

function MarkdownTable(props: { block: Extract<TMarkdownBlock, { kind: "table" }> }) {
  let tableWrap!: HTMLDivElement

  onMount(() => {
    const listener = (event: WheelEvent) => onHorizontalScrollBlockWheel(event, tableWrap)
    tableWrap.addEventListener("wheel", listener, { passive: false })
    onCleanup(() => tableWrap.removeEventListener("wheel", listener))
  })

  return (
    <div class="ai-chat-history__table-wrap" ref={tableWrap}>
      <table>
        <thead>
          <tr>
            <For each={props.block.headers}>
              {(header, index) => (
                <th style={{ "text-align": props.block.align[index()] ?? "left" }}>
                  <MarkdownInlines parts={header} />
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.block.rows}>
            {(row) => (
              <tr>
                <For each={row}>
                  {(cell, index) => (
                    <td style={{ "text-align": props.block.align[index()] ?? "left" }}>
                      <MarkdownInlines parts={cell} />
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

function MarkdownCode(props: { block: Extract<TMarkdownBlock, { kind: "code" }> }) {
  let codeBlock!: HTMLPreElement

  onMount(() => {
    const listener = (event: WheelEvent) => onHorizontalScrollBlockWheel(event, codeBlock)
    codeBlock.addEventListener("wheel", listener, { passive: false })
    onCleanup(() => codeBlock.removeEventListener("wheel", listener))
  })

  return <pre ref={codeBlock}><code>{props.block.code}</code></pre>
}

function MarkdownBlock(props: { block: TMarkdownBlock }) {
  switch (props.block.kind) {
    case "heading":
      return <MarkdownHeading block={props.block} />
    case "paragraph":
      return <p><MarkdownInlines parts={props.block.children} /></p>
    case "blockquote":
      return <blockquote><MarkdownInlines parts={props.block.children} /></blockquote>
    case "list":
      if (props.block.ordered) {
        return (
          <ol>
            <For each={props.block.items}>
              {(item) => <li><MarkdownInlines parts={item} /></li>}
            </For>
          </ol>
        )
      }

      return (
        <ul>
          <For each={props.block.items}>
            {(item) => <li><MarkdownInlines parts={item} /></li>}
          </For>
        </ul>
      )
    case "table":
      return <MarkdownTable block={props.block} />
    case "code":
      return <MarkdownCode block={props.block} />
  }
}

function AssistantMarkdown(props: { content: string }) {
  const blocks = () => fnParseMarkdownBlocks(fnNormalizeAssistantMarkdown(props.content))

  return (
    <div class="ai-chat-history__markdown">
      <For each={blocks()}>
        {(block) => <MarkdownBlock block={block} />}
      </For>
    </div>
  )
}

function AssistantMessagePart(props: { part: TChatMessagePart }) {
  switch (props.part.kind) {
    case "image":
      return <ChatMessageImage part={props.part} />
    case "text":
      return <AssistantMarkdown content={props.part.text} />
  }
}

function PlainMessagePart(props: { part: TChatMessagePart }) {
  switch (props.part.kind) {
    case "image":
      return <ChatMessageImage part={props.part} />
    case "text":
      return <p class="ai-chat-history__plain">{props.part.text}</p>
  }
}

function PlainMessageParts(props: { parts: TChatMessagePart[] }) {
  return (
    <div class="ai-chat-history__parts">
      <For each={props.parts}>
        {(part) => <PlainMessagePart part={part} />}
      </For>
    </div>
  )
}

function AssistantMessageParts(props: { parts: TChatMessagePart[] }) {
  return (
    <div class="ai-chat-history__parts ai-chat-history__parts--assistant">
      <For each={props.parts}>
        {(part) => <AssistantMessagePart part={part} />}
      </For>
    </div>
  )
}

function ChatHistoryMessage(props: { message: unknown; onInspectActor: () => void }) {
  const role = () => fnGetChatMessageRole(props.message)
  const label = () => fnGetChatMessageLabel(props.message)
  const parts = () => fnGetChatMessageParts(props.message)
  const kind = () => getMessageKind(role())
  const showInspectActor = () => isSetActorCandidateToolResult(props.message)

  return (
    <article class={`ai-chat-history__message ai-chat-history__message--${kind()}`}>
      <Show when={kind() !== "assistant"}>
        <span class="ai-chat-history__role">{label()}</span>
      </Show>
      <Show
        when={kind() === "assistant"}
        fallback={<PlainMessageParts parts={parts()} />}
      >
        <AssistantMessageParts parts={parts()} />
      </Show>
      <Show when={showInspectActor()}>
        <div class="ai-chat-history__actions">
          <button type="button" onClick={props.onInspectActor}>Inspect Actor</button>
        </div>
      </Show>
    </article>
  )
}

export function ChatTab(props: IProps) {
  let contentRoot!: HTMLDivElement
  let shouldAutoScroll = true
  let scrollAnimationFrame: number | undefined

  const scrollToBottom = () => {
    contentRoot.scrollTop = contentRoot.scrollHeight
  }

  const scheduleScrollToBottom = () => {
    if (scrollAnimationFrame !== undefined) {
      cancelAnimationFrame(scrollAnimationFrame)
    }

    scrollAnimationFrame = requestAnimationFrame(() => {
      scrollAnimationFrame = undefined
      scrollToBottom()
    })
  }

  const submitPrompt = (submit: TChatComposerSubmit) => {
    const text = submit.text.trim()
    const hasImages = submit.images.length > 0

    if (!text && !hasImages) return

    void (async () => {
      const images = await encodePromptImages(submit.images)
      if (!text && images.length === 0) return

      await props.onPrompt({ text, images, model: submit.model, thinkingLevel: submit.thinkingLevel })
    })().catch((error) => {
      console.error(error)
    })
  }

  const copyChat = () => {
    const markdown = fnSerializeChatMessagesAsMarkdown(props.messageHistory)

    if (!markdown) {
      return
    }

    void navigator.clipboard.writeText(markdown).catch((error) => {
      console.error(error)
    })
  }

  createEffect(() => {
    getChatHistoryScrollKey(props.messageHistory)

    if (shouldAutoScroll) {
      scheduleScrollToBottom()
    }
  })

  onMount(() => {
    const updateAutoScroll = () => {
      shouldAutoScroll = isScrolledToBottom(contentRoot)
    }

    updateAutoScroll()
    contentRoot.addEventListener("scroll", updateAutoScroll, { passive: true })

    onCleanup(() => {
      contentRoot.removeEventListener("scroll", updateAutoScroll)

      if (scrollAnimationFrame !== undefined) {
        cancelAnimationFrame(scrollAnimationFrame)
      }
    })
  })

  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--chat">
      <div ref={contentRoot} class="ai-chat-content">
        <Show when={props.messageHistory.length === 0}>
          <div class="ai-chat-empty" aria-live="polite">
            Which Widget should AI build for you?
          </div>
        </Show>
        <Show when={props.messageHistory.length > 0}>
          <div class="ai-chat-history" aria-live="polite">
            <For each={props.messageHistory}>
              {(message) => (
                <ChatHistoryMessage message={message} onInspectActor={props.onInspectActor} />
              )}
            </For>
          </div>
        </Show>
      </div>

      <ChatComposer
        models={props.settings?.models}
        defaultModel={props.aiWizardPreference?.model?.modelId ?? props.settings?.defaultModel}
        defaultProvider={props.aiWizardPreference?.model?.provider ?? props.settings?.defaultProvider}
        defaultThinkingLevel={props.aiWizardPreference?.thinkingLevel ?? props.settings?.defaultThinkingLevel}
        isRunning={props.isRunning}
        isCanceling={props.isCanceling}
        draftText={props.draftText}
        onDraftTextChange={props.onDraftTextChange}
        onSubmit={submitPrompt}
        onCancel={props.onCancel}
        onNewWidget={props.onNewWidget}
        onEditExistingWidget={props.onEditExistingWidget}
        onCopyChat={copyChat}
      />
    </div>
  )
}
