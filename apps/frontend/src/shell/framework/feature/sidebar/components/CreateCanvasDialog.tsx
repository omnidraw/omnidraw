import { Portal } from "@solidjs/web";
import { Show, createEffect, createSignal, createUniqueId, type Component } from "solid-js";
import { activateModalFocusScope } from "../../../components/ui/modal-focus-scope";
import styles from "./SidebarDialog.module.css";

export type CreateCanvasDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCanvasCreated: (title: string) => void;
};

export const CreateCanvasDialog: Component<CreateCanvasDialogProps> = (props) => {
  const [title, setTitle] = createSignal("");
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const fieldId = createUniqueId();
  let content: HTMLDivElement | undefined;
  let titleInput: HTMLInputElement | undefined;

  const contentClass = `${styles.content} ${styles.contentLarge}`;
  const actionsClass = `${styles.actions} ${styles.actionsSingle}`;
  const primaryButtonClass = `${styles.button} ${styles.primaryButton}`;

  createEffect(
    () => props.open ? props.onOpenChange : null,
    (onOpenChange) => {
      if (onOpenChange === null) return;
      const deactivate = activateModalFocusScope({
        content: () => content,
        initialFocus: () => titleInput,
        onEscape: () => onOpenChange(false),
        ownerDocument: content?.ownerDocument ?? document,
      });
      queueMicrotask(() => {
        if (titleInput?.isConnected === true) titleInput.select();
      });
      return deactivate;
    },
  );

  const handleCreate = (event?: SubmitEvent) => {
    event?.preventDefault();
    const finalTitle = title().trim() || "Untitled Canvas";
    props.onCanvasCreated(finalTitle);
    setTitle("");
    props.onOpenChange(false);
  };

  const isValid = () => title().trim().length > 0;

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={styles.overlay}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) props.onOpenChange(false);
          }}
        />
        <div
          ref={(element) => { content = element; }}
          class={contentClass}
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <h2 id={titleId} class={styles.title}>Create Your Canvas</h2>
          <p id={descriptionId} class={styles.description}>
            Give your canvas a title.
          </p>

          <form onSubmit={handleCreate}>
            <div class={styles.field}>
              <label for={fieldId} class={styles.label}>
                Canvas Title
              </label>
              <input
                id={fieldId}
                ref={(element) => { titleInput = element; }}
                type="text"
                placeholder="Untitled Canvas"
                value={title()}
                onInput={(event) => setTitle(event.currentTarget.value)}
                class={styles.input}
              />
            </div>

            <div class={actionsClass}>
              <button
                type="submit"
                class={primaryButtonClass}
                disabled={!isValid()}
              >
                Create Canvas
              </button>
            </div>
          </form>
        </div>
      </Portal>
    </Show>
  );
};

export default CreateCanvasDialog;
