import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { Tabs } from "@kobalte/core/tabs"
import { Match, Switch, createResource } from "solid-js"
import { AsyncStateView } from "./AsyncStateView"
import { ActorTab } from "./tabs/ActorTab"
import { PreviewTab } from "./tabs/PreviewTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { ChatTab } from "./tabs/ChatTab"
import "./index.css"

interface IProps {
    id: string
    apiService: TOrpcSafeClient
}

export function AiWizzard(props: IProps) {
    const [settingState, { refetch }] = createResource(() => props.apiService.api.agent.settings.get({}).then(async ([err, data]) => {
        if (err) throw err.message
        return data
    }))

    const aiAuthenticated = () => (settingState.latest?.providersWithCredentials.length ?? 0) > 0
    return (
        <div class="ai-wizzard-shell">
            <Switch fallback={<Tabs aria-label="Main navigation" class="ai-wizzard-tabs" defaultValue={aiAuthenticated() ? "chat" : "settings"}>
                <Tabs.List class="ai-wizzard-tabs__list">
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="chat">Chat</Tabs.Trigger>
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="actor">Actor</Tabs.Trigger>
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="preview">Preview</Tabs.Trigger>
                    <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="settings">Settings</Tabs.Trigger>
                    <Tabs.Indicator class="ai-wizzard-tabs__indicator" />
                </Tabs.List>

                <Tabs.Content class="ai-wizzard-tabs__content" value="chat">
                    <ChatTab settings={settingState.latest} />
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
