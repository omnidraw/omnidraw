import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type {
  IAiChatActions,
  TAiChatLoginStatus,
  TAiChatSettings,
} from "../../../contracts.js"
import type { AiChatEffectRuntime } from "../../../internal/stream-lifecycle.js"

type TProviderId = "openai-codex" | "github-copilot"
type TLoginStatus =
  | { status: "idle" }
  | TAiChatLoginStatus

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
  settings?: TAiChatSettings
  actions: IAiChatActions
  lifecycle: AiChatEffectRuntime
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
  const setProviderState = (provider: string, state: TLoginUiState) => {
    setLoginStateByProvider((current) => ({ ...current, [provider]: state }))
  }

  const clearPoll = (provider: string) => {
    props.lifecycle.close(`settings:login-poll:${provider}`)
  }

  const pollLogin = (provider: TProviderId, loginId: string) => {
    clearPoll(provider)
    props.lifecycle.startPoll(`settings:login-poll:${provider}`, {
      intervalMs: POLL_MS,
      run: () => props.actions.getLoginStatus(loginId),
      onValue(data) {
        setProviderState(provider, { loginId, status: data })
        if (data.status === "success") {
          props.onSettingsChanged?.()
          return "stop"
        }
        if (data.status === "error" || data.status === "aborted") {
          return "stop"
        }
        return "continue"
      },
      onError(error) {
        setProviderState(provider, {
          loginId,
          status: {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        })
      },
    })
  }

  const startLogin = (provider: TProviderId) => {
    const active = loginStateByProvider()[provider]
    if (active?.loginId && (active.status.status === "pending" || active.status.status === "device-code" || active.status.status === "progress")) return

    setProviderState(provider, { status: { status: "pending" } })
    props.lifecycle.startLatest(`settings:login-start:${provider}`, {
      run: () => props.actions.beginLogin(provider),
      onSuccess(data) {
        setProviderState(provider, { loginId: data.loginId, status: { status: "pending" } })
        pollLogin(provider, data.loginId)
      },
      onError(error) {
        setProviderState(provider, {
          status: {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        })
      },
    })
  }

  const abortLogin = (provider: TProviderId) => {
    const active = loginStateByProvider()[provider]
    if (!active?.loginId) return

    clearPoll(provider)
    props.lifecycle.startLatest(`settings:login-abort:${provider}`, {
      run: () => props.actions.abortLogin(active.loginId!),
      onSuccess: () => setProviderState(provider, { loginId: active.loginId, status: { status: "aborted" } }),
      onError(error) {
        setProviderState(provider, {
          loginId: active.loginId,
          status: { status: "error", message: error instanceof Error ? error.message : String(error) },
        })
      },
    })
  }

  const logout = (provider: TProviderId) => {
    clearPoll(provider)
    props.lifecycle.startLatest(`settings:logout:${provider}`, {
      run: () => props.actions.logout(provider),
      onSuccess() {
        setProviderState(provider, { status: { status: "aborted" } })
        props.onSettingsChanged?.()
      },
      onError(error) {
        setProviderState(provider, {
          status: { status: "error", message: error instanceof Error ? error.message : String(error) },
        })
      },
    })
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

  const saveApiKey = (provider: string) => {
    const key = apiKeyDraftByProvider()[provider]?.trim() ?? ""
    if (!key) {
      setApiKeyStatus(provider, { status: "error", message: "Paste an API key before saving." })
      return
    }

    setApiKeyStatus(provider, { status: "saving" })
    props.lifecycle.startLatest(`settings:api-key:${provider}`, {
      run: () => props.actions.setApiKey(provider, key),
      onSuccess() {
        setApiKeyDraft(provider, "")
        setApiKeyStatus(provider, { status: "success", message: "API key saved." })
        setApiKeyExpanded(provider, false)
        props.onSettingsChanged?.()
      },
      onError(error) {
        setApiKeyStatus(provider, { status: "error", message: error instanceof Error ? error.message : String(error) })
      },
    })
  }

  const removeApiKey = (provider: string) => {
    setApiKeyStatus(provider, { status: "removing" })
    props.lifecycle.startLatest(`settings:api-key:${provider}`, {
      run: () => props.actions.removeApiKey(provider),
      onSuccess() {
        setApiKeyDraft(provider, "")
        setApiKeyStatus(provider, { status: "success", message: "API key removed." })
        setApiKeyExpanded(provider, false)
        props.onSettingsChanged?.()
      },
      onError(error) {
        setApiKeyStatus(provider, { status: "error", message: error instanceof Error ? error.message : String(error) })
      },
    })
  }

  onCleanup(() => {
    props.lifecycle.closeMatching("settings:")
    for (const state of Object.values(loginStateByProvider())) {
      if (state.loginId && (state.status.status === "pending" || state.status.status === "device-code" || state.status.status === "progress")) {
        props.lifecycle.startLatest(`login-cleanup:${state.loginId}`, {
          run: () => props.actions.abortLogin(state.loginId!),
          onSuccess: () => undefined,
          onError: () => undefined,
        })
      }
    }
  })

  return (
    <div class="omnidraw-ai-chat-tab omnidraw-ai-chat-tab--settings">
      <Show when={!hasCredentials()}>
        <section class="omnidraw-ai-chat-auth-callout" aria-live="polite">
          <strong>Login to an AI provider to start chatting</strong>
          <p>Connect a Pi subscription provider or add an API key for one of the supported providers.</p>
        </section>
      </Show>

      <section class="omnidraw-ai-chat-settings-section">
        <div class="omnidraw-ai-chat-settings-header">
          <span class="omnidraw-ai-chat-kicker">Subscriptions</span>
          <p>Use OAuth-based Pi subscriptions for providers that support browser login.</p>
        </div>

        <div class="omnidraw-ai-chat-provider-grid">
          <For each={subscriptionProviders()}>
            {(provider) => {
              const configured = () => configuredProviders().has(provider)
              const state = () => loginStateByProvider()[provider]?.status ?? { status: "idle" } as TLoginStatus
              const active = () => state().status === "pending" || state().status === "device-code" || state().status === "progress"
              return (
                <article classList={{ "omnidraw-ai-chat-provider-card": true, "omnidraw-ai-chat-provider-card--expanded": active() || state().status === "success" || state().status === "error" || state().status === "aborted" }}>
                  <div class="omnidraw-ai-chat-provider-card__main">
                    <strong>{providerLabel(provider)}</strong>
                    <small>{configured() ? "Connected subscription" : "No subscription connected"}</small>
                  </div>
                  <div class="omnidraw-ai-chat-provider-card__actions">
                    <button class="omnidraw-ai-chat-secondary-button" type="button" disabled={active()} onClick={() => void startLogin(provider)}>
                      {configured() ? "Reconnect" : "Log in"}
                    </button>
                    <Show when={configured() && !active()}>
                      <button class="omnidraw-ai-chat-secondary-button omnidraw-ai-chat-secondary-button--danger" type="button" onClick={() => void logout(provider)}>
                        Logout
                      </button>
                    </Show>
                    <Show when={active()}>
                      <button class="omnidraw-ai-chat-secondary-button omnidraw-ai-chat-secondary-button--danger" type="button" onClick={() => void abortLogin(provider)}>
                        Cancel
                      </button>
                    </Show>
                  </div>

                  <Show when={state().status !== "idle"}>
                    <div class="omnidraw-ai-chat-login-box" aria-live="polite">
                      <SwitchLoginStatus status={state()} />
                    </div>
                  </Show>
                </article>
              )
            }}
          </For>
        </div>
      </section>

      <section class="omnidraw-ai-chat-settings-section">
        <div class="omnidraw-ai-chat-settings-header">
          <span class="omnidraw-ai-chat-kicker">API keys</span>
          <p>API keys are stored by Pi. Existing keys are never displayed here.</p>
        </div>

        <div class="omnidraw-ai-chat-provider-grid">
          <For each={apiKeyProviders()}>
            {(provider) => {
              const configured = () => configuredProviders().has(provider)
              const status = () => apiKeyStatusByProvider()[provider] ?? { status: "idle" } as TApiKeyStatus
              const draft = () => apiKeyDraftByProvider()[provider] ?? ""
              const expanded = () => expandedApiKeyProviderMap()[provider] ?? false
              const busy = () => status().status === "saving" || status().status === "removing"
              return (
                <article classList={{ "omnidraw-ai-chat-provider-card": true, "omnidraw-ai-chat-provider-card--api-key": true, "omnidraw-ai-chat-provider-card--expanded": expanded() || status().status === "success" || status().status === "error" }}>
                  <div class="omnidraw-ai-chat-provider-card__main">
                    <strong>{providerLabel(provider)}</strong>
                    <small>{configured() ? "API key configured" : "No API key configured"}</small>
                  </div>
                  <div class="omnidraw-ai-chat-provider-card__actions">
                    <button class="omnidraw-ai-chat-secondary-button" type="button" disabled={busy()} onClick={() => setApiKeyExpanded(provider, !expanded())}>
                      {expanded() ? "Close" : configured() ? "Update key" : "Add API key"}
                    </button>
                    <Show when={configured()}>
                      <button class="omnidraw-ai-chat-secondary-button omnidraw-ai-chat-secondary-button--danger" type="button" disabled={busy()} onClick={() => void removeApiKey(provider)}>
                        Remove
                      </button>
                    </Show>
                  </div>

                  <Show when={expanded()}>
                    <div class="omnidraw-ai-chat-api-key-box">
                      <label class="omnidraw-ai-chat-api-key-field">
                        <span>{configured() ? "Paste a replacement API key" : "Paste API key"}</span>
                        <input
                          class="omnidraw-ai-chat-api-key-input"
                          type="password"
                          autocomplete="off"
                          spellcheck={false}
                          value={draft()}
                          placeholder={configured() ? "Existing key is hidden" : "sk-..."}
                          disabled={busy()}
                          onInput={(event) => setApiKeyDraft(provider, event.currentTarget.value)}
                        />
                      </label>
                      <div class="omnidraw-ai-chat-provider-card__actions">
                        <button class="omnidraw-ai-chat-secondary-button" type="button" disabled={busy() || draft().trim().length === 0} onClick={() => void saveApiKey(provider)}>
                          {configured() ? "Save new key" : "Save key"}
                        </button>
                      </div>
                    </div>
                  </Show>

                  <Show when={status().status !== "idle"}>
                    <div class="omnidraw-ai-chat-login-box" aria-live="polite">
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
        <div class="omnidraw-ai-chat-device-flow">
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
