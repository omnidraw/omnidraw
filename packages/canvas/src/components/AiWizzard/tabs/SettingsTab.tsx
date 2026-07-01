export function SettingsTab() {
  return (
    <div class="ai-wizzard-tab">
      <div class="ai-wizzard-section-grid">
        <label class="ai-wizzard-check-card">
          <input type="checkbox" checked />
          <span>
            <strong>Use canvas data</strong>
            <small>Read current repository selections when the widget runs.</small>
          </span>
        </label>

        <label class="ai-wizzard-check-card">
          <input type="checkbox" checked />
          <span>
            <strong>Show empty state</strong>
            <small>Display a clear message when no failing builds are found.</small>
          </span>
        </label>
      </div>
    </div>
  )
}
