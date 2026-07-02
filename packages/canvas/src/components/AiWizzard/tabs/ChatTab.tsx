import type { TChatComposerModel, TChatComposerSubmit } from "../ChatComposer/interface"
import { createSignal, Show } from "solid-js"
import { ChatComposer } from "../ChatComposer/ChatComposer"

type TAgentSettings = {
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: string
  models: TChatComposerModel[]
}

interface IProps {
  settings?: TAgentSettings
  sessionId: string
  onNewChat: () => void
}

export function ChatTab(props: IProps) {
  const [lastSubmit, setLastSubmit] = createSignal<TChatComposerSubmit>()

  const startNewChat = () => {
    setLastSubmit(undefined)
    props.onNewChat()
  }

  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--chat">
      <div class="ai-chat-content">
        <div class="ai-chat-session-bar">
          <span>Session {props.sessionId}</span>
          <button class="ai-wizzard-secondary-button" type="button" onClick={startNewChat}>
            New chat
          </button>
        </div>
        <Show when={lastSubmit()}>
          {(submit) => (
            <div class="ai-chat-draft" aria-live="polite">
              <span>Draft · {submit().model?.name ?? "No model"}</span>
              <p>{submit().text || `${submit().images.length} image attachment${submit().images.length === 1 ? "" : "s"}`}</p>
            </div>
          )}
        </Show>
      </div>

      <ChatComposer
        models={props.settings?.models}
        defaultModel={props.settings?.defaultModel}
        defaultProvider={props.settings?.defaultProvider}
        defaultThinkingLevel={props.settings?.defaultThinkingLevel}
        onSubmit={setLastSubmit}
      />
    </div>
  )
}
