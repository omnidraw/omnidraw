import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { AsyncStateView } from "./AsyncStateView"
import { ChatTab } from "./tabs/ChatTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { fnCreateAiChatWidgetError } from "./fn.error"
import { fnFindApprovalResourceId, fnGetApprovalResourceId } from "./tabs/fn.tool-call"
import type { TAiChatApproval, TAiChatApprovalStatus, TAiChatWidgetError, TAiChatWidgetErrorKind } from "./types"
import type { TChatComposerMention, TChatPromptImage } from "./ChatComposer/interface"
import { createMentionCatalog } from "../mention-catalog"
import { fnReplaceChatHistoryTail, type TChatHistoryItem } from "./tabs/fn.chat-history-edit"
import type {
  TAiChatPreference,
  TAiChatApprovalPolicy,
  TAiChatProps,
  TAiChatSettings,
  TAiChatStreamEvent,
  TAiChatThinkingLevel,
} from "../../contracts.js"
import { AiChatEffectRuntime } from "../../internal/stream-lifecycle.js"
import "../../styles.css"

type TChatConnectIntent = { revision: number; mode: "reuse" | "replace"; sessionId?: string }

function aiChatPreference(preference?: TAiChatPreference): TAiChatPreference {
  return Object.freeze({
    approvalPolicy: preference?.approvalPolicy ?? Object.freeze({ mode: "manual" }),
    ...(preference?.model === undefined ? {} : { model: preference.model }),
    ...(preference?.thinkingLevel === undefined ? {} : { thinkingLevel: preference.thinkingLevel }),
  })
}

