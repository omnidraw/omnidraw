import type { TChatComposerSubmit } from "../ChatComposer/interface"
import { createSignal, Show } from "solid-js"
import { ChatComposer } from "../ChatComposer/ChatComposer"

export function ChatTab() {
  const [lastSubmit, setLastSubmit] = createSignal<TChatComposerSubmit>()

  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--chat">
      <ChatComposer onSubmit={setLastSubmit} />

      <Show when={lastSubmit()}>
        {(submit) => (
          <div class="ai-chat-draft" aria-live="polite">
            <span>Draft</span>
            <p>{submit().text || `${submit().images.length} image attachment${submit().images.length === 1 ? "" : "s"}`}</p>
          </div>
        )}
      </Show>
    </div>
  )
}
