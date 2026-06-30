import { Dialog } from "@kobalte/core/dialog";
import "./index.css";
import { For, Show } from "solid-js";
import { HELP_CALLOUT, HELP_SECTIONS } from "./help.data";

type ICanvasHelpProps = {
  open: () => boolean;
  onOpenChange: (open: boolean) => void;
};

function ShortcutKeys(props: { keys: string[] }) {
  return (
    <div class="vc-canvas-help-shortcuts">
      <For each={props.keys}>
        {(key) => (
          <kbd class="vc-keycap">
            {key}
          </kbd>
        )}
      </For>
    </div>
  );
}

export function CanvasHelp(props: ICanvasHelpProps) {
  return (
    <Dialog open={props.open()} onOpenChange={props.onOpenChange}>
      <Dialog.Trigger
        type="button"
        class="vc-canvas-help-trigger"
        aria-label="Open canvas help"
        title="Help (?)"
      >
        <span class="vc-canvas-help-trigger-label">?</span>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay class="vc-canvas-help-overlay" />
        <Dialog.Content class="vc-canvas-help-dialog">
          <div class="vc-canvas-help-header">
            <div>
              <Dialog.Title class="vc-canvas-help-title">Help</Dialog.Title>
              <Dialog.Description class="vc-canvas-help-description">
                {HELP_CALLOUT}
              </Dialog.Description>
            </div>

            <Dialog.CloseButton
              class="vc-canvas-help-close"
              aria-label="Close help"
            >
              <span class="vc-canvas-help-close-label">x</span>
            </Dialog.CloseButton>
          </div>

          <div class="vc-canvas-help-grid">
            <For each={HELP_SECTIONS}>
              {(section) => (
                <section class="vc-canvas-help-section">
                  <div class="vc-canvas-help-section-header">
                    <h2 class="vc-canvas-help-section-title">{section.title}</h2>
                  </div>

                  <div>
                    <For each={section.items}>
                      {(item) => (
                        <div class="vc-canvas-help-item">
                          <div>
                            <div class="vc-canvas-help-item-label">{item.label}</div>
                            <Show when={item.note}>
                              <div class="vc-canvas-help-item-note">{item.note}</div>
                            </Show>
                          </div>

                          <Show when={item.keys && item.keys.length}>
                            <ShortcutKeys keys={item.keys!} />
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
