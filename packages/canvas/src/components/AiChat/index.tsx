import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { Dialog } from "@kobalte/core/dialog"
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { AsyncStateView } from "./AsyncStateView"
import { ActorTab } from "./tabs/ActorTab"
import { PreviewTab } from "./tabs/PreviewTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { ChatTab } from "./tabs/ChatTab"
import "./index.css"
import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"
import type { TWidgetTitleBarPortal } from "../../services/widget/interface"
import type { TChatPromptImage } from "./ChatComposer/interface"
import type { TChatComposerMention } from "./ChatComposer/interface"

type TAiChatThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
type TAiChatPreference = {
    model?: {
        provider: string
        modelId: string
    }
    thinkingLevel?: TAiChatThinkingLevel
}
type TAiChatManifestSource = "file" | "actor-candidate" | "connected"
type TAiChatManifestState = {
    manifest: TVibecanvasJson | null
    source: TAiChatManifestSource
}

interface IProps {
    id: string
    apiService: TOrpcSafeClient
    titleBar: TWidgetTitleBarPortal
    sessionId: string
    aiChatPreference?: TAiChatPreference
    onAiChatPreferenceChange?: (preference: TAiChatPreference) => void
    onResetSessionId: () => string
}

type TAgentMessageRecord = Record<string, unknown>
type TPublishedWidgetListItem = {
    name: string
    slug: string
    version?: string
    description: string | null
    manifest_path: string
}
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

    if (role === "toolResult" && typeof message.toolCallId === "string") {
        return `${role}:tool:${message.toolCallId}`
    }

    if (role === "assistant" && typeof message.responseId === "string") {
        return `${role}:response:${message.responseId}`
    }

    if (typeof message.timestamp === "number" || typeof message.timestamp === "string") {
        return `${role}:time:${message.timestamp}`
    }

    return undefined
}

function findAgentMessageIndex(messages: readonly unknown[], message: unknown) {
    const key = getAgentMessageKey(message)
    if (!key) return -1

    return messages.findIndex((item) => getAgentMessageKey(item) === key)
}

function withAgentMessageFinished(message: unknown, finished: boolean) {
    if (!isAgentMessageRecord(message)) return message

    return {
        ...message,
        __vibecanvasMessageFinished: finished,
    }
}

function isSetActorCandidateToolResult(message: unknown) {
    if (!isAgentMessageRecord(message)) return false

    return message.role === "toolResult"
        && typeof message.toolName === "string"
        && message.toolName.toLowerCase() === "vc_set_actor_candidate"
        && message.isError !== true
}

function hasSetActorCandidateToolResult(messages: readonly unknown[]) {
    return messages.some((message) => isSetActorCandidateToolResult(message))
}

function getConnectedManifestState(data: { vcJson: TVibecanvasJson | null; actorCandidate?: { manifest: TVibecanvasJson } | null }): TAiChatManifestState {
    if (data.vcJson) {
        return {
            manifest: data.vcJson,
            source: "connected",
        }
    }

    if (data.actorCandidate?.manifest) {
        return {
            manifest: data.actorCandidate.manifest,
            source: "actor-candidate",
        }
    }

    return {
        manifest: null,
        source: "connected",
    }
}

function getPreferencePromptModel(preference: TAiChatPreference) {
    return preference.model ? {
        id: preference.model.modelId,
        provider: preference.model.provider,
    } : undefined
}

const APPROVE_ACTOR_CANDIDATE_PROMPT = "Approve the current actor candidate and write the deterministic draft scaffold only. Use the latest candidate revision."

const IMPLEMENT_APPROVED_ACTOR_PROMPT = [
    "The actor candidate has been approved and the scaffold files now exist in this working directory.",
    "",
    "Implement the approved Vibecanvas widget from the generated files. Read vibecanvas.json, actor/functions.ts, actor/types.ts, widget/main.ts, and widget/main.css first.",
    "",
    "Implement the actor transition functions named by the manifest, update actor/types.ts if useful, and replace the starter widget UI with a working Arrow UI that sends the manifest input messages through actor.sendMessage.",
    "",
    "Keep actor files aligned with the fn/fx/tx conventions: pure fn helpers, impure reads in fx helpers, and impure writes in tx helpers. Do not leave any \"not implemented yet\" stubs.",
    "",
    "After editing, run vc_validate_widget_files and fix validation errors. Do not publish unless I explicitly ask for publishing.",
].join("\n")

