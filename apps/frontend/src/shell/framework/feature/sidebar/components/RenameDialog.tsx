import { Portal } from "@solidjs/web";
import { Show, createEffect, createSignal, createUniqueId, type Component } from "solid-js";
import { activateModalFocusScope } from "../../../components/ui/modal-focus-scope";
import styles from "./SidebarDialog.module.css";

export type RenameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (newName: string) => void;
  returnFocus?: () => HTMLElement | null;
};

export const RenameDialog: Component<RenameDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const nameId = createUniqueId();
  let content: HTMLDivElement | undefined;
  let nameInput: HTMLInputElement | undefined;

  const secondaryButtonClass = `${styles.button} ${styles.secondaryButton}`;
  const primaryButtonClass = `${styles.button} ${styles.primaryButton}`;

  createEffect(
    () => props.open ? props.currentName : null,
    (currentName) => {
      if (currentName !== null) setName(currentName);
    },
  );

  createEffect(
    () => props.open ? props.onOpenChange : null,
    (onOpenChange) => {
      if (onOpenChange === null) return;
      const deactivate = activateModalFocusScope({
        content: () => content,
        initialFocus: () => nameInput,
        onEscape: () => onOpenChange(false),
        ownerDocument: content?.ownerDocument ?? document,
        returnFocus: props.returnFocus,
      });
      queueMicrotask(() => {
        if (nameInput?.isConnected === true) nameInput.select();
      });
      return deactivate;
    },
  );

  const handleRename = () => {
    const trimmedName = name().trim();
    if (trimmedName && trimmedName !== props.currentName) {
      props.onRename(trimmedName);
    }
    props.onOpenChange(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRename();
    }
  };

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
          class={styles.content}
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <h2 id={titleId} class={styles.title}>Rename Canvas</h2>
          <p id={descriptionId} class={styles.description}>
            Enter a new name for this canvas.
          </p>

          <div class={styles.field}>
            <label for={nameId} class={styles.label}>
              Canvas Name
            </label>
            <input
              id={nameId}
              ref={(element) => { nameInput = element; }}
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              class={styles.input}
            />
          </div>

          <div class={styles.actions}>
            <button
              type="button"
              class={secondaryButtonClass}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              class={primaryButtonClass}
              onClick={handleRename}
            >
              Rename
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default RenameDialog;
