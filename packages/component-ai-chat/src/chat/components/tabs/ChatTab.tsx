import type { TChatComposerImage, TChatComposerMention, TChatComposerModel, TChatComposerPreferenceChange, TChatComposerSubmit, TChatComposerThinkingLevel, TChatPromptImage } from "../ChatComposer/interface"
import type { TChatMessagePart } from "./fn.chat-message-parts"
import type { TMarkdownBlock, TMarkdownInline } from "./fn.markdown-blocks"
import { For, createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js"
import { ChatComposer } from "../ChatComposer/ChatComposer"
import { fnGetAiChatAssistantError } from "../fn.error"
import { fnGetChatMessageLabel, fnGetChatMessageRole, fnIsChatMessageVisible } from "./fn.chat-message-label"
import { fnGetChatMessageParts } from "./fn.chat-message-parts"
import { fnSerializeChatMessagesAsMarkdown } from "./fn.chat-message-markdown"
import { fnParseMarkdownBlocks } from "./fn.markdown-blocks"
import { fnNormalizeAssistantMarkdown } from "./fn.markdown"
import { fnChatMessageHasImage, fnGetEditableChatMessageText, type TChatHistoryItem } from "./fn.chat-history-edit"
import { fnGetChatHistoryScrollKey } from "./fn.chat-history-scroll-key"
import { ApprovalList } from "../ApprovalList"
import { fnGetChatToolCalls, fnGetToolNameLabel, fnGetToolResultResource, fnGetToolResultWidgetDraft } from "./fn.tool-call"
import type { TAiChatApproval, TAiChatAssistantError, TAiChatWidgetError, TAiChatWidgetErrorKind } from "../types"
import type { IAiChatBrowserPort, TAiChatApprovalPolicy } from "../../../contracts.js"
import type { AiChatEffectRuntime } from "../../../internal/stream-lifecycle.js"

type TAgentSettings = {
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: TChatComposerThinkingLevel
  models: readonly TChatComposerModel[]
  providersWithCredentials: readonly string[]
}

type TAiChatPreference = {
  approvalPolicy: TAiChatApprovalPolicy
  model?: {
    provider: string
    modelId: string
  }
  thinkingLevel?: TChatComposerThinkingLevel
}

const ALLOWED_IMAGE_MIME_TYPES = new Set<TChatPromptImage["mimeType"]>(["image/png", "image/jpeg", "image/gif", "image/webp"])
const MAX_PROMPT_IMAGE_COUNT = 5
const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024
const TOOL_RESULT_COLLAPSED_LINE_LIMIT = 5

interface IProps {
  browser: IAiChatBrowserPort
  lifecycle: AiChatEffectRuntime
  onLogError: (error: unknown) => void
  settings?: TAgentSettings
  aiChatPreference?: TAiChatPreference
  messageHistory: readonly TChatHistoryItem[]
  isRunning: boolean
  isCanceling: boolean
  isEditingHistory: boolean
  widgetError?: TAiChatWidgetError
  draftText?: string
  onDraftTextChange?: (text: string) => void
  onPreferenceChange?: (preference: TChatComposerPreferenceChange) => void
  onApprovalPolicyChange?: (policy: TAiChatApprovalPolicy) => Promise<boolean>
  mentions?: readonly TChatComposerMention[]
  approvals: readonly TAiChatApproval[]
  onPrompt: (args: { text: string; images: TChatPromptImage[]; widgetRefs?: Array<{ name: string; source: "draft" | "published" }>; model?: TChatComposerModel; thinkingLevel: TChatComposerThinkingLevel }) => void
  onEditMessage: (
    args: { entryId: string; text: string; model?: TAiChatPreference["model"]; thinkingLevel?: TChatComposerThinkingLevel },
  ) => Promise<boolean>
  onResolveApproval: (approvalId: string, decision: "approve" | "reject") => void
  onOpenResource?: (resourceId: string) => void
  onOpenWidgetPreview?: (args: { name: string }) => void | Promise<void>
  onCancel: () => void
  onDismissError: () => void
  onOpenSettings: () => void
  onReportError: (kind: TAiChatWidgetErrorKind, error: unknown) => void
  onRetryError: () => void
  onNewChat: () => void
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

function isToolResultMessage(message: unknown) {
  const object = getMessageObject(message)
  return object?.role === "toolResult"
}

function truncateTextLines(text: string, lineLimit: number) {
  const lines = text.split(/\r\n|\n|\r/)

  if (lines.length <= lineLimit) {
    return { text, truncated: false, usedLines: lines.length }
  }

  const previewLines = lines.slice(0, lineLimit)
  previewLines[previewLines.length - 1] = `${previewLines[previewLines.length - 1]} ...`

  return {
    text: previewLines.join("\n"),
    truncated: true,
    usedLines: lineLimit,
  }
}

function collapseToolResultParts(parts: TChatMessagePart[], lineLimit: number) {
  const collapsedParts: TChatMessagePart[] = []
  let remainingLines = lineLimit
  let truncated = false

  for (const part of parts) {
    if (part.kind === "image") {
      collapsedParts.push(part)
      continue
    }

    if (remainingLines <= 0) {
      truncated = true
      continue
    }

    const collapsed = truncateTextLines(part.text, remainingLines)
    collapsedParts.push({ ...part, text: collapsed.text })
    remainingLines -= collapsed.usedLines

    if (collapsed.truncated) {
      truncated = true
      remainingLines = 0
    }
  }

  if (truncated && !collapsedParts.some((part) => part.kind === "text" && part.text.endsWith(" ..."))) {
    let lastTextPart: Extract<TChatMessagePart, { kind: "text" }> | undefined

    for (let index = collapsedParts.length - 1; index >= 0; index -= 1) {
      const part = collapsedParts[index]
      if (part?.kind === "text") {
        lastTextPart = part
        break
      }
    }

    if (lastTextPart) {
      lastTextPart.text = `${lastTextPart.text} ...`
    } else {
      collapsedParts.push({ kind: "text", text: "..." })
    }
  }

  return { parts: collapsedParts, truncated }
}

function isScrolledToBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24
}

function isAllowedPromptImageMimeType(mimeType: string): mimeType is TChatPromptImage["mimeType"] {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType as TChatPromptImage["mimeType"])
}

