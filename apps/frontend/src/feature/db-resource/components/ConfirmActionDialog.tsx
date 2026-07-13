import * as AlertDialog from "@kobalte/core/alert-dialog";
import { Button } from "@kobalte/core/button";
import type { Component } from "solid-js";
import styles from "../DbResourcePage.module.css";

export type TConfirmActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export const ConfirmActionDialog: Component<TConfirmActionDialogProps> = (props) => (
  <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay class={styles.dialogOverlay} />
      <AlertDialog.Content class={styles.dialogContent}>
        <AlertDialog.Title class={styles.dialogTitle}>{props.title}</AlertDialog.Title>
        <AlertDialog.Description class={styles.dialogDescription}>{props.description}</AlertDialog.Description>
        <div class={styles.dialogActions}>
          <AlertDialog.CloseButton class={styles.button} disabled={props.busy}>Cancel</AlertDialog.CloseButton>
          <Button
            class={`${styles.button} ${props.destructive ? styles.dangerFill : styles.primary}`}
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {props.busy ? "Working…" : props.confirmLabel}
          </Button>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
