import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { Show, type Accessor } from "solid-js";
import type { TConfirmDialogRequest } from "../../services/confirm-dialog/ConfirmDialogService";
import "./styles.css";

export function CanvasConfirmDialog(props: {
  request: Accessor<TConfirmDialogRequest | null>;
  onResolve: (confirmed: boolean) => void;
}) {
  const open = () => props.request() !== null;
  const cancelLabel = () => props.request()?.cancelLabel ?? "Cancel";
  const confirmClass = () => props.request()?.destructive
    ? "vc-confirm-dialog-button vc-confirm-dialog-button--destructive"
    : "vc-confirm-dialog-button vc-confirm-dialog-button--primary";

  return (
    <Dialog open={open()} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        props.onResolve(false);
      }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay class="vc-confirm-dialog-overlay" />
        <Dialog.Content class="vc-confirm-dialog-content">
          <Show when={props.request()}>
            {(request) => (
              <>
                <Dialog.Title class="vc-confirm-dialog-title">{request().title}</Dialog.Title>
                <Dialog.Description class="vc-confirm-dialog-description">
                  {request().description}
                </Dialog.Description>

                <div class="vc-confirm-dialog-actions">
                  <Button
                    class="vc-confirm-dialog-button vc-confirm-dialog-button--secondary"
                    onClick={() => props.onResolve(false)}
                  >
                    {cancelLabel()}
                  </Button>
                  <Button
                    class={confirmClass()}
                    onClick={() => props.onResolve(true)}
                  >
                    {request().confirmLabel}
                  </Button>
                </div>
              </>
            )}
          </Show>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
