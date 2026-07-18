import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { TAiChatApiPort, TAiChatBrowserPort } from "../../../ports"

type TAgentSettings = {
  providersWithCredentials: string[]
  providers: string[]
}

type TProviderId = "openai-codex" | "github-copilot"
type TLoginStatus =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "device-code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number; message?: string }
  | { status: "progress"; message: string }
  | { status: "success" }
  | { status: "aborted" }
  | { status: "error"; message: string }

type TLoginUiState = {
  loginId?: string
  status: TLoginStatus
}

type TApiKeyStatus =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "removing" }
  | { status: "success"; message: string }
  | { status: "error"; message: string }

interface IProps {
  settings?: TAgentSettings
  apiService: TAiChatApiPort
  browser: TAiChatBrowserPort
  onSettingsChanged?: () => void
}

const SUBSCRIPTION_PROVIDERS = ["openai-codex", "github-copilot"] as const
const POLL_MS = 1000

const providerLabel = (provider: string) => provider
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ")

export function SettingsTab(props: IProps) {
  const configuredProviders = createMemo(() => new Set(props.settings?.providersWithCredentials ?? []))
  const hasCredentials = createMemo(() => configuredProviders().size > 0)
  const providers = createMemo(() => props.settings?.providers ?? [])
  const subscriptionProviders = createMemo(() => (
    SUBSCRIPTION_PROVIDERS.filter((provider) => providers().includes(provider))
  ))
  const apiKeyProviders = createMemo(() => (
    providers().filter((provider) => !SUBSCRIPTION_PROVIDERS.includes(provider as typeof SUBSCRIPTION_PROVIDERS[number]))
  ))
  const [loginStateByProvider, setLoginStateByProvider] = createSignal<Record<string, TLoginUiState>>({})
  const [apiKeyDraftByProvider, setApiKeyDraftByProvider] = createSignal<Record<string, string>>({})
  const [apiKeyStatusByProvider, setApiKeyStatusByProvider] = createSignal<Record<string, TApiKeyStatus>>({})
  const [expandedApiKeyProviderMap, setExpandedApiKeyProviderMap] = createSignal<Record<string, boolean>>({})
  const pollTimers = new Map<string, unknown>()

  const setProviderState = (provider: string, state: TLoginUiState) => {
    setLoginStateByProvider((current) => ({ ...current, [provider]: state }))
  }

  const clearPoll = (provider: string) => {
    const timer = pollTimers.get(provider)
    if (timer) props.browser.clearInterval(timer)
    pollTimers.delete(provider)
  }

  const pollLogin = (provider: TProviderId, loginId: string) => {
    clearPoll(provider)
    const poll = async () => {
      const [err, data] = await props.apiService.api.agent.auth.status({ loginId })
      if (err) {
        clearPoll(provider)
        setProviderState(provider, { loginId, status: { status: "error", message: err.message } })
        return
      }

      setProviderState(provider, { loginId, status: data })

      if (data.status === "success") {
        clearPoll(provider)
        props.onSettingsChanged?.()
      }

      if (data.status === "error" || data.status === "aborted") {
        clearPoll(provider)
      }
    }

    void poll()
    pollTimers.set(provider, props.browser.setInterval(() => void poll(), POLL_MS))
  }

  const startLogin = async (provider: TProviderId) => {
    const active = loginStateByProvider()[provider]
    if (active?.loginId && (active.status.status === "pending" || active.status.status === "device-code" || active.status.status === "progress")) return

    setProviderState(provider, { status: { status: "pending" } })
    const [err, data] = await props.apiService.api.agent.auth.login({ providerId: provider })
    if (err) {
      setProviderState(provider, { status: { status: "error", message: err.message } })
      return
    }

    setProviderState(provider, { loginId: data.loginId, status: { status: "pending" } })
    pollLogin(provider, data.loginId)
  }

  const abortLogin = async (provider: TProviderId) => {
    const active = loginStateByProvider()[provider]
    if (!active?.loginId) return

    clearPoll(provider)
    await props.apiService.api.agent.auth.abort({ loginId: active.loginId })
    setProviderState(provider, { loginId: active.loginId, status: { status: "aborted" } })
  }

  const logout = async (provider: TProviderId) => {
    clearPoll(provider)
    const [err] = await props.apiService.api.agent.auth.logout({ providerId: provider })
    if (err) {
      setProviderState(provider, { status: { status: "error", message: err.message } })
      return
    }

    setProviderState(provider, { status: { status: "aborted" } })
    props.onSettingsChanged?.()
  }

  const setApiKeyDraft = (provider: string, key: string) => {
    setApiKeyDraftByProvider((current) => ({ ...current, [provider]: key }))
  }

  const setApiKeyStatus = (provider: string, status: TApiKeyStatus) => {
    setApiKeyStatusByProvider((current) => ({ ...current, [provider]: status }))
  }

  const setApiKeyExpanded = (provider: string, expanded: boolean) => {
    setExpandedApiKeyProviderMap((current) => ({ ...current, [provider]: expanded }))
  }

  const saveApiKey = async (provider: string) => {
    const key = apiKeyDraftByProvider()[provider]?.trim() ?? ""
    if (!key) {
      setApiKeyStatus(provider, { status: "error", message: "Paste an API key before saving." })
      return
    }

    setApiKeyStatus(provider, { status: "saving" })
    const [err] = await props.apiService.api.agent.auth.apiKey.set({ providerId: provider, key })
    if (err) {
      setApiKeyStatus(provider, { status: "error", message: err.message })
      return
    }

    setApiKeyDraft(provider, "")
    setApiKeyStatus(provider, { status: "success", message: "API key saved." })
    setApiKeyExpanded(provider, false)
    props.onSettingsChanged?.()
  }

  const removeApiKey = async (provider: string) => {
    setApiKeyStatus(provider, { status: "removing" })
    const [err] = await props.apiService.api.agent.auth.apiKey.remove({ providerId: provider })
    if (err) {
      setApiKeyStatus(provider, { status: "error", message: err.message })
      return
    }

    setApiKeyDraft(provider, "")
    setApiKeyStatus(provider, { status: "success", message: "API key removed." })
    setApiKeyExpanded(provider, false)
    props.onSettingsChanged?.()
  }

  onCleanup(() => {
    for (const provider of pollTimers.keys()) clearPoll(provider)
    for (const state of Object.values(loginStateByProvider())) {
      if (state.loginId && (state.status.status === "pending" || state.status.status === "device-code" || state.status.status === "progress")) {
        void props.apiService.api.agent.auth.abort({ loginId: state.loginId })
      }
    }
  })

  return (
    <div class="ai-chat-tab ai-chat-tab--settings">
      <Show when={!hasCredentials()}>
        <section class="ai-chat-auth-callout" aria-live="polite">
          <strong>Login to an AI provider to start chatting</strong>
          <p>Connect a Pi subscription provider or add an API key for one of the supported providers.</p>
        </section>
      </Show>

      <section class="ai-chat-settings-section">
        <div class="ai-chat-settings-header">
          <span class="ai-chat-kicker">Subscriptions</span>
          <p>Use OAuth-based Pi subscriptions for providers that support browser login.</p>
        </div>

        <div class="ai-chat-provider-grid">
          <For each={subscriptionProviders()}>
            {(provider) => {
              const configured = () => configuredProviders().has(provider)
              const state = () => loginStateByProvider()[provider]?.status ?? { status: "idle" } as TLoginStatus
              const active = () => state().status === "pending" || state().status === "device-code" || state().status === "progress"
              return (
                <article classList={{ "ai-chat-provider-card": true, "ai-chat-provider-card--expanded": active() || state().status === "success" || state().status === "error" || state().status === "aborted" }}>
                  <div class="ai-chat-provider-card__main">
                    <strong>{providerLabel(provider)}</strong>
                    <small>{configured() ? "Connected subscription" : "No subscription connected"}</small>
                  </div>
                  <div class="ai-chat-provider-card__actions">
                    <button class="ai-chat-secondary-button" type="button" disabled={active()} onClick={() => void startLogin(provider)}>
                      {configured() ? "Reconnect" : "Log in"}
                    </button>
                    <Show when={configured() && !active()}>
                      <button class="ai-chat-secondary-button ai-chat-secondary-button--danger" type="button" onClick={() => void logout(provider)}>
                        Logout
                      </button>
                    </Show>
                    <Show when={active()}>
                      <button class="ai-chat-secondary-button ai-chat-secondary-button--danger" type="button" onClick={() => void abortLogin(provider)}>
                        Cancel
                      </button>
                    </Show>
                  </div>

                  <Show when={state().status !== "idle"}>
                    <div class="ai-chat-login-box" aria-live="polite">
                      <SwitchLoginStatus status={state()} />
                    </div>
                  </Show>
                </article>
              )
            }}
          </For>
        </div>
      </section>

      <section class="ai-chat-settings-section">
        <div class="ai-chat-settings-header">
          <span class="ai-chat-kicker">API keys</span>
          <p>API keys are stored by Pi. Existing keys are never displayed here.</p>
        </div>

        <div class="ai-chat-provider-grid">
          <For each={apiKeyProviders()}>
            {(provider) => {
              const configured = () => configuredProviders().has(provider)
              const status = () => apiKeyStatusByProvider()[provider] ?? { status: "idle" } as TApiKeyStatus
              const draft = () => apiKeyDraftByProvider()[provider] ?? ""
              const expanded = () => expandedApiKeyProviderMap()[provider] ?? false
              const busy = () => status().status === "saving" || status().status === "removing"
              return (
                <article classList={{ "ai-chat-provider-card": true, "ai-chat-provider-card--api-key": true, "ai-chat-provider-card--expanded": expanded() || status().status === "success" || status().status === "error" }}>
                  <div class="ai-chat-provider-card__main">
                    <strong>{providerLabel(provider)}</strong>
                    <small>{configured() ? "API key configured" : "No API key configured"}</small>
                  </div>
                  <div class="ai-chat-provider-card__actions">
                    <button class="ai-chat-secondary-button" type="button" disabled={busy()} onClick={() => setApiKeyExpanded(provider, !expanded())}>
                      {expanded() ? "Close" : configured() ? "Update key" : "Add API key"}
                    </button>
                    <Show when={configured()}>
                      <button class="ai-chat-secondary-button ai-chat-secondary-button--danger" type="button" disabled={busy()} onClick={() => void removeApiKey(provider)}>
                        Remove
                      </button>
                    </Show>
                  </div>

                  <Show when={expanded()}>
                    <div class="ai-chat-api-key-box">
                      <label class="ai-chat-api-key-field">
                        <span>{configured() ? "Paste a replacement API key" : "Paste API key"}</span>
                        <input
                          class="ai-chat-api-key-input"
                          type="password"
                          autocomplete="off"
                          spellcheck={false}
                          value={draft()}
                          placeholder={configured() ? "Existing key is hidden" : "sk-..."}
                          disabled={busy()}
                          onInput={(event) => setApiKeyDraft(provider, event.currentTarget.value)}
                        />
                      </label>
                      <div class="ai-chat-provider-card__actions">
                        <button class="ai-chat-secondary-button" type="button" disabled={busy() || draft().trim().length === 0} onClick={() => void saveApiKey(provider)}>
                          {configured() ? "Save new key" : "Save key"}
                        </button>
                      </div>
                    </div>
                  </Show>

                  <Show when={status().status !== "idle"}>
                    <div class="ai-chat-login-box" aria-live="polite">
                      <ApiKeyStatus status={status()} />
                    </div>
                  </Show>
                </article>
              )
            }}
          </For>
        </div>
      </section>
    </div>
  )
}