async function encodePromptImage(browser: IAiChatBrowserPort, image: TChatComposerImage): Promise<TChatPromptImage | undefined> {
  const file = image.file

  if (!isAllowedPromptImageMimeType(file.type) || file.size > MAX_PROMPT_IMAGE_BYTES) {
    return undefined
  }

  const dataUrl = await browser.readFileAsDataUrl(file)
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

async function encodePromptImages(browser: IAiChatBrowserPort, images: TChatComposerImage[]) {
  const limitedImages = images.slice(0, MAX_PROMPT_IMAGE_COUNT)
  const encoded = await Promise.all(limitedImages.map((image) => encodePromptImage(browser, image)))

  return encoded.filter((image): image is TChatPromptImage => image !== undefined)
}

function ChatMessageImage(props: { part: Extract<TChatMessagePart, { kind: "image" }> }) {
  return (
    <img
      class="omnidraw-ai-chat-history__image"
      src={props.part.src}
      alt={props.part.alt}
      width={props.part.width}
      height={props.part.height}
      data-byte-size={props.part.byteSize}
      data-mime-type={props.part.mimeType}
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

function onNestedChatWheel(event: WheelEvent, block: HTMLElement) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
    return
  }

  const scrollTarget = block.closest(".omnidraw-ai-chat-content")

  if (scrollTarget === null) {
    return
  }

  scrollTarget.scrollTop += event.deltaY
  event.preventDefault()
  event.stopPropagation()
}

function MarkdownTable(props: { block: Extract<TMarkdownBlock, { kind: "table" }> }) {
  let tableWrap!: HTMLDivElement

  onSettled(() => {
    const listener = (event: WheelEvent) => onNestedChatWheel(event, tableWrap)
    tableWrap.addEventListener("wheel", listener, { passive: false })
    return () => tableWrap.removeEventListener("wheel", listener)
  })

  return (
    <div class="omnidraw-ai-chat-history__table-wrap" ref={tableWrap}>
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

  onSettled(() => {
    const listener = (event: WheelEvent) => onNestedChatWheel(event, codeBlock)
    codeBlock.addEventListener("wheel", listener, { passive: false })
    return () => codeBlock.removeEventListener("wheel", listener)
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
    <div class="omnidraw-ai-chat-history__markdown">
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
      return <p class="omnidraw-ai-chat-history__plain">{props.part.text}</p>
  }
}

function PlainMessageParts(props: { parts: TChatMessagePart[] }) {
  return (
    <div class="omnidraw-ai-chat-history__parts">
      <For each={props.parts}>
        {(part) => <PlainMessagePart part={part} />}
      </For>
    </div>
  )
}

function AssistantMessageParts(props: { parts: TChatMessagePart[] }) {
  return (
    <div class="omnidraw-ai-chat-history__parts omnidraw-ai-chat-history__parts--assistant">
      <For each={props.parts}>
        {(part) => <AssistantMessagePart part={part} />}
      </For>
    </div>
  )
}

function AssistantErrorCard(props: { error: TAiChatAssistantError; onOpenSettings: () => void }) {
  const context = () => [props.error.provider, props.error.model].filter(Boolean).join(" / ")

  return (
    <section class="omnidraw-ai-chat-message-error" aria-label="AI response failed">
      <header>
        <span aria-hidden="true">!</span>
        <strong>AI response failed</strong>
      </header>
      <p>{props.error.message}</p>
      <Show when={context() || props.error.diagnosticCode}>
        <div class="omnidraw-ai-chat-message-error__context">
          <Show when={context()}>{(value) => <span>{value()}</span>}</Show>
          <Show when={props.error.diagnosticCode}>{(code) => <code>{code()}</code>}</Show>
        </div>
      </Show>
      <Show when={props.error.isAuthenticationError}>
        <button type="button" onClick={props.onOpenSettings}>Open settings</button>
      </Show>
    </section>
  )
}

function ChatWidgetErrorBanner(props: {
  error: TAiChatWidgetError
  onDismiss: () => void
  onOpenSettings: () => void
  onRetry: () => void
}) {
  const canRetry = () => props.error.kind === "connection" || props.error.kind === "stream"

  return (
    <section class="omnidraw-ai-chat-widget-error" role="alert">
      <div class="omnidraw-ai-chat-widget-error__body">
        <strong>{props.error.title}</strong>
        <p>{props.error.message}</p>
      </div>
      <div class="omnidraw-ai-chat-widget-error__actions">
        <Show when={props.error.isAuthenticationError}>
          <button type="button" onClick={props.onOpenSettings}>Open settings</button>
        </Show>
        <Show when={!props.error.isAuthenticationError && canRetry()}>
          <button type="button" onClick={props.onRetry}>Try again</button>
        </Show>
        <button type="button" class="omnidraw-ai-chat-widget-error__dismiss" aria-label="Dismiss error" onClick={props.onDismiss}>×</button>
      </div>
    </section>
  )
}

function ToolCallRow(props: {
  browser: IAiChatBrowserPort
  toolCall: { id: string; name: string }
  approvals: readonly TAiChatApproval[]
  onResolveApproval: IProps["onResolveApproval"]
  onOpenResource?: IProps["onOpenResource"]
}) {
  return (
    <section class="omnidraw-ai-chat-tool-call" aria-label={`Tool call ${props.toolCall.name}`}>
      <header class="omnidraw-ai-chat-tool-call__header">
        <span>Tool call</span>
        <strong>{fnGetToolNameLabel(props.toolCall.name)}</strong>
        <code>{props.toolCall.name}</code>
      </header>
      <ApprovalList
        browser={props.browser}
        approvals={props.approvals}
        onResolve={props.onResolveApproval}
        onOpenResource={props.onOpenResource}
        variant="inline"
      />
    </section>
  )
}

function ChatHistoryMessage(props: {
  browser: IAiChatBrowserPort
  lifecycle: AiChatEffectRuntime
  onLogError: IProps["onLogError"]
  item: TChatHistoryItem
  approvals: readonly TAiChatApproval[]
  onResolveApproval: IProps["onResolveApproval"]
  onOpenResource?: IProps["onOpenResource"]
  onOpenWidgetPreview?: IProps["onOpenWidgetPreview"]
  onReportError: IProps["onReportError"]
  onOpenSettings: IProps["onOpenSettings"]
  canEdit: boolean
  isEditing: boolean
  editPending: boolean
  editText: string
  onBeginEdit: () => void
  onCancelEdit: () => void
  onEditTextChange: (text: string) => void
  onSendEdit: () => void
}) {
  let editButton: HTMLButtonElement | undefined
  let editor: HTMLTextAreaElement | undefined
  let wasEditing = false
  const [isExpanded, setIsExpanded] = createSignal(false)
  const [previewPending, setPreviewPending] = createSignal(false)
  const message = () => props.item.message
  const role = () => fnGetChatMessageRole(message())
  const label = () => fnGetChatMessageLabel(message())
  const parts = () => fnGetChatMessageParts(message())
  const assistantError = () => fnGetAiChatAssistantError(message())
  const kind = () => getMessageKind(role())
  const toolCalls = () => fnGetChatToolCalls(message())
  const resource = () => props.onOpenResource ? fnGetToolResultResource(message()) : undefined
  const widgetDraft = () => props.onOpenWidgetPreview ? fnGetToolResultWidgetDraft(message()) : undefined
  const isToolResult = () => isToolResultMessage(message())
  const collapsedToolResult = createMemo(() => collapseToolResultParts(parts(), TOOL_RESULT_COLLAPSED_LINE_LIMIT))
  const renderedPlainParts = () => isToolResult() && !isExpanded() ? collapsedToolResult().parts : parts()
  const canSendEdit = () => props.editText.trim().length > 0 || fnChatMessageHasImage(message())
  const requestPreview = (name: string) => {
    if (previewPending()) return
    setPreviewPending(true)
    props.lifecycle.startLatest(`composer:preview:${name}`, {
      run: () => Promise.resolve(props.onOpenWidgetPreview?.({ name })),
      onSuccess: () => undefined,
      onError: props.onLogError,
      onFinally: () => setPreviewPending(false),
    })
  }
  const resizeEditor = () => {
    if (!editor) return
    editor.style.height = "auto"
    editor.style.height = `${editor.scrollHeight}px`
  }
  createEffect(() => {
    return { browser: props.browser, editing: props.isEditing }
  }, ({ browser, editing }) => {
    if (editing && !wasEditing) {
      browser.requestAnimationFrame(() => {
        editor?.focus()
        editor?.setSelectionRange(editor.value.length, editor.value.length)
      })
    } else if (wasEditing) {
      browser.requestAnimationFrame(() => editButton?.focus())
    }
    wasEditing = editing
  })
  createEffect(() => {
    if (!props.isEditing) return
    return { browser: props.browser, editText: props.editText }
  }, (update) => {
    if (update) update.browser.requestAnimationFrame(resizeEditor)
  })
  const toggleToolResult = () => {
    if (isToolResult()) {
      setIsExpanded((value) => !value)
    }
  }
  return (
    <article
      class={[
        `omnidraw-ai-chat-history__message omnidraw-ai-chat-history__message--${kind()}`,
        {
          "omnidraw-ai-chat-history__message--tool-result": isToolResult(),
          "omnidraw-ai-chat-history__message--tool-result-expanded": isToolResult() && isExpanded(),
        },
      ]}
      onClick={toggleToolResult}
      onWheel={(event) => {
        if (isToolResult()) {
          onNestedChatWheel(event, event.currentTarget)
        }
      }}
    >
      <Show when={kind() !== "assistant"}>
        <div class="omnidraw-ai-chat-history__message-header">
          <span class="omnidraw-ai-chat-history__role">{label()}</span>
          <Show when={kind() === "user" && props.item.entryId}>
            <button
              ref={editButton}
              type="button"
              class="omnidraw-ai-chat-history__edit-action"
              disabled={!props.canEdit}
              aria-label="Edit this user message"
              onClick={(event) => {
                event.stopPropagation()
                props.onBeginEdit()
              }}
            >
              Edit
            </button>
          </Show>
          <Show when={isToolResult() && (collapsedToolResult().truncated || isExpanded())}>
            <button
              type="button"
              class="omnidraw-ai-chat-history__tool-result-toggle"
              aria-expanded={isExpanded() ? "true" : "false"}
              onClick={(event) => {
                event.stopPropagation()
                toggleToolResult()
              }}
            >
              {isExpanded() ? "Collapse" : "Expand"}
            </button>
          </Show>
        </div>
      </Show>
      <Show when={props.isEditing} fallback={(
        <Show
          when={kind() === "assistant"}
          fallback={<PlainMessageParts parts={renderedPlainParts()} />}
        >
          <AssistantMessageParts parts={parts()} />
        </Show>
      )}>
        <div class="omnidraw-ai-chat-history__editor" onClick={(event) => event.stopPropagation()}>
          <textarea
            ref={editor}
            value={props.editText}
            disabled={props.editPending || !props.canEdit}
            aria-label="Edit user message"
            rows={1}
            onInput={(event) => {
              props.onEditTextChange(event.currentTarget.value)
              resizeEditor()
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                props.onCancelEdit()
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                if (canSendEdit() && !props.editPending && props.canEdit) props.onSendEdit()
              }
            }}
          />
          <div class="omnidraw-ai-chat-history__editor-actions">
            <button type="button" disabled={props.editPending} onClick={props.onCancelEdit}>Cancel</button>
            <button type="button" disabled={props.editPending || !props.canEdit || !canSendEdit()} onClick={props.onSendEdit}>
              {props.editPending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </Show>
      <Show when={assistantError()}>
        {(error) => <AssistantErrorCard error={error()} onOpenSettings={props.onOpenSettings} />}
      </Show>
      <For each={toolCalls()}>
        {(toolCall) => (
          <ToolCallRow
            browser={props.browser}
            toolCall={toolCall}
            approvals={props.approvals.filter((approval) => approval.toolCallId === toolCall.id)}
            onResolveApproval={props.onResolveApproval}
            onOpenResource={props.onOpenResource}
          />
        )}
      </For>
      <Show when={resource()}>
        {(linkedResource) => (
          <div class="omnidraw-ai-chat-history__resource-action">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                props.onOpenResource?.(linkedResource().id)
              }}
            >
              Open {linkedResource().name}
            </button>
          </div>
        )}
      </Show>
      <Show when={widgetDraft()}>
        {(draft) => (
          <div class="omnidraw-ai-chat-history__preview-action">
            <button
              type="button"
              disabled={previewPending()}
              onClick={(event) => {
                event.stopPropagation()
                requestPreview(draft().name)
              }}
            >
              {previewPending() ? "Preparing Preview…" : "Focus Preview"}
            </button>
          </div>
        )}
      </Show>
    </article>
  )
}

function ChatWorkingIndicator(props: { isCanceling: boolean }) {
  return (
    <div class="omnidraw-ai-chat-running" role="status" aria-live="polite">
      <span class="omnidraw-ai-chat-running__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{props.isCanceling ? "Stopping response" : "Assistant is working"}</span>
    </div>
  )
}

export function ChatTab(props: IProps) {
  let contentRoot!: HTMLDivElement
  let shouldAutoScroll = true
  let scrollAnimationFrame: number | undefined
  const browser = untrack(() => props.browser)
  const [editingEntryId, setEditingEntryId] = createSignal<string>()
  const [editText, setEditText] = createSignal("")
  const [editPending, setEditPending] = createSignal(false)
  const [resolvedComposerPreference, setResolvedComposerPreference] = createSignal<TChatComposerPreferenceChange>({})
  const reviewerModels = createMemo(() => {
    const configured = new Set(props.settings?.providersWithCredentials ?? [])
    return (props.settings?.models ?? []).filter((model) => configured.has(model.provider))
  })
  const visibleMessageHistory = createMemo(() => props.messageHistory.filter((item) => fnIsChatMessageVisible(item.message)))
  const visibleToolCallIds = createMemo(() => new Set(
    visibleMessageHistory().flatMap((item) => fnGetChatToolCalls(item.message).map((toolCall) => toolCall.id)),
  ))
  const floatingApprovals = () => props.approvals.filter((approval) => (
    approval.status === "pending" && !visibleToolCallIds().has(approval.toolCallId)
  ))

  const beginEdit = (item: TChatHistoryItem) => {
    if (!item.entryId || props.isRunning || props.isCanceling || props.isEditingHistory) return
    setEditingEntryId(item.entryId)
    setEditText(fnGetEditableChatMessageText(item.message))
  }

  const cancelEdit = () => {
    if (editPending()) return
    setEditingEntryId(undefined)
    setEditText("")
  }

  const sendEdit = () => {
    const entryId = editingEntryId()
    if (!entryId || editPending() || props.isRunning || props.isCanceling || props.isEditingHistory) return
    setEditPending(true)
    const preference = resolvedComposerPreference()
    const request = {
      entryId,
      text: editText(),
      model: preference.model,
      thinkingLevel: preference.thinkingLevel,
    }
    const settle = (accepted: boolean) => {
      if (accepted) {
        setEditingEntryId(undefined)
        setEditText("")
      }
      setEditPending(false)
    }
    props.lifecycle.startLatest("composer:edit", {
      run: () => props.onEditMessage(request),
      onSuccess: settle,
      onError: () => settle(false),
    })
  }

  const scrollToBottom = () => {
    contentRoot.scrollTop = contentRoot.scrollHeight
  }

  const scheduleScrollToBottom = () => {
    if (scrollAnimationFrame !== undefined) {
      browser.cancelAnimationFrame(scrollAnimationFrame)
    }

    scrollAnimationFrame = browser.requestAnimationFrame(() => {
      scrollAnimationFrame = undefined
      scrollToBottom()
    })
  }

  const submitPrompt = (submit: TChatComposerSubmit) => {
    const text = submit.text.trim()
    const hasImages = submit.images.length > 0

    if (!text && !hasImages) return

    props.lifecycle.startLatest("composer:prompt", {
      run: () => encodePromptImages(browser, submit.images),
      onSuccess(images) {
        if (!text && images.length === 0) return
        props.onPrompt({
        text,
        images,
        widgetRefs: submit.mentions.flatMap((mention) => mention.target?.type === "widget"
          ? [{ name: mention.target.name, source: mention.target.source }]
          : []),
        model: submit.model,
        thinkingLevel: submit.thinkingLevel,
        })
      },
      onError(error) {
        props.onReportError("attachment", error)
      },
    })
  }

  const copyChat = () => {
    const markdown = fnSerializeChatMessagesAsMarkdown(props.messageHistory.map((item) => item.message))

    if (!markdown) {
      return
    }

    props.lifecycle.startLatest("composer:copy", {
      run: () => browser.writeClipboardText(markdown),
      onSuccess: () => undefined,
      onError: props.onLogError,
    })
  }

  const getChatScrollSignal = () => [
    fnGetChatHistoryScrollKey(visibleMessageHistory()),
    props.isRunning ? "running" : "idle",
    props.isCanceling ? "canceling" : "active",
  ].join(":")

  const autoOpenedPreviewNames = new Set<string>()
  createEffect(() => {
    const onOpenWidgetPreview = props.onOpenWidgetPreview
    if (onOpenWidgetPreview === undefined) return
    const pendingNames = new Set(autoOpenedPreviewNames)
    const draftNames: string[] = []
    for (const item of visibleMessageHistory()) {
      const draft = fnGetToolResultWidgetDraft(item.message)
      if (draft === undefined || pendingNames.has(draft.name)) continue
      pendingNames.add(draft.name)
      draftNames.push(draft.name)
    }
    return { draftNames, lifecycle: props.lifecycle, onError: props.onLogError, onOpenWidgetPreview }
  }, (intent) => {
    if (!intent) return
    for (const name of intent.draftNames) {
      autoOpenedPreviewNames.add(name)
      intent.lifecycle.startLatest(`composer:preview:${name}`, {
        run: () => Promise.resolve(intent.onOpenWidgetPreview({ name })),
        onSuccess: () => undefined,
        onError: intent.onError,
      })
    }
  })

  createEffect(
    () => getChatScrollSignal(),
    () => {
      if (shouldAutoScroll) scheduleScrollToBottom()
    },
  )

  onSettled(() => {
    const lifecycle = props.lifecycle
    const updateAutoScroll = () => {
      shouldAutoScroll = isScrolledToBottom(contentRoot)
    }

    updateAutoScroll()
    contentRoot.addEventListener("scroll", updateAutoScroll, { passive: true })

    return () => {
      lifecycle.closeMatching("composer:")
      contentRoot.removeEventListener("scroll", updateAutoScroll)

      if (scrollAnimationFrame !== undefined) {
        browser.cancelAnimationFrame(scrollAnimationFrame)
      }
    }
  })

  return (
    <div class="omnidraw-ai-chat-tab omnidraw-ai-chat-tab--chat">
      <div ref={contentRoot} class="omnidraw-ai-chat-content">
        <Show when={visibleMessageHistory().length === 0 && !props.isRunning}>
          <div class="omnidraw-ai-chat-empty" aria-live="polite">
            Ask about your canvas or describe what you want to build.
          </div>
        </Show>
        <Show when={visibleMessageHistory().length > 0}>
          <div class="omnidraw-ai-chat-history" aria-live="polite">
            <For each={visibleMessageHistory()}>
              {(item) => (
                <ChatHistoryMessage
                  browser={props.browser}
                  lifecycle={props.lifecycle}
                  onLogError={props.onLogError}
                  item={item}
                  approvals={props.approvals}
                  onResolveApproval={props.onResolveApproval}
                  onOpenResource={props.onOpenResource}
                  onOpenWidgetPreview={props.onOpenWidgetPreview}
                  onReportError={props.onReportError}
                  onOpenSettings={props.onOpenSettings}
                  canEdit={!props.isRunning && !props.isCanceling && !props.isEditingHistory && !editPending()}
                  isEditing={item.entryId !== undefined && editingEntryId() === item.entryId}
                  editPending={editPending()}
                  editText={editText()}
                  onBeginEdit={() => beginEdit(item)}
                  onCancelEdit={cancelEdit}
                  onEditTextChange={setEditText}
                  onSendEdit={sendEdit}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={props.isRunning}>
          <ChatWorkingIndicator isCanceling={props.isCanceling} />
        </Show>
      </div>

      <div class="omnidraw-ai-chat-floating-approvals">
        <ApprovalList
          browser={props.browser}
          approvals={floatingApprovals()}
          onResolve={props.onResolveApproval}
          onOpenResource={props.onOpenResource}
          variant="floating"
        />
      </div>

      <Show when={props.widgetError}>
        {(error) => (
          <ChatWidgetErrorBanner
            error={error()}
            onDismiss={props.onDismissError}
            onOpenSettings={props.onOpenSettings}
            onRetry={props.onRetryError}
          />
        )}
      </Show>

      <ChatComposer
        browser={props.browser}
        placeholder="Ask about your canvas. Type @ to add context"
        mentions={props.mentions}
        models={props.settings?.models}
        reviewerModels={reviewerModels()}
        approvalPolicy={props.aiChatPreference?.approvalPolicy ?? { mode: "manual" }}
        defaultModel={props.aiChatPreference?.model?.modelId ?? props.settings?.defaultModel}
        defaultProvider={props.aiChatPreference?.model?.provider
          ?? props.settings?.defaultProvider
          ?? props.settings?.providersWithCredentials[0]}
        defaultThinkingLevel={props.aiChatPreference?.thinkingLevel ?? props.settings?.defaultThinkingLevel}
        isRunning={props.isRunning}
        isCanceling={props.isCanceling}
        isBusy={props.isEditingHistory}
        draftText={props.draftText}
        onDraftTextChange={props.onDraftTextChange}
        onPreferenceChange={props.onPreferenceChange}
        onResolvedPreferenceChange={setResolvedComposerPreference}
        onApprovalPolicyChange={props.onApprovalPolicyChange}
        onSubmit={submitPrompt}
        onCancel={props.onCancel}
        onNewChat={props.onNewChat}
        onCopyChat={copyChat}
      />
    </div>
  )
}
