import { Check } from "@/shell/framework/components/icons";
import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import { fnChangeSummary, fnStatusLabel } from "@/core/resources/fn.db-resource";
import type { TDbApplyDetails, TDbApplyPreview, TDbRestorePreview } from "@/core/resources/types";
import { Button, Checkbox, Dialog } from "../../resource/owned-primitives";
import styles from "../DbResourcePage.module.css";

type TPreview = TDbApplyPreview | TDbRestorePreview;
export type TCoordinatedOperationDialogProps = {
  open: boolean;
  mode: "apply" | "restore";
  loading: boolean;
  busy: boolean;
  preview: TPreview | null;
  run: TDbApplyDetails | null;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

const previewWarnings = (preview: TPreview | null): string[] => {
  if (!preview) return [];
  return "changes" in preview ? preview.warnings : [preview.warning];
};

export const CoordinatedOperationDialog: Component<TCoordinatedOperationDialogProps> = (props) => {
  const [acknowledged, setAcknowledged] = createSignal(false);

  createEffect(
    () => props.open,
    (open) => {
      if (open) setAcknowledged(false);
    },
  );

  const title = () => props.run
    ? `${props.mode === "apply" ? "Apply" : "Restore"} status`
    : props.mode === "apply" ? "Review & apply" : "Restore retained backup";
  const applyPreview = () => props.preview && "changes" in props.preview ? props.preview : null;

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.dialogOverlay} />
        <Dialog.Content class={`${styles.dialogContent} ${styles.dialogWide}`}>
          <Dialog.Title class={styles.dialogTitle}>{title()}</Dialog.Title>
          <Dialog.Description class={styles.dialogDescription}>
            {props.mode === "apply"
              ? "Active function invocations are drained and fenced before the schema is applied."
              : "Active function invocations are drained and fenced before the verified backup is restored."}
          </Dialog.Description>

          <Show when={props.loading}><p class={styles.muted}>Fetching a fresh preview…</p></Show>
          <Show when={props.error}><p class={styles.error}>{props.error}</p></Show>

          <Show when={props.preview && !props.run}>
            <div class={styles.reviewGrid}>
              <section class={styles.ruledSection}>
                <h4 class={styles.sectionTitle}>{props.mode === "apply" ? "Ordered changes" : "Recovery impact"}</h4>
                <Show when={applyPreview()} fallback={<p class={styles.muted}>This replaces live data and structure with the retained backup.</p>}>
                  <ol class={styles.changeList}>
                    <For each={applyPreview()?.changes ?? []}>{(change) => (
                      <li><span class={styles.sequence}>{change.sequence}</span><strong>{fnChangeSummary(change)}</strong><code>{change.sql}</code></li>
                    )}</For>
                  </ol>
                </Show>
              </section>
              <section class={styles.ruledSection}>
                <h4 class={styles.sectionTitle}>Active resource uses</h4>
                <table class={styles.table}>
                  <thead><tr><th>Use</th><th>Kind</th><th>Observed</th></tr></thead>
                  <tbody><For each={props.preview?.impact.uses.uses ?? []} fallback={<tr><td colspan={3} class={styles.muted}>No active uses.</td></tr>}>{(use) => (
                    <tr>
                      <td>{use.label ?? use.id}</td>
                      <td>{use.kind}</td>
                      <td>{use.state}</td>
                    </tr>
                  )}</For></tbody>
                </table>
              </section>
            </div>
            <For each={previewWarnings(props.preview)}>{(warning) => <p class={styles.warning}>{warning}</p>}</For>
            <Show when={props.mode === "restore"}><p class={styles.warning}>Writes made after this retained backup will be permanently lost.</p></Show>
            <Checkbox.Root checked={acknowledged()} onChange={setAcknowledged} class={`${styles.checkboxRoot} ${styles.acknowledgementRoot}`}>
              <Checkbox.Input />
              <Checkbox.Control class={styles.checkboxControl}><Checkbox.Indicator><Check size={12} /></Checkbox.Indicator></Checkbox.Control>
              <Checkbox.Label class={styles.acknowledgementLabel}>I understand the coordinated operation and data-loss risk.</Checkbox.Label>
            </Checkbox.Root>
          </Show>

          <Show when={props.run}>
            {(run) => (
              <div class={styles.runStatus}>
                <div class={styles.phaseStrip} aria-label={`${props.mode} progress`}>
                  <For each={props.mode === "apply" ? ["preparing", "draining", "applying", "recovery"] : ["preparing", "draining", "restoring", "recovery"]}>
                    {(phase) => <span class={styles.phase}>{phase}</span>}
                  </For>
                </div>
                <p class={styles.statusLine}><i class={styles.statusDot} /> Database outcome: {fnStatusLabel(run().apply.status)}</p>
                <Show when={run().apply.lastError}><pre class={styles.errorBox}>{JSON.stringify(run().apply.lastError, null, 2)}</pre></Show>
                <Show when={run().drain}><p class={styles.statusLine}>Drain lease {run().drain?.leaseId} fenced {run().drain?.drainedUses.length ?? 0} active use(s).</p></Show>
              </div>
            )}
          </Show>

          <div class={styles.dialogActions}>
            <Dialog.CloseButton class={styles.button} disabled={props.busy}>{props.run ? "Close" : "Cancel"}</Dialog.CloseButton>
            <Show when={props.preview && !props.run}>
              <Button class={`${styles.button} ${props.mode === "restore" ? styles.dangerFill : styles.primary}`} disabled={props.loading || props.busy || !acknowledged()} onClick={props.onConfirm}>
                {props.busy ? "Starting…" : props.mode === "apply" ? "Confirm coordinated apply" : "Restore backup"}
              </Button>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
