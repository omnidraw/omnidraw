import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { Match, Show, Switch, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { AsyncStateView } from "./AsyncStateView"
import { ChatTab } from "./tabs/ChatTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { fnFindApprovalResourceId, fnGetApprovalResourceId } from "./tabs/fn.tool-call"
import type { TAiChatApproval, TAiChatApprovalStatus } from "./types"
import type { TWidgetTitleBarPortal } from "../../services/widget/interface"
import type { TChatComposerMention, TChatPromptImage } from "./ChatComposer/interface"
import "./index.css"

type TAiChatThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
type TAiChatPreference = {
  model?: { provider: string; modelId: string }
  thinkingLevel?: TAiChatThinkingLevel
}

interface IProps {
  id: string
  apiService: TOrpcSafeClient
  titleBar: TWidgetTitleBarPortal
  sessionId: string
  aiChatPreference?: TAiChatPreference
  onAiChatPreferenceChange?: (preference: TAiChatPreference) => void
  onResetSessionId: () => string
  onOpenResource?: (resourceId: string) => void
  onResourceCatalogChanged?: () => void
}

type TAgentMessageRecord = Record<string, unknown>
type TAiChatResource = {
  id: string
  kind: "kv" | "secretStore" | "db"
  name: string
  status: "created" | "provisioning" | "ready" | "migrating" | "error" | "deleting"
}

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
  return isAgentMessageRecord(message) ? { ...message, __vibecanvasMessageFinished: finished } : message
}

