import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"

interface IProps {
  apiService: TOrpcSafeClient
}

export function ActorTab(props: IProps) {
  void props.apiService

  return (
    <div class="ai-wizzard-tab">
      <div class="ai-wizzard-section-grid">
        <section class="ai-wizzard-option-card ai-wizzard-option-card--selected">
          <span class="ai-wizzard-kicker">Actor</span>
          <strong>Repo health analyst</strong>
          <p>Reads build status, highlights breakages, and suggests the next inspection path.</p>
        </section>

        <section class="ai-wizzard-option-card">
          <span class="ai-wizzard-kicker">Scope</span>
          <strong>Selected repositories</strong>
          <p>Limit reads to projects attached to this canvas and the active team context.</p>
        </section>
      </div>
    </div>
  )
}