function ApiKeyStatus(props: { status: TApiKeyStatus }) {
  return (
    <>
      <Show when={props.status.status === "saving"}>
        <p>Saving API key…</p>
      </Show>
      <Show when={props.status.status === "removing"}>
        <p>Removing API key…</p>
      </Show>
      <Show when={(props.status.status === "success" || props.status.status === "error") && "message" in props.status}>
        <p>{"message" in props.status ? props.status.message : ""}</p>
      </Show>
    </>
  )
}

function SwitchLoginStatus(props: { status: TLoginStatus }) {
  return (
    <>
      <Show when={props.status.status === "pending"}>
        <p>Starting device login…</p>
      </Show>
      <Show when={props.status.status === "progress" && "message" in props.status}>
        <p>{"message" in props.status ? props.status.message : "Waiting for authorization…"}</p>
      </Show>
      <Show when={props.status.status === "device-code" && "verificationUri" in props.status}>
        <div class="ai-chat-device-flow">
          <span>Open this page and enter the code:</span>
          <a href={"verificationUri" in props.status ? props.status.verificationUri : "#"} target="_blank" rel="noopener noreferrer">
            {"verificationUri" in props.status ? props.status.verificationUri : ""}
          </a>
          <Show when={"userCode" in props.status && props.status.userCode}>
            <code>{"userCode" in props.status ? props.status.userCode : ""}</code>
          </Show>
          <Show when={"message" in props.status && props.status.message}>
            <p>{"message" in props.status ? props.status.message : ""}</p>
          </Show>
        </div>
      </Show>
      <Show when={props.status.status === "success"}>
        <p>Connected. Refreshing settings…</p>
      </Show>
      <Show when={props.status.status === "aborted"}>
        <p>Login cancelled.</p>
      </Show>
      <Show when={props.status.status === "error" && "message" in props.status}>
        <p>{"message" in props.status ? props.status.message : "Login failed"}</p>
      </Show>
    </>
  )
}