export function AiChat(props: IProps) {
  let approvalRequestId = 0
  const refreshedApprovalIds = new Set<string>()
  const [selectedView, setSelectedView] = createSignal<"chat" | "settings">()
  const [sessionId, setSessionId] = createSignal(props.sessionId)
  const [isRunning, setIsRunning] = createSignal(false)
  const [isCanceling, setIsCanceling] = createSignal(false)
  const [chatDraftText, setChatDraftText] = createSignal("")
  const [localAiChatPreference, setLocalAiChatPreference] = createSignal<TAiChatPreference>(props.aiChatPreference ?? {})
  const [chatConnectNonce, setChatConnectNonce] = createSignal(0)
  const [approvals, setApprovals] = createSignal<TAiChatApproval[]>([])
  const [messageHistory, setMessageHistory] = createStore<unknown[]>([])
  const [settingState, { refetch: refetchSettings }] = createResource(() => props.apiService.api.agent.settings.get({}).then(async ([error, data]) => {
    if (error) throw error.message
    return data
  }))
  const [resourceState, { refetch: refetchResources }] = createResource(() => props.apiService.api.actors.resources.list({}).then(([error, data]) => {
    if (error) return []
    return data as TAiChatResource[]
  }))

  const refreshApprovals = async (currentSessionId: string) => {
    const requestId = ++approvalRequestId
    const [error, data] = await props.apiService.api.agent.approval.list({ widgetId: props.id, sessionId: currentSessionId })
    if (error || requestId !== approvalRequestId || sessionId() !== currentSessionId) return
    setApprovals(data.map((approval) => ({
      ...approval,
      resourceId: fnGetApprovalResourceId(approval.details),
      status: "pending" as const,
    })))
  }

  const setApprovalStatus = (approvalId: string, status: TAiChatApprovalStatus, statusMessage?: string) => {
    setApprovals((current) => current.map((approval) => approval.id === approvalId ? { ...approval, status, statusMessage } : approval))
  }

  const refreshResourceCatalog = async (approvalId: string) => {
    if (refreshedApprovalIds.has(approvalId)) return
    refreshedApprovalIds.add(approvalId)
    const resources = await refetchResources()
    if (resources) {
      setApprovals((current) => current.map((approval) => approval.id === approvalId
        ? { ...approval, resourceId: fnFindApprovalResourceId(approval.details, resources) }
        : approval))
    }
    props.onResourceCatalogChanged?.()
  }

  createEffect(() => {
    setLocalAiChatPreference(props.aiChatPreference ?? {})
  })

  createEffect(() => {
    const apiService = props.apiService
    const currentConnectNonce = chatConnectNonce()
    const currentSessionId = sessionId()
    setIsRunning(false)
    setIsCanceling(false)
    void apiService.api.agent.chat.connect({ sessionId: currentSessionId, widgetId: props.id }).then(([error, data]) => {
      if (sessionId() !== currentSessionId || chatConnectNonce() !== currentConnectNonce) return
      if (error) {
        console.error(error)
        return
      }
      setMessageHistory(reconcile(data.messageHistory.map((message) => withAgentMessageFinished(message, true))))
      void refreshApprovals(currentSessionId)
    })
  })

  const upsertMessage = (message: unknown, finished: boolean) => {
    const nextMessage = withAgentMessageFinished(message, finished)
    const index = findAgentMessageIndex(messageHistory, message)
    if (index >= 0) setMessageHistory(index, reconcile(nextMessage))
    else setMessageHistory(messageHistory.length, nextMessage)
  }

  createEffect(() => {
    const apiService = props.apiService
    const currentSessionId = sessionId()
    let disposed = false
    let closeEventStream: (() => void) | undefined

    void apiService.api.agent.events({}).then(async ([error, events]) => {
      if (error) {
        if (!disposed) console.error(error)
        return
      }
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
            setApprovalStatus(event.approval.id, event.decision === "approve" ? "executed" : "rejected")
            if (event.decision === "approve") void refreshResourceCatalog(event.approval.id)
          } else {
            setApprovalStatus(event.approval.id, event.reason === "execution-failed" ? "failed" : "stale", event.reason)
          }
          continue
        }
      }
    }).catch((error) => {
      if (!disposed) console.error(error)
    })

    onCleanup(() => {
      disposed = true
      closeEventStream?.()
    })
  })

  onMount(() => {
    const removeSettingsAction = props.titleBar.onAction("settings", () => {
      setSelectedView(activeView() === "settings" ? "chat" : "settings")
    })
    onCleanup(removeSettingsAction)
  })

  const updateAiChatPreference = (preference: TAiChatPreference) => {
    const nextPreference = { ...localAiChatPreference(), ...preference }
    setLocalAiChatPreference(nextPreference)
    props.onAiChatPreferenceChange?.(nextPreference)
  }

  const prompt = async (args: { text: string; images: TChatPromptImage[]; resourceIds?: string[]; model?: { id: string; provider: string }; thinkingLevel: TAiChatThinkingLevel }) => {
    const currentSessionId = sessionId()
    setIsRunning(true)
    setIsCanceling(false)
    updateAiChatPreference({
      model: args.model ? { provider: args.model.provider, modelId: args.model.id } : undefined,
      thinkingLevel: args.thinkingLevel,
    })
    const [error] = await props.apiService.api.agent.chat.prompt({
      widgetId: props.id,
      sessionId: currentSessionId,
      text: args.text,
      images: args.images,
      resourceIds: args.resourceIds,
      model: args.model ? { provider: args.model.provider, modelId: args.model.id } : undefined,
      thinkingLevel: args.thinkingLevel,
    })
    if (sessionId() !== currentSessionId) return
    setIsRunning(false)
    setIsCanceling(false)
    if (error) throw error
  }

  const cancelPrompt = async () => {
    if (isCanceling()) return
    const currentSessionId = sessionId()
    setIsCanceling(true)
    const [error, data] = await props.apiService.api.agent.chat.cancel({ widgetId: props.id, sessionId: currentSessionId })
    if (sessionId() !== currentSessionId) return
    setIsCanceling(false)
    setIsRunning(error ? false : data.running)
    if (error) console.error(error)
  }

  const newChat = () => {
    const previousSessionId = sessionId()
    const nextSessionId = props.onResetSessionId()
    setIsRunning(false)
    setIsCanceling(false)
    setChatDraftText("")
    setMessageHistory(reconcile([]))
    setApprovals([])
    refreshedApprovalIds.clear()
    setSessionId(nextSessionId)
    void props.apiService.api.agent.chat.newSession({ widgetId: props.id, sessionId: previousSessionId })
  }

  const clearResourceBindings = async () => {
    const [error] = await props.apiService.api.agent.chat.resourceBindings.clear({ widgetId: props.id, sessionId: sessionId() })
    if (error) throw error
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
    setChatConnectNonce((nonce) => nonce + 1)
  }

  const aiAuthenticated = () => (settingState.latest?.providersWithCredentials.length ?? 0) > 0
  const activeView = createMemo(() => selectedView() ?? (aiAuthenticated() ? "chat" : "settings"))
  createEffect(() => {
    props.titleBar.setActionState("settings", {
      pressed: activeView() === "settings",
      label: activeView() === "settings" ? "Back to chat" : "Settings",
    })
  })
  const resourceMentions = createMemo<TChatComposerMention[]>(() => (resourceState.latest ?? []).map((resource) => ({
    id: resource.id,
    label: resource.name,
    kind: resource.kind === "db" ? "Database" : resource.kind === "kv" ? "Key-value" : "Secret store",
  })))

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
                    draftText={chatDraftText()}
                    mentions={resourceMentions()}
                    onDraftTextChange={setChatDraftText}
                    onPreferenceChange={updateAiChatPreference}
                    onPrompt={prompt}
                    onResolveApproval={resolveApproval}
                    onOpenResource={props.onOpenResource}
                    onCancel={() => void cancelPrompt()}
                    onNewChat={newChat}
                    onClearResourceBindings={clearResourceBindings}
                  />
                )}
              </Show>
            </section>
            <Show when={activeView() === "settings"}>
              <section class="ai-chat-view ai-chat-view--settings">
                <SettingsTab settings={settingState.latest} apiService={props.apiService} onSettingsChanged={() => void refreshSettingsAndReconnectChat()} />
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
