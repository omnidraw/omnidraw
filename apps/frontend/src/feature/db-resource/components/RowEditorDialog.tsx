import { Button } from "@kobalte/core/button";
import * as Dialog from "@kobalte/core/dialog";
import * as TextField from "@kobalte/core/text-field";
import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import { fnCellEditorText, fnCellInputError, fnInputCell, fnRowInputOmitted } from "../fn.db-resource";
import type { TDbCellValue, TDbColumn, TDbRow } from "../types";
import styles from "../DbResourcePage.module.css";

export type TRowEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  tableName: string;
  columns: TDbColumn[];
  disabledColumns?: string[];
  disabledValues?: Record<string, string>;
  row: TDbRow | null;
  busy?: boolean;
  conflict?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: Record<string, TDbCellValue>) => void;
  onReload: () => void;
};

export const RowEditorDialog: Component<TRowEditorDialogProps> = (props) => {
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [validationError, setValidationError] = createSignal("");

  createEffect(() => {
    if (!props.open) return;
    setValues(Object.fromEntries(props.columns.map((column) => [
      column.name,
      props.disabledColumns?.includes(column.name)
        ? props.disabledValues?.[column.name] ?? "BLOB value"
        : fnCellEditorText(props.row?.values[column.name]),
    ])));
    setValidationError("");
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const includedColumns = props.columns.filter((column) => !props.disabledColumns?.includes(column.name) && !fnRowInputOmitted(props.mode, values()[column.name] ?? "", column));
    const inputError = includedColumns.map((column) => fnCellInputError(values()[column.name] ?? "", column)).find(Boolean);
    if (inputError) {
      setValidationError(inputError);
      return;
    }
    setValidationError("");
    props.onSubmit(Object.fromEntries(includedColumns.map((column) => [column.name, fnInputCell(values()[column.name] ?? "", column)])));
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.dialogOverlay} />
        <Dialog.Content class={`${styles.dialogContent} ${styles.dialogWide}`}>
          <Dialog.Title class={styles.dialogTitle}>{props.mode === "create" ? "Add row" : "Edit row"} · {props.tableName}</Dialog.Title>
          <Dialog.Description class={styles.dialogDescription}>
            {props.mode === "create"
              ? "Blank primary-key and defaulted fields are omitted so SQLite can generate them. Other blank nullable fields become NULL."
              : props.disabledColumns?.length
                ? "BLOB columns are not editable. Their previews are shown below and their stored values remain unchanged when you save."
                : "Empty values become NULL for nullable columns. Integer and blob values stay lossless on the wire."}
          </Dialog.Description>
          <form class={styles.rowForm} onSubmit={submit}>
            <For each={props.columns}>{(column) => (
              <TextField.Root disabled={props.disabledColumns?.includes(column.name)} value={values()[column.name] ?? ""} onChange={(value) => setValues((current) => ({ ...current, [column.name]: value }))}>
                <TextField.Label class={styles.label}>{column.name} <span class={styles.typeHint}>{column.declaredType || "ANY"}{props.disabledColumns?.includes(column.name) ? " · not editable" : ""}</span></TextField.Label>
                <TextField.Input class={styles.input} disabled={props.disabledColumns?.includes(column.name)} />
              </TextField.Root>
            )}</For>
            <Show when={props.conflict}>
              <div class={styles.conflict} role="alert">
                <strong>Optimistic conflict</strong>
                <p>{props.conflict} Your proposed values are preserved.</p>
                <Button type="button" class={styles.button} onClick={props.onReload}>Reload row</Button>
              </div>
            </Show>
            <Show when={validationError()}><p class={styles.rowValidationError} role="alert">{validationError()}</p></Show>
            <div class={styles.dialogActions}>
              <Dialog.CloseButton class={styles.button} disabled={props.busy}>Cancel</Dialog.CloseButton>
              <Button type="submit" class={`${styles.button} ${styles.primary}`} disabled={props.busy || (props.mode === "edit" && props.columns.every((column) => props.disabledColumns?.includes(column.name)))}>{props.busy ? "Saving…" : "Save row"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
