import { Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, Show, type Component } from "solid-js";
import { activateModalFocusScope } from "../../../components/ui/modal-focus-scope";
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
  const open = createMemo(() => props.open);
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();
  const kindId = createUniqueId();
  const nameId = createUniqueId();
  const errorId = createUniqueId();
  let content: HTMLDivElement | undefined;
  let nameInput: HTMLInputElement | undefined;
  let submitInFlight = false;
  let openGeneration = 0;

  createEffect(
    open,
    (open) => {
      openGeneration += 1;
      submitInFlight = false;
      setSubmitting(false);
      if (!open) return;
      setKind("kv");
      setName("");
      setError("");
    },
  );

  onCleanup(() => {
    openGeneration += 1;
    submitInFlight = false;
  });

  createEffect(
    open,
    (open) => {
      if (!open) return;
      return activateModalFocusScope({
        content: () => content,
        initialFocus: () => nameInput,
        onEscape: () => props.onOpenChange(false),
        ownerDocument: content?.ownerDocument ?? document,
      });
    },
  );

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (submitInFlight) return;
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Resource name is required.");
      return;
    }
    submitInFlight = true;
    setSubmitting(true);
    setError("");
    const requestGeneration = openGeneration;
    const onCreate = props.onCreate;
    const onOpenChange = props.onOpenChange;
    try {
      const value: TCreateResourceValue = { kind: kind(), name: trimmedName };
      const created = await onCreate(value);
      if (created && requestGeneration === openGeneration) onOpenChange(false);
    } finally {
      if (requestGeneration === openGeneration) {
        submitInFlight = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <Show when={open()}>
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
          <h2 id={titleId} class={styles.title}>Create resource</h2>
          <p id={descriptionId} class={styles.description}>
            Add shared infrastructure for widget revisions and server functions.
          </p>
          <form onSubmit={handleSubmit}>
            <div class={styles.field}>
              <label class={styles.label} for={kindId}>Resource type</label>
              <select
                id={kindId}
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
              <label class={styles.label} for={nameId}>Name</label>
              <input
                id={nameId}
                ref={(element) => { nameInput = element; }}
                class={styles.input}
                value={name()}
                disabled={submitting()}
                onInput={(event) => setName(event.currentTarget.value)}
                placeholder="Shared preferences"
                aria-invalid={error() ? "true" : undefined}
                aria-describedby={error() ? errorId : undefined}
              />
            </div>
            <Show when={kind() === "db"}>
              <p class={styles.emptyLinked}>The database starts empty. Create its tables from the Structure workbench after provisioning.</p>
            </Show>
            <Show when={error()}><p id={errorId} class={styles.formError} role="alert">{error()}</p></Show>
            <div class={styles.actions}>
              <button type="button" class={`${styles.button} ${styles.secondaryButton}`} disabled={submitting()} onClick={() => props.onOpenChange(false)}>Cancel</button>
              <button type="submit" class={`${styles.button} ${styles.primaryButton}`} disabled={submitting()}>{submitting() ? "Creating…" : "Create resource"}</button>
            </div>
          </form>
        </div>
      </Portal>
    </Show>
  );
};
