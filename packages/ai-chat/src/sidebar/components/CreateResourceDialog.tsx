import * as Dialog from "@kobalte/core/dialog";
import { Button } from "@kobalte/core/button";
import { createEffect, createSignal, Show, type Component } from "solid-js";
import styles from "./SidebarDialog.module.css";

type TResourceKind = "kv" | "secretStore" | "db";

type TCreateResourceValue = {
  kind: TResourceKind;
  name: string;
};

type CreateResourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (value: TCreateResourceValue) => Promise<boolean>;
};

export const CreateResourceDialog: Component<CreateResourceDialogProps> = (props) => {
  const [kind, setKind] = createSignal<TResourceKind>("kv");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    setKind("kv");
    setName("");
    setError("");
  });

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Resource name is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    const value: TCreateResourceValue = { kind: kind(), name: trimmedName };
    const created = await props.onCreate(value);
    setSubmitting(false);
    if (created) props.onOpenChange(false);
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <Dialog.Content class={styles.content}>
          <Dialog.Title class={styles.title}>Create resource</Dialog.Title>
          <Dialog.Description class={styles.description}>
            Add shared infrastructure for actor definitions.
          </Dialog.Description>
          <form onSubmit={handleSubmit}>
            <div class={styles.field}>
              <label class={styles.label} for="resource-kind">Resource type</label>
              <select
                id="resource-kind"
                class={styles.input}
                value={kind()}
                disabled={submitting()}
                onChange={(event) => setKind(event.currentTarget.value as TResourceKind)}
              >
                <option value="kv">Key-value</option>
                <option value="secretStore">Secret store</option>
                <option value="db">Database</option>
              </select>
            </div>
            <div class={styles.field}>
              <label class={styles.label} for="resource-name">Name</label>
              <input
                id="resource-name"
                class={styles.input}
                value={name()}
                disabled={submitting()}
                onInput={(event) => setName(event.currentTarget.value)}
                placeholder="Shared preferences"
                autofocus
              />
            </div>
            <Show when={kind() === "db"}>
              <p class={styles.emptyLinked}>The database starts empty. Create its tables from the Structure workbench after provisioning.</p>
            </Show>
            <Show when={error()}><p class={styles.formError}>{error()}</p></Show>
            <div class={styles.actions}>
              <Button type="button" class={`${styles.button} ${styles.secondaryButton}`} disabled={submitting()} onClick={() => props.onOpenChange(false)}>Cancel</Button>
              <Button type="submit" class={`${styles.button} ${styles.primaryButton}`} disabled={submitting()}>{submitting() ? "Creating…" : "Create resource"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
