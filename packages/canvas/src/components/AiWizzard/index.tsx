import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { Tabs } from "@kobalte/core/tabs"
import { Match, Switch, createEffect, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { AsyncStateView } from "./AsyncStateView"
import { ActorTab } from "./tabs/ActorTab"
import { PreviewTab } from "./tabs/PreviewTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { ChatTab } from "./tabs/ChatTab"
import "./index.css"
import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"

interface IProps {
    id: string
    apiService: TOrpcSafeClient
    sessionId: string
    onResetSessionId: () => string
}

type TAgentMessageRecord = Record<string, unknown>

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

export function AiWizzard(props: IProps) {
    const [selectedTab, setSelectedTab] = createSignal<string>()
    const [sessionId, setSessionId] = createSignal(props.sessionId)
    const [messageHistory, setMessageHistory] = createStore<unknown[]>([])
    const [settingState, { refetch }] = createResource(() => props.apiService.api.agent.settings.get({}).then(async ([err, data]) => {
        if (err) throw err.message
        return data
    }))
    const [vcJson, setVcJson] = createSignal<TVibecanvasJson | null>(null)

    createEffect(
        async (input) => {
            const [err, data] = await props.apiService.api.agent.wizzard.connect({
                sessionId: props.sessionId,
                widgetId: props.id
            })
            if (err) {
                throw err
            }

            setVcJson(data.vcJson)
            setMessageHistory(reconcile(data.messageHistory.map((message) => withAgentMessageFinished(message, true))))

            return data
        }
    )


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

        void props.apiService.api.agent.events({}).then(async ([err, events]) => {
            if (err) {
                console.error(err)
                return
            }

            for await (const event of events) {
                if (disposed) break
                if (event.widgetId !== props.id) continue
                if (event.sessionId !== sessionId()) continue

                const piEvent = event.event

                if (piEvent.type === "agent_end") {
                    appendMessages(piEvent.messages, true)
                    continue
                }

                if (piEvent.type === "message_start" || piEvent.type === "message_update") {
                    upsertMessage(piEvent.message, false)
                    continue
                }

                if (piEvent.type === "message_end") {
                    upsertMessage(piEvent.message, true)
                    continue
                }

                if (piEvent.type === "turn_end") {
                    upsertMessage(piEvent.message, true)
                }
            }
        })

        onCleanup(() => {
            disposed = true
        })
    })

    const prompt = async (text: string) => {
        const [err] = await props.apiService.api.agent.wizzard.prompt({
            widgetId: props.id,
            sessionId: sessionId(),
            text,
        })
        if (err) throw err
    }

    const newChat = () => {
        setMessageHistory(reconcile([]))
        setSessionId(props.onResetSessionId())
    }

    const aiAuthenticated = () => (settingState.latest?.providersWithCredentials.length ?? 0) > 0
    return (
        <div class="ai-wizzard-shell">
            <Switch fallback={<Tabs aria-label="Main navigation" class="ai-wizzard-tabs" value={selectedTab() ?? (aiAuthenticated() ? "chat" : "settings")} onChange={setSelectedTab}>
                <Tabs.List class="ai-wizzard-tabs__list">
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="chat">Chat</Tabs.Trigger>
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="actor">Actor</Tabs.Trigger>
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="preview">Preview</Tabs.Trigger>
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="settings">Settings</Tabs.Trigger>
                    <Tabs.Indicator class="ai-wizzard-tabs__indicator" />
                </Tabs.List>

                <Tabs.Content class="ai-wizzard-tabs__content" value="chat">
                    <ChatTab
                        settings={settingState.latest}
                        messageHistory={messageHistory}
                        onPrompt={prompt}
                        onNewChat={newChat}
                    />
                </Tabs.Content>
                <Tabs.Content class="ai-wizzard-tabs__content" value="actor">
                    <ActorTab apiService={props.apiService} />
                </Tabs.Content>
                <Tabs.Content class="ai-wizzard-tabs__content" value="preview">
                    <PreviewTab />
                </Tabs.Content>
                <Tabs.Content class="ai-wizzard-tabs__content" value="settings">
                    <SettingsTab settings={settingState.latest} apiService={props.apiService} onSettingsChanged={() => void refetch()} />
                </Tabs.Content>
            </Tabs>}>
                <Match when={settingState.loading}>
                    <AsyncStateView
                        variant="loading"
                        title="Loading AI wizard"
                        message="Fetching the agent settings before opening the workspace."
                    />
                </Match>
                <Match when={settingState.error}>
                    {(error) => (
                        <AsyncStateView
                            variant="error"
                            title="Could not load AI wizard"
                            message={String(error())}
                            actionLabel="Try again"
                            onAction={() => void refetch()}
                        />
                    )}
                </Match>
            </Switch>
        </div>
    )
}