function sameApprovalPolicy(left: TAiChatApprovalPolicy, right: TAiChatApprovalPolicy): boolean {
  return left.mode === right.mode
    && (left.mode !== "ai-review" || (
      right.mode === "ai-review"
      && left.reviewerModel.provider === right.reviewerModel.provider
      && left.reviewerModel.modelId === right.reviewerModel.modelId
    ))
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

export function AiChat(props: TAiChatProps) {
  const lifecycleRuntime = new AiChatEffectRuntime()
  const mentionCatalog = createMentionCatalog(props.port, lifecycleRuntime)
  const refreshedApprovalIds = new Set<string>()
  const [selectedView, setSelectedView] = createSignal<"chat" | "settings">()
  const [sessionId, setSessionId] = createSignal(props.sessionId)
  const [isRunning, setIsRunning] = createSignal(false)
  const [isCanceling, setIsCanceling] = createSignal(false)
  const [chatDraftText, setChatDraftText] = createSignal("")
  const [localAiChatPreference, setLocalAiChatPreference] =
    createSignal<TAiChatPreference>(aiChatPreference(props.preference))
  const [chatConnectIntent, setChatConnectIntent] = createSignal<TChatConnectIntent>({ revision: 0, mode: "reuse" })
  const [eventStreamRestart, setEventStreamRestart] = createSignal(0)
  const [widgetError, setWidgetError] = createSignal<TAiChatWidgetError>()
  const [mentions, setMentions] = createSignal<TChatComposerMention[]>([])
  const [approvals, setApprovals] = createSignal<TAiChatApproval[]>([])
  const [isEditingHistory, setIsEditingHistory] = createSignal(false)
  const [messageHistory, setMessageHistory] = createStore<TChatHistoryItem[]>([])
  const [settingState, setSettingState] = createSignal<Readonly<{
    loading: boolean
    latest?: TAiChatSettings
    error?: unknown
  }>>({ loading: true })

  const loadSettings = (onSuccess?: () => void) => {
    setSettingState((current) => ({ ...current, loading: true, error: undefined }))
    lifecycleRuntime.startLatest("settings:load", {
      run: () => props.port.actions.getSettings(),
      onSuccess(settings) {
        setSettingState({ loading: false, latest: settings })
        onSuccess?.()
      },
      onError(error) {
        setSettingState((current) => ({ ...current, loading: false, error }))
      },
    })
  }

  const refreshApprovals = (currentSessionId: string) => {
    lifecycleRuntime.startLatest("session:approvals", {
      run: () => props.port.actions.listApprovals({
        componentId: props.id,
        sessionId: currentSessionId,
      }),
      onSuccess(data) {
        if (sessionId() !== currentSessionId) return
        clearWidgetError("approval")
        setApprovals(data.map((approval) => ({
          ...approval,
          resourceId: fnGetApprovalResourceId(approval.details),
          status: "pending" as const,
        })))
      },
      onError(error) {
        if (sessionId() !== currentSessionId) return
        reportWidgetError("approval", error)
      },
    })
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

  const refreshResourceCatalog = (approvalId: string) => {
    if (refreshedApprovalIds.has(approvalId)) return
    refreshedApprovalIds.add(approvalId)
    props.host.invalidateCatalog?.("resources")
    mentionCatalog.refresh({
      onSuccess(catalog) {
        setApprovals((current) => current.map((approval) => approval.id === approvalId
          ? { ...approval, resourceId: fnFindApprovalResourceId(approval.details, catalog.resources) }
          : approval))
      },
      onError(error) {
        refreshedApprovalIds.delete(approvalId)
        props.host.logError(error)
      },
    })
  }

  createEffect(() => {
    setLocalAiChatPreference(aiChatPreference(props.preference))
  })

  createEffect(() => {
    const nextSessionId = props.sessionId
    if (nextSessionId === sessionId()) return
    refreshedApprovalIds.clear()
    setSessionId(nextSessionId)
  })

  createEffect(() => {
    const port = props.port
    const connectIntent = chatConnectIntent()
    const currentSessionId = sessionId()
    const connectMode = connectIntent.sessionId === currentSessionId ? connectIntent.mode : "reuse"
    const approvalPolicy = untrack(() => localAiChatPreference().approvalPolicy)
    lifecycleRuntime.closeMatching("session:")
    setIsRunning(false)
    setIsCanceling(false)
    setIsEditingHistory(false)
    clearWidgetError("connection")
    const lifecycle = lifecycleRuntime.startLatest("connect", {
      run: () => port.actions.connect({
        canvasId: props.canvasId,
        sessionId: currentSessionId,
        componentId: props.id,
        approvalPolicy,
        mode: connectMode,
      }),
      onSuccess(completion) {
        if (sessionId() !== currentSessionId) return
        clearWidgetError("connection")
        setMessageHistory(reconcile(completion.history.map(withChatHistoryItemFinished)))
        refreshApprovals(currentSessionId)
      },
      onError(error) {
        if (sessionId() === currentSessionId) {
          reportWidgetError("connection", error)
        }
      },
    })
    onCleanup(lifecycle.close)
  })

  const refreshChatHistory = (
    currentSessionId: string,
    options: Readonly<{ kind?: TAiChatWidgetErrorKind; onSuccess?(): void }> = {},
  ) => {
    lifecycleRuntime.startLatest("session:history", {
      run: () => props.port.actions.getHistory({
        componentId: props.id,
        sessionId: currentSessionId,
      }),
      onSuccess(data) {
        if (sessionId() !== currentSessionId) return
        setMessageHistory(reconcile(data.map(withChatHistoryItemFinished)))
        options.onSuccess?.()
      },
      onError(error) {
        if (sessionId() === currentSessionId) reportWidgetError(options.kind ?? "prompt", error)
      },
    })
  }

  const upsertMessage = (message: unknown, finished: boolean) => {
    const nextMessage = withAgentMessageFinished(message, finished)
    const index = findAgentMessageIndex(messageHistory.map((item) => item.message), message)
    if (index >= 0) setMessageHistory(index, "message", reconcile(nextMessage))
    else setMessageHistory(messageHistory.length, { message: nextMessage })
  }

  createEffect(() => {
    const currentSessionId = sessionId()
    const approvalPolicy = localAiChatPreference().approvalPolicy
    eventStreamRestart()
    const onEvent = (event: TAiChatStreamEvent): void => {
      if (event.kind === "catalog") {
        mentionCatalog.refresh()
        try {
          props.host.invalidateCatalog?.(event.catalog)
        } catch (error) {
          props.host.logError(error)
        }
        return
      }
      if (
        event.componentId !== props.id
        || event.sessionId !== currentSessionId
      ) return
      if (event.kind === "session") {
        const update = event.event
        if (update.type === "agent-start" || update.type === "turn-start") {
          setIsRunning(true)
          setIsCanceling(false)
        } else if (update.type === "agent-end") {
          update.messages.forEach((message) => upsertMessage(message, true))
          setIsRunning(update.willRetry)
          if (!update.willRetry) {
            setIsCanceling(false)
            refreshChatHistory(currentSessionId, {
              onSuccess: () => refreshApprovals(currentSessionId),
            })
          }
        } else if (update.type === "message-start" || update.type === "message-update") {
          setIsRunning(true)
          upsertMessage(update.message, false)
        } else if (update.type === "message-end" || update.type === "turn-end") {
          upsertMessage(update.message, true)
        }
        return
      }
      if (event.type === "created") {
        const incoming = {
          ...event.approval,
          resourceId: fnGetApprovalResourceId(event.approval.details),
          status: "pending" as const,
        }
        setApprovals((current) => [
          ...current.filter((approval) => approval.id !== incoming.id),
          incoming,
        ])
      } else if (event.type === "resolved") {
        const status = event.decision === "approve" ? "executed" : "rejected"
        setApprovals((current) => [{
          ...event.approval,
          resourceId: fnGetApprovalResourceId(event.approval.details),
          status,
          statusMessage: event.approval.reviewerReason,
        }, ...current.filter((approval) => approval.id !== event.approval.id)])
        if (event.decision === "approve") refreshResourceCatalog(event.approval.id)
      } else {
        const status = event.reason === "execution-failed" ? "failed" : "stale"
        setApprovals((current) => [{
          ...event.approval,
          resourceId: fnGetApprovalResourceId(event.approval.details),
          status,
          statusMessage: event.reason,
        }, ...current.filter((approval) => approval.id !== event.approval.id)])
      }
    }
    const lifecycle = lifecycleRuntime.startStream({
      open: (signal) => props.port.events({
        componentId: props.id,
        sessionId: currentSessionId,
        approvalPolicy,
      }, { signal }),
      onEvent,
      onError(error) {
        reportWidgetError("stream", error)
        refreshChatHistory(currentSessionId, { kind: "stream" })
      },
      onEnd() {
        reportWidgetError("stream", new Error("The AI Chat event stream ended."))
      },
    })
    clearWidgetError("stream")
    onCleanup(lifecycle.close)
  })

  onMount(() => {
    loadSettings()
    const unsubscribeMentions = mentionCatalog.subscribe((catalog) => setMentions([...catalog.mentions]))
    const unsubscribeResources = props.host.subscribeCatalogInvalidation?.("resources", () => {
      mentionCatalog.refresh()
    })
    const unsubscribeWidgets = props.host.subscribeCatalogInvalidation?.("widgets", () => {
      mentionCatalog.refresh()
    })
    const unsubscribeReconnect = props.port.subscribeReconnect?.(() => {
      setChatConnectIntent((current) => ({
        revision: current.revision + 1,
        mode: "reuse",
        sessionId: sessionId(),
      }))
      setEventStreamRestart((revision) => revision + 1)
    })
    const removeSettingsAction = props.titleBar.onAction("settings", () => {
      setSelectedView(activeView() === "settings" ? "chat" : "settings")
    })
    onCleanup(() => {
      removeSettingsAction()
      unsubscribeMentions()
      unsubscribeResources?.()
      unsubscribeWidgets?.()
      unsubscribeReconnect?.()
    })
  })

  onCleanup(() => {
    mentionCatalog.dispose()
    void lifecycleRuntime.dispose()
  })

  const updateAiChatPreference = (preference: Partial<TAiChatPreference>) => {
    const currentPreference = localAiChatPreference()
    const nextPreference = { ...currentPreference, ...preference }
    if (
      currentPreference.model?.provider === nextPreference.model?.provider
      && currentPreference.model?.modelId === nextPreference.model?.modelId
      && currentPreference.thinkingLevel === nextPreference.thinkingLevel
      && sameApprovalPolicy(currentPreference.approvalPolicy, nextPreference.approvalPolicy)
    ) return
    setLocalAiChatPreference(nextPreference)
    props.onPreferenceChange?.(nextPreference)
    props.onStateChange?.({ sessionId: sessionId(), preference: nextPreference })
  }

  const updateApprovalPolicy = (policy: TAiChatApprovalPolicy): Promise<boolean> => {
    const currentSessionId = sessionId()
    if (sameApprovalPolicy(localAiChatPreference().approvalPolicy, policy)) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      lifecycleRuntime.startLatest("session:approval-policy", {
        run: () => props.port.actions.setApprovalPolicy({
          componentId: props.id,
          sessionId: currentSessionId,
          policy,
        }),
        onSuccess(saved) {
          if (sessionId() !== currentSessionId) return finish(false)
          clearWidgetError("approval")
          updateAiChatPreference({ approvalPolicy: saved })
          finish(true)
        },
        onError(error) {
          if (sessionId() === currentSessionId) reportWidgetError("approval", error)
          finish(false)
        },
        onFinally: () => finish(false),
      })
    })
  }

  const prompt = (args: { text: string; images: TChatPromptImage[]; widgetRefs?: Array<{ name: string; source: "draft" | "published" }>; model?: { id: string; provider: string }; thinkingLevel: TAiChatThinkingLevel }) => {
    const currentSessionId = sessionId()
    clearWidgetError("prompt", "attachment")
    setIsRunning(true)
    setIsCanceling(false)
    updateAiChatPreference({
      model: args.model ? { provider: args.model.provider, modelId: args.model.id } : undefined,
      thinkingLevel: args.thinkingLevel,
    })
    const settle = (error?: unknown) => {
      if (sessionId() !== currentSessionId) return
      setIsRunning(false)
      setIsCanceling(false)
      if (error !== undefined) reportWidgetError("prompt", error)
      refreshChatHistory(currentSessionId)
    }
    lifecycleRuntime.startLatest("session:prompt", {
      run: () => props.port.actions.prompt({
        canvasId: props.canvasId,
        componentId: props.id,
        sessionId: currentSessionId,
        text: args.text,
        images: args.images,
        widgetRefs: args.widgetRefs,
        model: args.model ? { provider: args.model.provider, modelId: args.model.id } : undefined,
        thinkingLevel: args.thinkingLevel,
      }),
      onSuccess: () => settle(),
      onError: settle,
    })
  }

  const cancelPrompt = () => {
    if (isCanceling()) return
    const currentSessionId = sessionId()
    const wasRunning = isRunning()
    lifecycleRuntime.close("session:prompt")
    setIsCanceling(true)
    const finish = (running: boolean, error?: unknown) => {
      if (sessionId() !== currentSessionId) return
      setIsCanceling(false)
      setIsRunning(running)
      if (error !== undefined) reportWidgetError("cancel", error)
      else clearWidgetError("cancel")
      refreshChatHistory(currentSessionId, {
        onSuccess: () => refreshApprovals(currentSessionId),
      })
    }
    lifecycleRuntime.startLatest("session:cancel", {
      run: () => props.port.actions.cancel({
        componentId: props.id,
        sessionId: currentSessionId,
      }),
      onSuccess: (data) => finish(data.running),
      onError: (error) => finish(wasRunning, error),
    })
  }

  const editMessage = (
    args: { entryId: string; text: string; model?: TAiChatPreference["model"]; thinkingLevel?: TAiChatThinkingLevel },
  ): Promise<boolean> => {
    if (isRunning() || isCanceling() || isEditingHistory()) return Promise.resolve(false)
    const optimistic = fnReplaceChatHistoryTail(messageHistory, args.entryId, args.text)
    if (!optimistic) return Promise.resolve(false)
    const currentSessionId = sessionId()
    setIsEditingHistory(true)
    setIsCanceling(false)
    clearWidgetError("prompt")
    setMessageHistory(reconcile(optimistic))
    return new Promise<boolean>((resolve) => lifecycleRuntime.startLatest("session:edit", {
      run: () => props.port.actions.edit({
          canvasId: props.canvasId,
          componentId: props.id,
          sessionId: currentSessionId,
          entryId: args.entryId,
          text: args.text,
          model: args.model,
          thinkingLevel: args.thinkingLevel,
      }),
      onSuccess(data) {
        if (sessionId() !== currentSessionId) return
        setMessageHistory(reconcile([...data].map(withChatHistoryItemFinished)))
        refreshApprovals(currentSessionId)
        resolve(true)
      },
      onError(error) {
        if (sessionId() !== currentSessionId) return
        refreshChatHistory(currentSessionId)
        refreshApprovals(currentSessionId)
        reportWidgetError("prompt", error)
        resolve(false)
      },
      onFinally() {
        if (sessionId() === currentSessionId) {
        setIsRunning(false)
        setIsCanceling(false)
        setIsEditingHistory(false)
        }
      },
    }))
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
    lifecycleRuntime.closeMatching("session:")
    setSessionId(nextSessionId)
    const nextPreference = Object.freeze({
      ...localAiChatPreference(),
      approvalPolicy: Object.freeze({ mode: "manual" as const }),
    })
    setLocalAiChatPreference(nextPreference)
    props.onPreferenceChange?.(nextPreference)
    props.onStateChange?.({
      sessionId: nextSessionId,
      preference: nextPreference,
    })
    lifecycleRuntime.startLatest(`reset-session:${previousSessionId}`, {
      run: () => props.port.actions.resetSession({
        componentId: props.id,
        sessionId: previousSessionId,
      }),
      onSuccess: () => undefined,
      onError: props.host.logError,
    })
  }

  const resolveApproval = (approvalId: string, decision: "approve" | "reject") => {
    const currentSessionId = sessionId()
    setApprovalStatus(approvalId, "executing")
    lifecycleRuntime.startLatest(`session:approval:${approvalId}`, {
      run: () => props.port.actions.resolveApproval({
        componentId: props.id,
        sessionId: currentSessionId,
        approvalId,
        decision,
      }),
      onSuccess() {
        if (sessionId() !== currentSessionId) return
        setApprovalStatus(approvalId, decision === "approve" ? "executed" : "rejected")
        if (decision === "approve") refreshResourceCatalog(approvalId)
      },
      onError(error) {
        if (sessionId() !== currentSessionId) return
        const message = error instanceof Error ? error.message : String(error)
        const stale = /not found|no longer pending|already/i.test(message)
        setApprovalStatus(approvalId, stale ? "stale" : "failed", message)
      },
    })
  }

  const refreshSettingsAndReconnectChat = () => {
    loadSettings(() => {
      setChatConnectIntent((current) => ({ revision: current.revision + 1, mode: "replace", sessionId: sessionId() }))
    })
  }

  const openSettings = () => {
    setSelectedView("settings")
  }

  const retryWidgetError = () => {
    const currentError = widgetError()
    if (currentError?.kind === "connection") setChatConnectIntent((current) => ({ revision: current.revision + 1, mode: "reuse", sessionId: sessionId() }))
    if (currentError?.kind === "stream") setEventStreamRestart((revision) => revision + 1)
  }

  const aiAuthenticated = () => (settingState().latest?.providersWithCredentials.length ?? 0) > 0
  const activeView = createMemo(() => selectedView() ?? (
    settingState().loading || aiAuthenticated() ? "chat" : "settings"
  ))
  createEffect(() => {
    props.titleBar.setActionState("settings", {
      pressed: activeView() === "settings",
      label: activeView() === "settings" ? "Back to chat" : "Settings",
    })
  })
  return (
    <div class="omnidraw-ai-chat-shell">
      <Switch fallback={(
        <div class="omnidraw-ai-chat-surface">
          <main class="omnidraw-ai-chat-body">
            <section class="omnidraw-ai-chat-view" hidden={activeView() !== "chat"} aria-hidden={activeView() !== "chat"}>
              <Show when={sessionId()} keyed>
                {(_activeSessionId) => (
                  <ChatTab
                    lifecycle={lifecycleRuntime}
                    settings={settingState().latest}
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
                    onApprovalPolicyChange={updateApprovalPolicy}
                    onPrompt={prompt}
                    onEditMessage={editMessage}
                    onResolveApproval={resolveApproval}
                    onOpenResource={props.host.openResource}
                    onOpenWidgetPreview={props.host.openWidgetPreview}
                    browser={props.browser}
                    onLogError={props.host.logError}
                    onCancel={cancelPrompt}
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
              <section class="omnidraw-ai-chat-view omnidraw-ai-chat-view--settings">
                <SettingsTab settings={settingState().latest} actions={props.port.actions} lifecycle={lifecycleRuntime} onSettingsChanged={refreshSettingsAndReconnectChat} />
              </section>
            </Show>
          </main>
        </div>
      )}>
        <Match when={settingState().loading}>
          <AsyncStateView variant="loading" title="Loading AI chat" message="Fetching agent settings." />
        </Match>
        <Match when={settingState().error}>
          {(error) => <AsyncStateView variant="error" title="Could not load AI chat" message={String(error())} actionLabel="Try again" onAction={() => loadSettings()} />}
        </Match>
      </Switch>

    </div>
  )
}
