import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import * as TextField from "@kobalte/core/text-field";
import { ToolIconPicker } from "@vibecanvas/canvas/components/ToolIconPicker/ToolIconPicker";
import type { Component } from "solid-js";
import { For, Show, createEffect, createSignal } from "solid-js";
import styles from "./SidebarDialog.module.css";

export type TToolGroupValue = {
  name: string;
  json: { lucidIcon?: string; svgIcon?: string } | null;
};

export type ToolGroupDialogProps = {
  open: boolean;
  group: TToolGroupValue | null;
  linkedWidgets: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (group: TToolGroupValue) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
};

export const ToolGroupDialog: Component<ToolGroupDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  const [icon, setIcon] = createSignal<TToolGroupValue["json"]>(null);
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    setName(props.group?.name ?? "");
    setIcon(props.group?.json ?? null);
    setError("");
  });

  const handleSave = async (event: SubmitEvent) => {
    event.preventDefault();
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Group name is required.");
      return;
    }

    setSaving(true);
    setError("");
    const saved = await props.onSave({ name: trimmedName, json: icon() });
    setSaving(false);
    if (saved) props.onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!props.group) return;
    setSaving(true);
    const deleted = await props.onDelete();
    setSaving(false);
    if (deleted) props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <Dialog.Content class={`${styles.content} ${styles.contentLarge}`}>
          <Dialog.Title class={styles.title}>{props.group ? "Edit Tool Group" : "Add Tool Group"}</Dialog.Title>
          <Dialog.Description class={styles.description}>
            A Tool Group combines related widget tools into one toolbar button. Selecting that button opens a flyout containing the linked widgets.
          </Dialog.Description>

          <form onSubmit={handleSave}>
            <TextField.Root class={styles.field} value={name()} onChange={setName}>
              <TextField.Label class={styles.label}>Name</TextField.Label>
              <TextField.Input class={styles.input} autocomplete="off" />
            </TextField.Root>

            <div class={styles.field}><ToolIconPicker value={icon()} onChange={setIcon} /></div>

            <Show when={props.group}>
              <div class={styles.linkedSection}>
                <div class={styles.label}>Linked widgets</div>
                <Show when={props.linkedWidgets.length > 0} fallback={<p class={styles.emptyLinked}>No widgets reference this group.</p>}>
                  <ul class={styles.linkedList}>
                    <For each={props.linkedWidgets}>{(widget) => <li>{widget}</li>}</For>
                  </ul>
                </Show>
              </div>
            </Show>

            <Show when={error()}>{(message) => <p class={styles.formError} role="alert">{message()}</p>}</Show>

            <div class={`${styles.actions} ${props.group ? styles.actionsSpread : ""}`}>
              <Show when={props.group}>
                <Button type="button" class={`${styles.button} ${styles.destructiveButton}`} disabled={saving()} onClick={handleDelete}>Delete</Button>
              </Show>
              <div class={styles.actionCluster}>
                <Button type="button" class={`${styles.button} ${styles.secondaryButton}`} disabled={saving()} onClick={() => props.onOpenChange(false)}>Cancel</Button>
                <Button type="submit" class={`${styles.button} ${styles.primaryButton}`} disabled={saving()}>{saving() ? "Saving…" : "Save"}</Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};
