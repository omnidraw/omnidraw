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
}

export function ChatTab(props: IProps) {
  const [lastSubmit, setLastSubmit] = createSignal<TChatComposerSubmit>()

  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--chat">
      <ChatComposer
        models={props.settings?.models}
        defaultModel={props.settings?.defaultModel}
        defaultProvider={props.settings?.defaultProvider}
        defaultThinkingLevel={props.settings?.defaultThinkingLevel}
        onSubmit={setLastSubmit}
      />

      <Show when={lastSubmit()}>
        {(submit) => (
          <div class="ai-chat-draft" aria-live="polite">
            <span>Draft · {submit().model?.name ?? "No model"}</span>
            <p>{submit().text || `${submit().images.length} image attachment${submit().images.length === 1 ? "" : "s"}`}</p>
          </div>
        )}
      </Show>
    </div>
  )
}
