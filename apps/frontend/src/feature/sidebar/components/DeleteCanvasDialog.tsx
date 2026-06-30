import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import type { Component } from "solid-js";
import type { TBackendCanvas } from "../../../types/backend.types";
import styles from "./SidebarDialog.module.css";

export type DeleteCanvasDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvas: TBackendCanvas | null;
  onDelete: () => void;
};

export const DeleteCanvasDialog: Component<DeleteCanvasDialogProps> = (props) => {
  const secondaryButtonClass = `${styles.button} ${styles.secondaryButton}`;
  const destructiveButtonClass = `${styles.button} ${styles.destructiveButton}`;

  const handleDelete = () => {
    props.onDelete();
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <Dialog.Content class={styles.content}>
          <Dialog.Title class={styles.title}>Delete Canvas</Dialog.Title>
          <Dialog.Description class={styles.description}>
            Are you sure you want to delete "{props.canvas?.name}"? This action cannot be undone.
          </Dialog.Description>

          <div class={styles.actions}>
            <Button
              class={secondaryButtonClass}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              class={destructiveButtonClass}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};

export default DeleteCanvasDialog;
