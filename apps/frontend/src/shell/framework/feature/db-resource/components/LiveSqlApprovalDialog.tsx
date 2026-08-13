import { Button } from "@kobalte/core/button";
import * as Checkbox from "@kobalte/core/checkbox";
import * as Dialog from "@kobalte/core/dialog";
import Check from "lucide-solid/icons/check";
import { Show, createEffect, createSignal, type Component } from "solid-js";
import styles from "../DbResourcePage.module.css";

export type TLiveSqlApprovalDialogProps = {
  open: boolean;
  sql: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export const LiveSqlApprovalDialog: Component<TLiveSqlApprovalDialogProps> = (props) => {
  const [acknowledged, setAcknowledged] = createSignal(false);

  createEffect(() => {
    if (props.open) setAcknowledged(false);
  });

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.dialogOverlay} />
        <Dialog.Content class={styles.dialogContent}>
          <Dialog.Title class={styles.dialogTitle}>Approve live database change</Dialog.Title>
          <Dialog.Description class={styles.dialogDescription}>
            This statement could change live data or schema. It did not run during the read-only safety check.
          </Dialog.Description>
          <p class={styles.warning}>Review the exact SQL before allowing it onto the serialized live write lane.</p>
          <pre class={`${styles.code} ${styles.sqlApprovalCode}`}>{props.sql}</pre>
          <Checkbox.Root checked={acknowledged()} onChange={setAcknowledged} class={`${styles.checkboxRoot} ${styles.acknowledgementRoot}`}>
            <Checkbox.Input />
            <Checkbox.Control class={styles.checkboxControl}><Checkbox.Indicator><Check size={15} /></Checkbox.Indicator></Checkbox.Control>
            <Checkbox.Label class={styles.acknowledgementLabel}>I reviewed this SQL and approve its changes to the live database.</Checkbox.Label>
          </Checkbox.Root>
          <div class={styles.dialogActions}>
            <Dialog.CloseButton class={styles.button} disabled={props.busy}>Cancel</Dialog.CloseButton>
            <Show when={props.open}>
              <Button class={`${styles.button} ${styles.dangerFill}`} disabled={props.busy || !acknowledged()} onClick={props.onConfirm}>
                {props.busy ? "Executing…" : "Approve & execute live"}
              </Button>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
