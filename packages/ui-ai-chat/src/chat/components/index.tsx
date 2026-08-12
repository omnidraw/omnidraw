import { Match, Show, Switch, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { AsyncStateView } from "./AsyncStateView"
import { ChatTab } from "./tabs/ChatTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { fnCreateAiChatWidgetError } from "./fn.error"
import { fnFindApprovalResourceId, fnGetApprovalResourceId } from "./tabs/fn.tool-call"
import type { TAiChatApproval, TAiChatApprovalStatus, TAiChatWidgetError, TAiChatWidgetErrorKind } from "./types"
import type { TWidgetTitleBarPortal } from "../../widget/interface"
import type { TChatComposerMention, TChatPromptImage } from "./ChatComposer/interface"
import type { TAiChatApiPort, TAiChatApplicationPort, TAiChatBrowserPort } from "../../ports"
import { refreshMentionCatalog, subscribeMentionCatalog } from "../mention-catalog"
import { fnIsWidgetCatalogEventKind } from "../mention-catalog/fn.mention-catalog"
import { fnReplaceChatHistoryTail, type TChatHistoryItem } from "./tabs/fn.chat-history-edit"
import "./index.css"

type TAiChatThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
type TAiChatPreference = {
  model?: { provider: string; modelId: string }
  thinkingLevel?: TAiChatThinkingLevel
}
type TChatConnectIntent = { request: number; mode: "reuse" | "replace"; sessionId?: string }

interface IProps {
  id: string
  canvasId: string
  apiService: TAiChatApiPort
  application: TAiChatApplicationPort
  browser: TAiChatBrowserPort
  titleBar: TWidgetTitleBarPortal
  sessionId: string
  aiChatPreference?: TAiChatPreference
  onOpenWidgetPreview?: (args: { name: string }) => void | Promise<void>
  onAiChatPreferenceChange?: (preference: TAiChatPreference) => void
  onResetSessionId: () => string
}

type TAgentMessageRecord = Record<string, unknown>
function isAgentMessageRecord(message: unknown): message is TAgentMessageRecord {
  return typeof message === "object" && message !== null
}

function getAgentMessageKey(message: unknown) {
  if (!isAgentMessageRecord(message)) return undefined
  const role = typeof message.role === "string" ? message.role : "message"
  if (role === "toolResult" && typeof message.toolCallId === "string") return `${role}:tool:${message.toolCallId}`
  if (role === "assistant" && typeof message.responseId === "string") return `${role}:response:${message.responseId}`
  if (typeof message.timestamp === "number" || typeof message.timestamp === "string") return `${role}:time:${message.timestamp}`
  return undefined
}

function findAgentMessageIndex(messages: readonly unknown[], message: unknown) {
  const key = getAgentMessageKey(message)
  return key ? messages.findIndex((item) => getAgentMessageKey(item) === key) : -1
}

function withAgentMessageFinished(message: unknown, finished: boolean) {
  return isAgentMessageRecord(message) ? { ...message, __omnidrawMessageFinished: finished } : message
}

function withChatHistoryItemFinished(item: unknown): TChatHistoryItem {
  if (isAgentMessageRecord(item) && typeof item.entryId === "string" && "message" in item) {
    return { entryId: item.entryId, message: withAgentMessageFinished(item.message, true) }
  }
  return { message: withAgentMessageFinished(item, true) }
}

export function AiChat(props: IProps) {
  let approvalRequestId = 0
  let chatConnectRequestId = 0
  const refreshedApprovalIds = new Set<string>()
  const [selectedView, setSelectedView] = createSignal<"chat" | "settings">()
  const [sessionId, setSessionId] = createSignal(props.sessionId)
  const [isRunning, setIsRunning] = createSignal(false)
  const [isCanceling, setIsCanceling] = createSignal(false)
  const [chatDraftText, setChatDraftText] = createSignal("")
  const [localAiChatPreference, setLocalAiChatPreference] =
    createSignal<TAiChatPreference>({ ...(props.aiChatPreference ?? {}) })
  const [chatConnectIntent, setChatConnectIntent] = createSignal<TChatConnectIntent>({ request: 0, mode: "reuse" })
  const [eventStreamNonce, setEventStreamNonce] = createSignal(0)
  const [widgetError, setWidgetError] = createSignal<TAiChatWidgetError>()
  const [mentions, setMentions] = createSignal<TChatComposerMention[]>([])
  const [approvals, setApprovals] = createSignal<TAiChatApproval[]>([])
  const [isEditingHistory, setIsEditingHistory] = createSignal(false)
  const [messageHistory, setMessageHistory] = createStore<TChatHistoryItem[]>([])
  const [settingState, { refetch: refetchSettings }] = createResource(() => props.apiService.api.agent.settings.get({}).then(async ([error, data]) => {
    if (error) throw error.message
    return data
  }))

  const refreshApprovals = async (currentSessionId: string, connectRequestId: number) => {
    const requestId = ++approvalRequestId
    try {
      const [error, data] = await props.apiService.api.agent.approval.list({ widgetId: props.id, sessionId: currentSessionId })
      if (requestId !== approvalRequestId || connectRequestId !== chatConnectRequestId || sessionId() !== currentSessionId) return
      if (error) {
        reportWidgetError("approval", error)
        return
      }
      clearWidgetError("approval")
      setApprovals(data.map((approval) => ({
        ...approval,
        resourceId: fnGetApprovalResourceId(approval.details),
        status: "pending" as const,
      })))
    } catch (error) {
      if (requestId === approvalRequestId && connectRequestId === chatConnectRequestId && sessionId() === currentSessionId) {
        reportWidgetError("approval", error)
      }
    }
  }

  const setApprovalStatus = (approvalId: string, status: TAiChatApprovalStatus, statusMessage?: string) => {
    setApprovals((current) => current.map((approval) => approval.id === approvalId ? { ...approval, status, statusMessage } : approval))
  }

  const reportWidgetError = (kind: TAiChatWidgetErrorKind, error: unknown) => {
    setWidgetError(fnCreateAiChatWidgetError(kind, error))
  }

  const clearWidgetError = (...kinds: TAiChatWidgetErrorKind[]) => {
    setWidgetError((current) => current && kinds.includes(current.kind) ? undefined : current)
  }

  const refreshResourceCatalog = async (approvalId: string) => {
    if (refreshedApprovalIds.has(approvalId)) return
    refreshedApprovalIds.add(approvalId)
    props.application.invalidateResourceCatalog()
    const catalog = await refreshMentionCatalog(props.apiService)
    setApprovals((current) => current.map((approval) => approval.id === approvalId
      ? { ...approval, resourceId: fnFindApprovalResourceId(approval.details, catalog.resources) }
      : approval))
  }

  createEffect(() => {
    setLocalAiChatPreference({ ...(props.aiChatPreference ?? {}) })
  })

  createEffect(() => {
    const apiService = props.apiService
    const connectIntent = chatConnectIntent()
    const currentConnectRequestId = ++chatConnectRequestId
    const currentSessionId = sessionId()
    const connectMode = connectIntent.sessionId === currentSessionId ? connectIntent.mode : "reuse"
    approvalRequestId += 1
    setIsRunning(false)
    setIsCanceling(false)
    setIsEditingHistory(false)
    clearWidgetError("connection")
    void apiService.api.agent.chat.connect({
      canvasId: props.canvasId,
      sessionId: currentSessionId,
      widgetId: props.id,
      mode: connectMode,
    }).then(([error, data]) => {
      if (sessionId() !== currentSessionId || chatConnectRequestId !== currentConnectRequestId) return
      if (error) {
        reportWidgetError("connection", error)
        return
      }
      clearWidgetError("connection")
      setMessageHistory(reconcile(data.messageHistory.map(withChatHistoryItemFinished)))
      void refreshApprovals(currentSessionId, currentConnectRequestId)
    }).catch((error) => {
      if (sessionId() === currentSessionId && chatConnectRequestId === currentConnectRequestId) {
        reportWidgetError("connection", error)
      }
    })
  })

  const refreshChatHistory = async (currentSessionId: string, connectRequestId = chatConnectRequestId) => {
    try {
      const [error, data] = await props.apiService.api.agent.chat.history({ widgetId: props.id, sessionId: currentSessionId })
      if (sessionId() !== currentSessionId || chatConnectRequestId !== connectRequestId) return false
      if (error) {
        reportWidgetError("prompt", error)
        return false
      }
      setMessageHistory(reconcile(data.map(withChatHistoryItemFinished)))
      return true
    } catch (error) {
      if (sessionId() === currentSessionId && chatConnectRequestId === connectRequestId) {
        reportWidgetError("prompt", error)
      }
      return false
    }
  }

  const upsertMessage = (message: unknown, finished: boolean) => {
    const nextMessage = withAgentMessageFinished(message, finished)
    const index = findAgentMessageIndex(messageHistory.map((item) => item.message), message)
    if (index >= 0) setMessageHistory(index, "message", reconcile(nextMessage))
    else setMessageHistory(messageHistory.length, { message: nextMessage })
  }

  createEffect(() => {
    const apiService = props.apiService
    const currentSessionId = sessionId()
    const currentEventStreamNonce = eventStreamNonce()
    let disposed = false
    let closeEventStream: (() => void) | undefined

    void apiService.api.agent.events({}).then(async ([error, events]) => {
      if (error) {
        if (!disposed) reportWidgetError("stream", error)
        return
      }
      clearWidgetError("stream")
      const iterator = events[Symbol.asyncIterator]()
      let eventStreamClosed = false
      closeEventStream = () => {
        if (eventStreamClosed) return
        eventStreamClosed = true
        try {
          const closing = iterator.return?.()
          if (closing) void Promise.resolve(closing).catch(() => undefined)
        } catch {
          // Cleanup must remain safe when a stream closes synchronously.
        }
      }
      if (disposed) {
        closeEventStream()
        return
      }

      while (!disposed) {
        const next = await iterator.next()
        if (next.done || disposed) break
        const event = next.value

        if (!("kind" in event)) {
          if (event.widgetId !== props.id || event.sessionId !== currentSessionId) continue
          const piEvent = event.event
          if ("kind" in piEvent) continue
          if (piEvent.type === "agent_start" || piEvent.type === "turn_start") {
            setIsRunning(true)
            setIsCanceling(false)
          } else if (piEvent.type === "agent_end") {
            piEvent.messages.forEach((message) => upsertMessage(message, true))
            setIsRunning(piEvent.willRetry)
            if (!piEvent.willRetry) setIsCanceling(false)
            if (!piEvent.willRetry) {
              void refreshChatHistory(currentSessionId, chatConnectRequestId)
                .then(() => refreshApprovals(currentSessionId, chatConnectRequestId))
            }
          } else if (piEvent.type === "message_start" || piEvent.type === "message_update") {
            setIsRunning(true)
            upsertMessage(piEvent.message, false)
          } else if (piEvent.type === "message_end" || piEvent.type === "turn_end") {
            upsertMessage(piEvent.message, true)
          }
          continue
        }

        if (event.kind === "approval" && event.widgetId === props.id && event.sessionId === currentSessionId) {
          if (event.type === "created") {
            const incoming = {
              ...event.approval,
              resourceId: fnGetApprovalResourceId(event.approval.details),
              status: "pending" as const,
            }
            setApprovals((current) => [...current.filter((approval) => approval.id !== incoming.id), incoming])
          } else if (event.type === "resolved") {
            const status = event.decision === "approve" ? "executed" : "rejected"
            setApprovals((current) => [{
              ...event.approval,
              resourceId: fnGetApprovalResourceId(event.approval.details),
              status,
              statusMessage: event.approval.reviewerReason,
            }, ...current.filter((approval) => approval.id !== event.approval.id)])
            if (event.decision === "approve") void refreshResourceCatalog(event.approval.id)
          } else {
            const status = event.reason === "execution-failed" ? "failed" : "stale"
            setApprovals((current) => [{
              ...event.approval,
              resourceId: fnGetApprovalResourceId(event.approval.details),
              status,
              statusMessage: event.reason,
            }, ...current.filter((approval) => approval.id !== event.approval.id)])
          }
          continue
        }
        if (fnIsWidgetCatalogEventKind(event.kind)) void refreshMentionCatalog(props.apiService)
      }
    }).catch((error) => {
      if (!disposed && eventStreamNonce() === currentEventStreamNonce) {
        reportWidgetError("stream", error)
        void refreshChatHistory(currentSessionId, chatConnectRequestId)
      }
    })

    onCleanup(() => {
      disposed = true
      closeEventStream?.()
    })
  })

  onMount(() => {
    const unsubscribeMentions = subscribeMentionCatalog(props.apiService, (catalog) => setMentions(catalog.mentions))
    const unsubscribeResources = props.application.subscribeCatalogInvalidation?.("resources", () => {
      void refreshMentionCatalog(props.apiService)
    })
    const unsubscribeWidgets = props.application.subscribeCatalogInvalidation?.("widgets", () => {
      void refreshMentionCatalog(props.apiService)
    })
    const removeSettingsAction = props.titleBar.onAction("settings", () => {
      setSelectedView(activeView() === "settings" ? "chat" : "settings")
    })
    onCleanup(() => {
      removeSettingsAction()
      unsubscribeMentions()
      unsubscribeResources?.()
      unsubscribeWidgets?.()
    })
  })

  const updateAiChatPreference = (preference: TAiChatPreference) => {
    const nextPreference = { ...localAiChatPreference(), ...preference }
    setLocalAiChatPreference(nextPreference)
    props.onAiChatPreferenceChange?.(nextPreference)
  }

  const prompt = async (args: { text: string; images: TChatPromptImage[]; widgetRefs?: Array<{ name: string; source: "draft" | "published" }>; model?: { id: string; provider: string }; thinkingLevel: TAiChatThinkingLevel }) => {
    const currentSessionId = sessionId()
    clearWidgetError("prompt", "attachment")
    setIsRunning(true)
    setIsCanceling(false)
    updateAiChatPreference({
      model: args.model ? { provider: args.model.provider, modelId: args.model.id } : undefined,
      thinkingLevel: args.thinkingLevel,
    })
    let error: unknown
    try {
      [error] = await props.apiService.api.agent.chat.prompt({
        canvasId: props.canvasId,
        widgetId: props.id,
        sessionId: currentSessionId,
        text: args.text,
        images: args.images,
        widgetRefs: args.widgetRefs,
        model: args.model ? { provider: args.model.provider, modelId: args.model.id } : undefined,
        thinkingLevel: args.thinkingLevel,
      })
    } catch (caughtError) {
      error = caughtError
    }
    if (sessionId() !== currentSessionId) return
    setIsRunning(false)
    setIsCanceling(false)
    if (error) reportWidgetError("prompt", error)
    await refreshChatHistory(currentSessionId)
  }

  const cancelPrompt = async () => {
    if (isCanceling()) return
    const currentSessionId = sessionId()
    const wasRunning = isRunning()
    setIsCanceling(true)
    let error: unknown
    let data: { running: boolean } | undefined
    try {
      [error, data] = await props.apiService.api.agent.chat.cancel({ widgetId: props.id, sessionId: currentSessionId })
    } catch (caughtError) {
      error = caughtError
    }
    if (sessionId() !== currentSessionId) return
    setIsCanceling(false)
    setIsRunning(error ? wasRunning : data?.running ?? false)
    if (error) reportWidgetError("cancel", error)
    else clearWidgetError("cancel")
    await refreshChatHistory(currentSessionId)
    await refreshApprovals(currentSessionId, chatConnectRequestId)
  }

  const editMessage = async (args: { entryId: string; text: string; model?: TAiChatPreference["model"]; thinkingLevel?: TAiChatThinkingLevel }) => {
    if (isRunning() || isCanceling() || isEditingHistory()) return false
    const optimistic = fnReplaceChatHistoryTail(messageHistory, args.entryId, args.text)
    if (!optimistic) return false
    const currentSessionId = sessionId()
    setIsEditingHistory(true)
    setIsCanceling(false)
    clearWidgetError("prompt")
    setMessageHistory(reconcile(optimistic))
    let error: unknown
    let data: Array<{ entryId: string; message: unknown }> | undefined
    try {
      try {
        [error, data] = await props.apiService.api.agent.chat.edit({
          canvasId: props.canvasId,
          widgetId: props.id,
          sessionId: currentSessionId,
          entryId: args.entryId,
          text: args.text,
          model: args.model,
          thinkingLevel: args.thinkingLevel,
        })
      } catch (caughtError) {
        error = caughtError
      }
      if (sessionId() !== currentSessionId) return false
      if (!error && data) {
        setMessageHistory(reconcile(data.map(withChatHistoryItemFinished)))
      } else {
        await refreshChatHistory(currentSessionId)
      }
      await refreshApprovals(currentSessionId, chatConnectRequestId)
      if (error) reportWidgetError("prompt", error)
      return !error && data !== undefined
    } finally {
      if (sessionId() === currentSessionId) {
        setIsRunning(false)
        setIsCanceling(false)
        setIsEditingHistory(false)
      }
    }
  }

  const newChat = () => {
    const previousSessionId = sessionId()
    const nextSessionId = props.onResetSessionId()
    setIsRunning(false)
    setIsCanceling(false)
    setIsEditingHistory(false)
    setChatDraftText("")
    setMessageHistory(reconcile([]))
    setApprovals([])
    setWidgetError(undefined)
    refreshedApprovalIds.clear()
    setSessionId(nextSessionId)
    props.onAiChatPreferenceChange?.(localAiChatPreference())
    void props.apiService.api.agent.chat.newSession({ widgetId: props.id, sessionId: previousSessionId })
  }

  const resolveApproval = async (approvalId: string, decision: "approve" | "reject") => {
    setApprovalStatus(approvalId, "executing")
    const [error] = await props.apiService.api.agent.approval.resolve({
      widgetId: props.id,
      sessionId: sessionId(),
      approvalId,
      decision,
    })
    if (error) {
      const stale = /not found|no longer pending|already/i.test(error.message)
      setApprovalStatus(approvalId, stale ? "stale" : "failed", error.message)
      return
    }
    setApprovalStatus(approvalId, decision === "approve" ? "executed" : "rejected")
    if (decision === "approve") await refreshResourceCatalog(approvalId)
  }

  const refreshSettingsAndReconnectChat = async () => {
    await refetchSettings()
    setChatConnectIntent((current) => ({ request: current.request + 1, mode: "replace", sessionId: sessionId() }))
  }

  const openSettings = () => {
    setSelectedView("settings")
  }

  const retryWidgetError = () => {
    const currentError = widgetError()
    if (currentError?.kind === "connection") setChatConnectIntent((current) => ({ request: current.request + 1, mode: "reuse", sessionId: sessionId() }))
    if (currentError?.kind === "stream") setEventStreamNonce((nonce) => nonce + 1)
  }

  const aiAuthenticated = () => (settingState.latest?.providersWithCredentials.length ?? 0) > 0
  const activeView = createMemo(() => selectedView() ?? (aiAuthenticated() ? "chat" : "settings"))
  createEffect(() => {
    props.titleBar.setActionState("settings", {
      pressed: activeView() === "settings",
      label: activeView() === "settings" ? "Back to chat" : "Settings",
    })
  })
  return (
    <div class="ai-chat-shell">
      <Switch fallback={(
        <div class="ai-chat-surface">
          <main class="ai-chat-body">
            <section class="ai-chat-view" hidden={activeView() !== "chat"} aria-hidden={activeView() !== "chat"}>
              <Show when={sessionId()} keyed>
                {(_activeSessionId) => (
                  <ChatTab
                    settings={settingState.latest}
                    aiChatPreference={localAiChatPreference()}
                    messageHistory={messageHistory}
                    approvals={approvals()}
                    isRunning={isRunning()}
                    isCanceling={isCanceling()}
                    isEditingHistory={isEditingHistory()}
                    widgetError={widgetError()}
                    draftText={chatDraftText()}
                    mentions={mentions()}
                    onDraftTextChange={setChatDraftText}
                    onPreferenceChange={updateAiChatPreference}
                    onPrompt={prompt}
                    onEditMessage={editMessage}
                    onResolveApproval={resolveApproval}
                    onOpenResource={props.application.openResource}
                    onOpenWidgetPreview={props.onOpenWidgetPreview}
                    browser={props.browser}
                    onLogError={props.application.logError}
                    onCancel={() => void cancelPrompt()}
                    onDismissError={() => setWidgetError(undefined)}
                    onOpenSettings={openSettings}
                    onReportError={reportWidgetError}
                    onRetryError={retryWidgetError}
                    onNewChat={newChat}
                  />
                )}
              </Show>
            </section>
            <Show when={activeView() === "settings"}>
              <section class="ai-chat-view ai-chat-view--settings">
                <SettingsTab settings={settingState.latest} apiService={props.apiService} browser={props.browser} onSettingsChanged={() => void refreshSettingsAndReconnectChat()} />
              </section>
            </Show>
          </main>
        </div>
      )}>
        <Match when={settingState.loading}>
          <AsyncStateView variant="loading" title="Loading AI chat" message="Fetching agent settings." />
        </Match>
        <Match when={settingState.error}>
          {(error) => <AsyncStateView variant="error" title="Could not load AI chat" message={String(error())} actionLabel="Try again" onAction={() => void refetchSettings()} />}
        </Match>
      </Switch>

    </div>
  )
}
