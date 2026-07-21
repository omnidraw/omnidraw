import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { createEffect, createSignal, type Component } from "solid-js";
import styles from "./SidebarDialog.module.css";

export type RenameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (newName: string) => void;
};

export const RenameDialog: Component<RenameDialogProps> = (props) => {
  const [name, setName] = createSignal(props.currentName);

  const secondaryButtonClass = `${styles.button} ${styles.secondaryButton}`;
  const primaryButtonClass = `${styles.button} ${styles.primaryButton}`;

  createEffect(() => {
    if (props.open) {
      setName(props.currentName);
    }
  });

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
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <Dialog.Content class={styles.content}>
          <Dialog.Title class={styles.title}>Rename Canvas</Dialog.Title>
          <Dialog.Description class={styles.description}>
            Enter a new name for this canvas.
          </Dialog.Description>

          <div class={styles.field}>
            <label for="canvas-name" class={styles.label}>
              Canvas Name
            </label>
            <input
              id="canvas-name"
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              class={styles.input}
              autofocus
            />
          </div>

          <div class={styles.actions}>
            <Button
              class={secondaryButtonClass}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              class={primaryButtonClass}
              onClick={handleRename}
            >
              Rename
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};

export default RenameDialog;
