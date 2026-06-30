import { Show } from "solid-js";
import "./index.css";

type ICanvasRecorderProps = {
  open: () => boolean;
  onOpenChange: (open: boolean) => void;
  recording: () => boolean;
  stepCount: () => number;
  opCount: () => number;
  reducedEvents: () => boolean;
  onReducedEventsChange: (value: boolean) => void;
  canExport: () => boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onCopy: () => void;
  onExport: () => void;
};

function ActionButton(props: {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class="vc-canvas-recorder-action"
      classList={{
        "vc-canvas-recorder-action--danger": props.variant === "danger",
      }}
    >
      {props.label}
    </button>
  );
}

export function CanvasRecorder(props: ICanvasRecorderProps) {
  return (
    <div class="vc-canvas-recorder-anchor">
      <div class="vc-canvas-recorder-stack">
        <Show when={props.open()}>
          <div class="vc-canvas-recorder-panel">
            <div class="vc-canvas-recorder-header">
              <div>
                <div class="vc-canvas-recorder-title">Recorder</div>
                <div class="vc-canvas-recorder-state">
                  {props.recording() ? "REC" : "IDLE"}
                </div>
              </div>

              <div class="vc-canvas-recorder-status-shell">
                <div
                  class="vc-canvas-recorder-status-dot"
                  classList={{
                    "vc-canvas-recorder-status-dot--recording": props.recording(),
                  }}
                />
              </div>
            </div>

            <div class="vc-canvas-recorder-metrics">
              <span>Steps</span>
              <span class="vc-canvas-recorder-metric-value">{props.stepCount()}</span>
              <span>CRDT Ops</span>
              <span class="vc-canvas-recorder-metric-value">{props.opCount()}</span>
            </div>

            <div class="vc-canvas-recorder-actions">
              <Show
                when={!props.recording()}
                fallback={<ActionButton label="Stop" variant="danger" onClick={props.onStop} />}
              >
                <ActionButton label="Start" onClick={props.onStart} />
              </Show>
              <ActionButton label="Clear" onClick={props.onClear} />
              <ActionButton label="Copy" onClick={props.onCopy} disabled={!props.canExport()} />
              <ActionButton label="Export" onClick={props.onExport} disabled={!props.canExport()} />
            </div>

            <label class="vc-canvas-recorder-checkbox-row">
              <span>Reduced events</span>
              <input
                type="checkbox"
                checked={props.reducedEvents()}
                onInput={(event) => props.onReducedEventsChange(event.currentTarget.checked)}
                class="vc-canvas-recorder-checkbox"
              />
            </label>
          </div>
        </Show>

        <button
          type="button"
          class="vc-canvas-recorder-toggle"
          aria-label="Toggle recorder panel"
          title="Recorder"
          onClick={() => props.onOpenChange(!props.open())}
        >
          <div
            class="vc-canvas-recorder-toggle-dot"
            classList={{
              "vc-canvas-recorder-toggle-dot--recording": props.recording(),
            }}
          />
          <span class="vc-canvas-recorder-toggle-label">REC</span>
        </button>
      </div>
    </div>
  );
}
