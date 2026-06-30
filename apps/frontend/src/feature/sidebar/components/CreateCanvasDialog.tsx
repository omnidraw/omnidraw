import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { createSignal, type Component } from "solid-js";
import styles from "./SidebarDialog.module.css";

export type CreateCanvasDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCanvasCreated: (title: string) => void;
};

export const CreateCanvasDialog: Component<CreateCanvasDialogProps> = (props) => {
  const [title, setTitle] = createSignal("");

  const contentClass = `${styles.content} ${styles.contentLarge}`;
  const actionsClass = `${styles.actions} ${styles.actionsSingle}`;
  const primaryButtonClass = `${styles.button} ${styles.primaryButton}`;

  const handleCreate = () => {
    const finalTitle = title().trim() || "Untitled Canvas";
    props.onCanvasCreated(finalTitle);
    setTitle("");
    props.onOpenChange(false);
  };

  const isValid = () => title().trim().length > 0;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <Dialog.Content class={contentClass}>
          <Dialog.Title class={styles.title}>Create Your Canvas</Dialog.Title>
          <Dialog.Description class={styles.description}>
            Give your canvas a title.
          </Dialog.Description>

          <div class={styles.field}>
            <label for="canvas-title" class={styles.label}>
              Canvas Title
            </label>
            <input
              id="canvas-title"
              type="text"
              placeholder="Untitled Canvas"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              class={styles.input}
              autofocus
            />
          </div>

          <div class={actionsClass}>
            <Button
              class={primaryButtonClass}
              onClick={handleCreate}
              disabled={!isValid()}
            >
              Create Canvas
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};

export default CreateCanvasDialog;
