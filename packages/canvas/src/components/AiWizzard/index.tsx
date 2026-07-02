import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { Tabs } from "@kobalte/core/tabs"
import { Match, Switch, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { AsyncStateView } from "./AsyncStateView"
import { ActorTab } from "./tabs/ActorTab"
import { PreviewTab } from "./tabs/PreviewTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { ChatTab } from "./tabs/ChatTab"
import "./index.css"
import { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"

interface IProps {
    id: string
    apiService: TOrpcSafeClient
    sessionId: string
    onResetSessionId: () => string
}

export function AiWizzard(props: IProps) {
    const [selectedTab, setSelectedTab] = createSignal<string>()
    const [sessionId, setSessionId] = createSignal(props.sessionId)
    const [settingState, { refetch }] = createResource(() => props.apiService.api.agent.settings.get({}).then(async ([err, data]) => {
        if (err) throw err.message
        return data
    }))
    const [vcJson, setVcJson] = createSignal<TVibecanvasJson | null>(null)

    props.apiService.api.agent.wizzard.connect({ widgetId: props.id, sessionId: props.sessionId })
        .then(async ([err, data]) => {
            if (err) throw err
            setVcJson(data)
        })

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
                        sessionId={sessionId()}
                        onNewChat={() => setSessionId(props.onResetSessionId())}
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
