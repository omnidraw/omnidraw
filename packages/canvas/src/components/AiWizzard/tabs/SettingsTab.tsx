import { For, Show, createMemo } from "solid-js"

type TAgentSettings = {
  providersWithCredentials: string[]
  providers: string[]
}

interface IProps {
  settings?: TAgentSettings
}

const SUBSCRIPTION_PROVIDERS = ["openai-codex", "github-copilot"] as const

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

  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--settings">
      <Show when={!hasCredentials()}>
        <section class="ai-wizzard-auth-callout" aria-live="polite">
          <strong>Login to an AI provider to start chatting</strong>
          <p>Connect a Pi subscription provider or add an API key for one of the supported providers.</p>
        </section>
      </Show>

      <section class="ai-wizzard-settings-section">
        <div class="ai-wizzard-settings-header">
          <span class="ai-wizzard-kicker">Subscriptions</span>
          <p>Use OAuth-based Pi subscriptions for providers that support browser login.</p>
        </div>

        <div class="ai-wizzard-provider-grid">
          <For each={subscriptionProviders()}>
            {(provider) => {
              const configured = () => configuredProviders().has(provider)
              return (
                <article class="ai-wizzard-provider-card">
                  <div>
                    <strong>{providerLabel(provider)}</strong>
                    <small>{configured() ? "Connected subscription" : "No subscription connected"}</small>
                  </div>
                  <button class="ai-wizzard-secondary-button" type="button">
                    {configured() ? "Reconnect" : "Log in"}
                  </button>
                </article>
              )
            }}
          </For>
        </div>
      </section>

      <section class="ai-wizzard-settings-section">
        <div class="ai-wizzard-settings-header">
          <span class="ai-wizzard-kicker">API keys</span>
          <p>API keys are stored by Pi. Existing keys are never displayed here.</p>
        </div>

        <div class="ai-wizzard-provider-grid">
          <For each={apiKeyProviders()}>
            {(provider) => {
              const configured = () => configuredProviders().has(provider)
              return (
                <article class="ai-wizzard-provider-card">
                  <div>
                    <strong>{providerLabel(provider)}</strong>
                    <small>{configured() ? "API key configured" : "No API key configured"}</small>
                  </div>
                  <button class="ai-wizzard-secondary-button" type="button">
                    {configured() ? "Update key" : "Add API key"}
                  </button>
                </article>
              )
            }}
          </For>
        </div>
      </section>
    </div>
  )
}
