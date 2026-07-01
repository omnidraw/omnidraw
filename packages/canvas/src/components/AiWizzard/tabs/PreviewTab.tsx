export function PreviewTab() {
  return (
    <div class="ai-wizzard-tab">
      <section class="ai-wizzard-preview-card">
        <div class="ai-wizzard-preview-header">
          <span>Repo Health</span>
          <strong>3 failing</strong>
        </div>
        <div class="ai-wizzard-preview-row">
          <span>api-service</span>
          <span class="ai-wizzard-status ai-wizzard-status--bad">failed</span>
        </div>
        <div class="ai-wizzard-preview-row">
          <span>web-client</span>
          <span class="ai-wizzard-status ai-wizzard-status--bad">failed</span>
        </div>
        <div class="ai-wizzard-preview-row">
          <span>docs</span>
          <span class="ai-wizzard-status ai-wizzard-status--good">passing</span>
        </div>
      </section>
    </div>
  )
}
