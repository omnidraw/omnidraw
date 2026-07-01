import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { Tabs } from "@kobalte/core/tabs"
import { ActorTab } from "./tabs/ActorTab"
import { PreviewTab } from "./tabs/PreviewTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { ChatTab } from "./tabs/ChatTab"
import "./index.css"

interface IProps {
  apiService: TOrpcSafeClient
}

export function AiWizzard(props: IProps) {
  return (
    <div class="ai-wizzard-shell">
      <Tabs aria-label="Main navigation" class="ai-wizzard-tabs" defaultValue="widget">
        <Tabs.List class="ai-wizzard-tabs__list">
          <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="chat">Chat</Tabs.Trigger>
          <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="actor">Actor</Tabs.Trigger>
          <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="preview">Preview</Tabs.Trigger>
          <Tabs.Trigger class="ai-wizzard-tabs__trigger" value="settings">Settings</Tabs.Trigger>
          <Tabs.Indicator class="ai-wizzard-tabs__indicator" />
        </Tabs.List>

        <Tabs.Content class="ai-wizzard-tabs__content" value="chat">
          <ChatTab />
        </Tabs.Content>
        <Tabs.Content class="ai-wizzard-tabs__content" value="actor">
          <ActorTab apiService={props.apiService} />
        </Tabs.Content>
        <Tabs.Content class="ai-wizzard-tabs__content" value="preview">
          <PreviewTab />
        </Tabs.Content>
        <Tabs.Content class="ai-wizzard-tabs__content" value="settings">
          <SettingsTab />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
