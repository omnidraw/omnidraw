import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"

interface IProps {
  actor: TVibecanvasJson | null
  apiService: TOrpcSafeClient
}

export function ActorTab(props: IProps) {
  void props.apiService

  if (props.actor === null) {
    return (
      <div class="ai-wizzard-tab">
        <section class="ai-wizzard-option-card ai-wizzard-option-card--selected">
          <span class="ai-wizzard-kicker">Actor</span>
          <strong>No actor loaded</strong>
          <p>Ask the chat to generate an actor/widget first. Once an actor candidate exists, this tab will show the manifest for inspection.</p>
        </section>
      </div>
    )
  }

  return (
    <div class="ai-wizzard-tab">
      <div class="ai-wizzard-section-grid">
        <section class="ai-wizzard-option-card ai-wizzard-option-card--selected">
          <span class="ai-wizzard-kicker">Actor</span>
          <strong>{props.actor.name}</strong>
          <p>{props.actor.description ?? "No description yet."}</p>
        </section>

        <section class="ai-wizzard-option-card">
          <span class="ai-wizzard-kicker">Initial state</span>
          <strong>{props.actor.actor.initialState}</strong>
          <p>This actor manifest is loaded for inspection. Runtime actor execution is not connected here.</p>
        </section>
      </div>
    </div>
  )
}
