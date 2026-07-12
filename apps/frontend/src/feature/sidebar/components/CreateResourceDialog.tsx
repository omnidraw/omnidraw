import * as Dialog from "@kobalte/core/dialog";
import { Button } from "@kobalte/core/button";
import { createEffect, createSignal, For, Show, type Component } from "solid-js";
import styles from "./SidebarDialog.module.css";

type TResourceKind = "kv" | "secretStore" | "db";

type TDbSchemaOption = {
  id: string;
  name: string;
  version: number;
};

type TCreateResourceValue = {
  kind: TResourceKind;
  name: string;
  db?: { schemaId: string; version: number };
  createSchema?: boolean;
};

type CreateResourceDialogProps = {
  open: boolean;
  schemas: TDbSchemaOption[];
  onOpenChange: (open: boolean) => void;
  onCreate: (value: TCreateResourceValue) => Promise<boolean>;
};

export const CreateResourceDialog: Component<CreateResourceDialogProps> = (props) => {
  const [kind, setKind] = createSignal<TResourceKind>("kv");
  const [name, setName] = createSignal("");
  const [schemaId, setSchemaId] = createSignal("");
  const [version, setVersion] = createSignal(0);
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    const firstSchema = props.schemas[0];
    setKind("kv");
    setName("");
    setSchemaId(firstSchema?.id ?? "");
    setVersion(firstSchema?.version ?? 0);
    setError("");
  });

  const handleSchemaChange = (id: string) => {
    setSchemaId(id);
    setVersion(props.schemas.find((schema) => schema.id === id)?.version ?? 0);
  };

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Resource name is required.");
      return;
    }
    if (kind() === "db" && !schemaId().trim()) {
      setError("Schema ID is required.");
      return;
    }

    setSubmitting(true);
    setError("");
    const value: TCreateResourceValue = kind() === "db"
      ? { kind: "db", name: trimmedName, db: { schemaId: schemaId().trim(), version: version() }, createSchema: props.schemas.length === 0 }
      : { kind: kind(), name: trimmedName };
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
              <Show
                when={props.schemas.length > 0}
                fallback={
                  <div class={styles.field}>
                    <label class={styles.label} for="resource-schema-id">New schema ID</label>
                    <input
                      id="resource-schema-id"
                      class={styles.input}
                      value={schemaId()}
                      disabled={submitting()}
                      onInput={(event) => setSchemaId(event.currentTarget.value)}
                      placeholder="example-schema"
                    />
                    <p class={styles.emptyLinked}>No published schemas exist. An empty schema will be published at version 0.</p>
                  </div>
                }
              >
                <div class={styles.field}>
                  <label class={styles.label} for="resource-schema">Schema</label>
                  <select
                    id="resource-schema"
                    class={styles.input}
                    value={schemaId()}
                    disabled={submitting()}
                    onChange={(event) => handleSchemaChange(event.currentTarget.value)}
                  >
                    <For each={props.schemas}>
                      {(schema) => <option value={schema.id}>{schema.name} ({schema.id})</option>}
                    </For>
                  </select>
                </div>
              </Show>
              <div class={styles.field}>
                <label class={styles.label} for="resource-version">Version</label>
                <input
                  id="resource-version"
                  class={styles.input}
                  type="number"
                  min="0"
                  max={props.schemas.find((schema) => schema.id === schemaId())?.version ?? 0}
                  value={version()}
                  disabled={submitting() || !schemaId() || props.schemas.length === 0}
                  onInput={(event) => setVersion(event.currentTarget.valueAsNumber)}
                />
              </div>
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