export function AiChat(props: IProps) {
    let draftManifestRefreshRequestId = 0
    const [selectedView, setSelectedView] = createSignal<"chat" | "settings">()
    const [isActorDialogOpen, setIsActorDialogOpen] = createSignal(false)
    const [isPreviewDialogOpen, setIsPreviewDialogOpen] = createSignal(false)
    const [sessionId, setSessionId] = createSignal(props.sessionId)
    const [isRunning, setIsRunning] = createSignal(false)
    const [isCanceling, setIsCanceling] = createSignal(false)
    const [chatDraftText, setChatDraftText] = createSignal("")
    const [localAiChatPreference, setLocalAiChatPreference] = createSignal<TAiChatPreference>(props.aiChatPreference ?? {})
    const [chatConnectNonce, setChatConnectNonce] = createSignal(0)
    const [isEditPickerOpen, setIsEditPickerOpen] = createSignal(false)
    const [editPickerNonce, setEditPickerNonce] = createSignal(0)
    const [selectedPublishedWidgetName, setSelectedPublishedWidgetName] = createSignal<string>()
    const [editPickerError, setEditPickerError] = createSignal<string>()
    const [isStartingWidgetEdit, setIsStartingWidgetEdit] = createSignal(false)
    const [messageHistory, setMessageHistory] = createStore<unknown[]>([])
    const [settingState, { refetch }] = createResource(() => props.apiService.api.agent.settings.get({}).then(async ([err, data]) => {
        if (err) throw err.message
        return data
    }))
    const [resourceState] = createResource(() => props.apiService.api.actors.resources.list({}).then(([err, data]) => {
        if (err) return []
        return data as TAiChatResource[]
    }))
    const [manifestState, setManifestState] = createSignal<TAiChatManifestState>({
        manifest: null,
        source: "connected",
    })
    const [publishedWidgetState, { refetch: refetchPublishedWidgets }] = createResource(
        () => isEditPickerOpen() ? editPickerNonce() : undefined,
        () => props.apiService.api.actors.definitions.list().then(async ([err, data]) => {
            if (err) throw err.message
            return data as TPublishedWidgetListItem[]
        }),
    )

    createEffect(() => {
        setLocalAiChatPreference(props.aiChatPreference ?? {})
    })

    createEffect(() => {
        const currentConnectNonce = chatConnectNonce()
        const currentSessionId = sessionId()
        setIsRunning(false)
        setIsCanceling(false)

        void props.apiService.api.agent.chat.connect({
            sessionId: currentSessionId,
            widgetId: props.id
        }).then(([err, data]) => {
            if (sessionId() !== currentSessionId || chatConnectNonce() !== currentConnectNonce) {
                return
            }

            if (err) {
                throw err
            }

            setManifestState(getConnectedManifestState(data))
            setMessageHistory(reconcile(data.messageHistory.map((message) => withAgentMessageFinished(message, true))))
        })
    })

    const setChatManifest = (manifest: TVibecanvasJson | null, source: TAiChatManifestSource = "connected") => {
        setManifestState({ manifest, source })
    }

    const refreshDraftManifest = async (args: { currentSessionId: string }) => {
        const requestId = ++draftManifestRefreshRequestId
        const [err, result] = await props.apiService.api.agent.chat.draftManifest.read({
            widgetId: props.id,
            sessionId: args.currentSessionId,
        })

        if (sessionId() !== args.currentSessionId || requestId !== draftManifestRefreshRequestId) {
            return
        }

        if (err || !result.ready) {
            return
        }

        setChatManifest(result.manifest, result.source)
    }


    onMount(() => {
        let disposed = false

        const upsertMessage = (message: unknown, finished: boolean) => {
            const nextMessage = withAgentMessageFinished(message, finished)
            const index = findAgentMessageIndex(messageHistory, message)

            if (index >= 0) {
                setMessageHistory(index, reconcile(nextMessage))
                return
            }

            setMessageHistory(messageHistory.length, nextMessage)
        }

        const appendMessages = (messages: readonly unknown[], finished: boolean) => {
            messages.forEach((message) => upsertMessage(message, finished))
        }

        const refreshManifestForCandidateMessages = (messages: readonly unknown[]) => {
            if (!hasSetActorCandidateToolResult(messages)) {
                return
            }

            void refreshDraftManifest({ currentSessionId: sessionId() })
        }

        void props.apiService.api.agent.events({}).then(async ([err, events]) => {
            if (err) {
                console.error(err)
                return
            }

            for await (const event of events) {
                if (disposed) break
                if (event.widgetId !== props.id) continue
                if (event.sessionId !== sessionId()) continue
                if ("kind" in event) continue

                const piEvent = event.event
                if ("kind" in piEvent) continue

                if (piEvent.type === "agent_start" || piEvent.type === "turn_start") {
                    setIsRunning(true)
                    setIsCanceling(false)
                    continue
                }

                if (piEvent.type === "agent_end") {
                    appendMessages(piEvent.messages, true)
                    refreshManifestForCandidateMessages(piEvent.messages)
                    setIsRunning(piEvent.willRetry)
                    if (!piEvent.willRetry) {
                        setIsCanceling(false)
                    }
                    continue
                }

                if (piEvent.type === "message_start" || piEvent.type === "message_update") {
                    setIsRunning(true)
                    upsertMessage(piEvent.message, false)
                    continue
                }

                if (piEvent.type === "message_end") {
                    upsertMessage(piEvent.message, true)
                    refreshManifestForCandidateMessages([piEvent.message])
                    continue
                }

                if (piEvent.type === "turn_end") {
                    upsertMessage(piEvent.message, true)
                    refreshManifestForCandidateMessages([piEvent.message])
                }
            }
        })

        onCleanup(() => {
            disposed = true
        })
    })

    const updateAiChatPreference = (preference: TAiChatPreference) => {
        const nextPreference = {
            ...localAiChatPreference(),
            ...preference,
        }

        setLocalAiChatPreference(nextPreference)
        props.onAiChatPreferenceChange?.(nextPreference)
    }

    const prompt = async (args: { text: string; images: TChatPromptImage[]; resourceIds?: string[]; model?: { id: string; provider: string }; thinkingLevel: TAiChatThinkingLevel }) => {
        const currentSessionId = sessionId()
        setIsRunning(true)
        setIsCanceling(false)
        updateAiChatPreference({
            model: args.model ? {
                provider: args.model.provider,
                modelId: args.model.id,
            } : undefined,
            thinkingLevel: args.thinkingLevel,
        })

        const [err] = await props.apiService.api.agent.chat.prompt({
            widgetId: props.id,
            sessionId: currentSessionId,
            text: args.text,
            images: args.images,
            resourceIds: args.resourceIds,
            model: args.model ? {
                provider: args.model.provider,
                modelId: args.model.id,
            } : undefined,
            thinkingLevel: args.thinkingLevel,
        })
        if (sessionId() !== currentSessionId) return

        setIsRunning(false)
        setIsCanceling(false)
        if (err) throw err
    }

    const clearResourceBindings = async () => {
        const [err] = await props.apiService.api.agent.chat.resourceBindings.clear({
            widgetId: props.id,
            sessionId: sessionId(),
        })
        if (err) throw err
    }

    const reconnectChat = async () => {
        const [err, data] = await props.apiService.api.agent.chat.connect({
            sessionId: sessionId(),
            widgetId: props.id
        })

        if (err) throw err

        setManifestState(getConnectedManifestState(data))
        setMessageHistory(reconcile(data.messageHistory.map((message) => withAgentMessageFinished(message, true))))

        return data
    }

    const refreshSettingsAndReconnectChat = async () => {
        await refetch()
        setChatConnectNonce((nonce) => nonce + 1)
    }

    const approveActorCandidate = async () => {
        const currentPreference = localAiChatPreference()

        await prompt({
            text: APPROVE_ACTOR_CANDIDATE_PROMPT,
            images: [],
            model: getPreferencePromptModel(currentPreference),
            thinkingLevel: currentPreference.thinkingLevel ?? settingState.latest?.defaultThinkingLevel ?? "minimal",
        })

        await reconnectChat()

        const [err, result] = await props.apiService.api.agent.chat.draftManifest.read({
            widgetId: props.id,
            sessionId: sessionId(),
        })

        if (!err && result.ready) {
            setChatManifest(result.manifest, result.source)
        }

        const nextPreference = localAiChatPreference()

        await prompt({
            text: IMPLEMENT_APPROVED_ACTOR_PROMPT,
            images: [],
            model: getPreferencePromptModel(nextPreference),
            thinkingLevel: nextPreference.thinkingLevel ?? settingState.latest?.defaultThinkingLevel ?? "minimal",
        })
    }

    const cancelPrompt = async () => {
        if (isCanceling()) return

        const currentSessionId = sessionId()
        setIsCanceling(true)

        const [err, data] = await props.apiService.api.agent.chat.cancel({
            widgetId: props.id,
            sessionId: currentSessionId,
        })
        if (sessionId() !== currentSessionId) return

        setIsCanceling(false)
        setIsRunning(err ? false : data.running)
        if (err) {
            console.error(err)
        }
    }

    const newChat = () => {
        setIsRunning(false)
        setIsCanceling(false)
        setChatDraftText("")
        setMessageHistory(reconcile([]))
        setChatManifest(null)
        setSessionId(props.onResetSessionId())
    }

    const openEditPicker = () => {
        setEditPickerError(undefined)
        setSelectedPublishedWidgetName(undefined)
        setIsEditPickerOpen(true)
        setEditPickerNonce((nonce) => nonce + 1)
        void refetchPublishedWidgets()
    }

    const startWidgetEdit = async () => {
        const definitionName = selectedPublishedWidgetName()
        if (!definitionName || isStartingWidgetEdit()) return

        const nextSessionId = props.onResetSessionId()
        setIsStartingWidgetEdit(true)
        setEditPickerError(undefined)
        setIsRunning(false)
        setIsCanceling(false)
        setChatDraftText("")

        const [err, result] = await props.apiService.api.agent.chat.startWidgetEdit({
            widgetId: props.id,
            sessionId: nextSessionId,
            definitionName,
        })

        setIsStartingWidgetEdit(false)
        if (err) {
            setEditPickerError(err.message)
            return
        }

        if (!result.ok) {
            setEditPickerError(result.message)
            return
        }

        setChatManifest(result.vcJson, "file")
        setMessageHistory(reconcile(result.messageHistory.map((message) => withAgentMessageFinished(message, true))))
        setSessionId(nextSessionId)
        setIsActorDialogOpen(true)
        setIsEditPickerOpen(false)
    }

    const aiAuthenticated = () => (settingState.latest?.providersWithCredentials.length ?? 0) > 0
    const activeView = createMemo(() => selectedView() ?? (aiAuthenticated() ? "chat" : "settings"))
    onMount(() => {
        const removeSettingsAction = props.titleBar.onAction("settings", () => {
            setSelectedView(activeView() === "settings" ? "chat" : "settings")
        })
        onCleanup(removeSettingsAction)
    })
    createEffect(() => {
        props.titleBar.setActionState("settings", { pressed: activeView() === "settings" })
    })
    const resourceMentions = createMemo<TChatComposerMention[]>(() => (resourceState.latest ?? []).map((resource) => ({
        id: resource.id,
        label: resource.name,
        kind: resource.kind === "db" ? "Database" : resource.kind === "kv" ? "Key-value" : "Secret store",
    })))

    const approveDbChange = async (proposalId: string) => {
        const [err, result] = await props.apiService.api.agent.chat.dbChange.approve({
            widgetId: props.id,
            sessionId: sessionId(),
            proposalId,
            confirmedRisk: true,
        })
        if (err) throw new Error(err.message)
        return result
    }

    const rejectDbChange = async (proposalId: string) => {
        const [err, result] = await props.apiService.api.agent.chat.dbChange.reject({
            widgetId: props.id,
            sessionId: sessionId(),
            proposalId,
        })
        if (err) throw new Error(err.message)
        return result
    }

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
                                        isRunning={isRunning()}
                                        isCanceling={isCanceling()}
                                        draftText={chatDraftText()}
                                        mentions={resourceMentions()}
                                        onDraftTextChange={setChatDraftText}
                                        onPreferenceChange={updateAiChatPreference}
                                        onPrompt={prompt}
                                        onApproveDbChange={approveDbChange}
                                        onRejectDbChange={rejectDbChange}
                                        onCancel={() => void cancelPrompt()}
                                        onNewChat={newChat}
                                        onEditExistingWidget={openEditPicker}
                                        onClearResourceBindings={clearResourceBindings}
                                        onInspectActor={() => setIsActorDialogOpen(true)}
                                        onOpenPreview={() => setIsPreviewDialogOpen(true)}
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
                    <AsyncStateView
                        variant="loading"
                        title="Loading AI chat"
                        message="Fetching the agent settings before opening the workspace."
                    />
                </Match>
                <Match when={settingState.error}>
                    {(error) => (
                        <AsyncStateView
                            variant="error"
                            title="Could not load AI chat"
                            message={String(error())}
                            actionLabel="Try again"
                            onAction={() => void refetch()}
                        />
                    )}
                </Match>
            </Switch>
            <Dialog open={isActorDialogOpen()} onOpenChange={setIsActorDialogOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay class="ai-chat-dialog-overlay" />
                    <Dialog.Content class="ai-chat-dialog ai-chat-dialog--workspace">
                        <header class="ai-chat-dialog__header">
                            <Dialog.Title class="ai-chat-dialog__title">Actor details</Dialog.Title>
                            <Dialog.CloseButton class="ai-chat-dialog__close">Close</Dialog.CloseButton>
                        </header>
                        <div class="ai-chat-dialog__body ai-chat-dialog__body--workspace">
                            <ActorTab
                                actor={manifestState().manifest}
                                actorSource={manifestState().source}
                                apiService={props.apiService}
                                isApproving={isRunning()}
                                sessionId={sessionId()}
                                widgetId={props.id}
                                onApprove={approveActorCandidate}
                                onManifestChange={setChatManifest}
                            />
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog>
            <Dialog open={isPreviewDialogOpen()} onOpenChange={setIsPreviewDialogOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay class="ai-chat-dialog-overlay" />
                    <Dialog.Content class="ai-chat-dialog ai-chat-dialog--workspace">
                        <header class="ai-chat-dialog__header">
                            <Dialog.Title class="ai-chat-dialog__title">Widget preview</Dialog.Title>
                            <Dialog.CloseButton class="ai-chat-dialog__close">Close</Dialog.CloseButton>
                        </header>
                        <div class="ai-chat-dialog__body ai-chat-dialog__body--workspace">
                            <PreviewTab
                                apiService={props.apiService}
                                sessionId={sessionId()}
                                widgetId={props.id}
                            />
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog>
            <Dialog open={isEditPickerOpen()} onOpenChange={setIsEditPickerOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay class="ai-chat-dialog-overlay" />
                    <Dialog.Content class="ai-chat-dialog ai-chat-dialog--wide">
                        <header class="ai-chat-dialog__header">
                            <div>
                                <Dialog.Title class="ai-chat-dialog__title">Edit existing widget</Dialog.Title>
                                <Dialog.Description class="ai-chat-dialog__description">
                                    Choose a published widget. Vibecanvas copies it into a draft and leaves the published folder unchanged until publish.
                                </Dialog.Description>
                            </div>
                            <Dialog.CloseButton class="ai-chat-dialog__close">Close</Dialog.CloseButton>
                        </header>
                        <div class="ai-chat-dialog__body">
                            <Switch>
                                <Match when={publishedWidgetState.loading}>
                                    <p>Loading published widgets...</p>
                                </Match>
                                <Match when={publishedWidgetState.error}>
                                    {(error) => (
                                        <div class="ai-chat-picker-state">
                                            <p>{String(error())}</p>
                                            <button type="button" class="ai-chat-secondary-button" onClick={() => void refetchPublishedWidgets()}>
                                                Try again
                                            </button>
                                        </div>
                                    )}
                                </Match>
                                <Match when={(publishedWidgetState.latest?.length ?? 0) === 0}>
                                    <p>No published widgets are available yet.</p>
                                </Match>
                                <Match when={(publishedWidgetState.latest?.length ?? 0) > 0}>
                                    <div class="ai-chat-widget-picker-list">
                                        <For each={publishedWidgetState.latest ?? []}>
                                            {(widget) => (
                                                <button
                                                    type="button"
                                                    class="ai-chat-widget-picker-item"
                                                    classList={{ "ai-chat-widget-picker-item--selected": selectedPublishedWidgetName() === widget.name }}
                                                    onClick={() => setSelectedPublishedWidgetName(widget.name)}
                                                >
                                                    <span class="ai-chat-widget-picker-item__main">
                                                        <strong>{widget.name}</strong>
                                                        <span>{widget.description ?? "No description"}</span>
                                                    </span>
                                                    <span class="ai-chat-widget-picker-item__meta">
                                                        <span>{widget.slug}</span>
                                                        <span>v{widget.version ?? "unknown"}</span>
                                                        <span>{widget.manifest_path}</span>
                                                    </span>
                                                </button>
                                            )}
                                        </For>
                                    </div>
                                </Match>
                            </Switch>
                            <Show when={editPickerError()}>
                                {(message) => <pre class="ai-chat-dialog__message">{message()}</pre>}
                            </Show>
                        </div>
                        <footer class="ai-chat-dialog__actions">
                            <Dialog.CloseButton class="ai-chat-secondary-button">Cancel</Dialog.CloseButton>
                            <button
                                type="button"
                                class="ai-chat-primary-button"
                                disabled={!selectedPublishedWidgetName() || isStartingWidgetEdit()}
                                onClick={() => void startWidgetEdit()}
                            >
                                {isStartingWidgetEdit() ? "Preparing..." : "Start editing"}
                            </button>
                        </footer>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog>
        </div>
    )
}
