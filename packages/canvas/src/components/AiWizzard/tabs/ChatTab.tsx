import type { TChatComposerModel, TChatComposerSubmit } from "../ChatComposer/interface"
import { For, createSignal, Show } from "solid-js"
import { ChatComposer } from "../ChatComposer/ChatComposer"

type TAgentSettings = {
  defaultModel?: string
  defaultProvider?: string
  defaultThinkingLevel?: string
  models: TChatComposerModel[]
}

interface IProps {
  settings?: TAgentSettings
  messageHistory: readonly unknown[]
  onPrompt: (text: string) => Promise<void>
  onNewChat: () => void
}

function getMessageRole(message: unknown) {
  if (typeof message !== "object" || message === null || !("role" in message)) {
    return "message"
  }

  const role = (message as { role?: unknown }).role
  return typeof role === "string" ? role : "message"
}

function getMessageContent(message: unknown) {
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return JSON.stringify(message, null, 2)
  }

  const content = (message as { content?: unknown }).content
  if (typeof content === "string") return content
  return JSON.stringify(content, null, 2)
}

export function ChatTab(props: IProps) {
  const [lastSubmit, setLastSubmit] = createSignal<TChatComposerSubmit>()

  const submitPrompt = (submit: TChatComposerSubmit) => {
    setLastSubmit(submit)
    const text = submit.text.trim()
    if (!text) return

    void props.onPrompt(text).catch((error) => {
      console.error(error)
    })
  }

  const startNewChat = () => {
    setLastSubmit(undefined)
    props.onNewChat()
  }

  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--chat">
      <div class="ai-chat-content">
        <Show when={props.messageHistory.length === 0 && !lastSubmit()}>
          <div class="ai-chat-empty" aria-live="polite">
            Which Widget should AI build for you?
          </div>
        </Show>
        <Show when={props.messageHistory.length > 0}>
          <div class="ai-chat-history" aria-live="polite">
            <For each={props.messageHistory}>
              {(message) => (
                <article class="ai-chat-history__message">
                  <span>{getMessageRole(message)}</span>
                  <p>{getMessageContent(message)}</p>
                </article>
              )}
            </For>
          </div>
        </Show>
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
        onSubmit={submitPrompt}
        onNewChat={startNewChat}
      />
    </div>
  )
}
