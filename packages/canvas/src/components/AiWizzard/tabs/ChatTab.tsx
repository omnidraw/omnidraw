export function ChatTab() {
  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--intent">
      <label class="ai-wizzard-field">
        <span class="ai-wizzard-label">What widget should AI build?</span>
        <textarea
          class="ai-wizzard-textarea"
          value="Build a repo health widget that shows failing builds first"
          aria-label="Widget Chat Wizzard"
        />
      </label>

      <div class="ai-wizzard-summary-grid" aria-label="chat build summary">
        <section class="ai-wizzard-summary-card">
          <div class="ai-wizzard-summary-title">
            <span aria-hidden="true">◇</span>
            <span>Purpose</span>
          </div>
          <p>Track repository build health</p>
        </section>

        <section class="ai-wizzard-summary-card">
          <div class="ai-wizzard-summary-title">
            <span aria-hidden="true">▣</span>
            <span>Data</span>
          </div>
          <p>CI builds from selected repos</p>
        </section>

        <section class="ai-wizzard-summary-card">
          <div class="ai-wizzard-summary-title">
            <span aria-hidden="true">✣</span>
            <span>User action</span>
          </div>
          <p>Filter, drill in to failed builds</p>
        </section>

        <section class="ai-wizzard-summary-card">
          <div class="ai-wizzard-summary-title">
            <span aria-hidden="true">⬡</span>
            <span>Empty state</span>
          </div>
          <p>No builds found in time range</p>
        </section>
      </div>

      <div class="ai-wizzard-actions">
        <button class="ai-wizzard-primary-button" type="button">
          <span>Next</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  )
}
