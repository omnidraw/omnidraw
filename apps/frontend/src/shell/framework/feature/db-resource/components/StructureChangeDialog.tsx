import { Button } from "@kobalte/core/button";
import * as Checkbox from "@kobalte/core/checkbox";
import * as Dialog from "@kobalte/core/dialog";
import * as Select from "@kobalte/core/select";
import * as Switch from "@kobalte/core/switch";
import * as TextField from "@kobalte/core/text-field";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Check from "lucide-solid/icons/check";
import { Show, createEffect, createSignal, type Component } from "solid-js";
import type { TDbColumn } from "@/core/resources/types";
import styles from "../DbResourcePage.module.css";

export type TStructureOperationKind =
  | "createTable"
  | "renameTable"
  | "dropTable"
  | "addColumn"
  | "renameColumn"
  | "alterColumn"
  | "dropColumn"
  | "createIndex"
  | "dropIndex"
  | "createForeignKey"
  | "dropForeignKey";

export type TStructureChangeDialogProps = {
  open: boolean;
  kind: TStructureOperationKind;
  tableName?: string;
  columnName?: string;
  column?: TDbColumn;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (operation: Record<string, unknown>) => void;
};

const COLUMN_TYPES = ["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "ANY"];
const STRICT_COLUMN_TYPES = ["TEXT", "INTEGER", "REAL", "BLOB", "ANY"];

const operationTitle = (kind: TStructureOperationKind) => ({
  createTable: "Create table",
  renameTable: "Rename table",
  dropTable: "Drop table",
  addColumn: "Add column",
  renameColumn: "Rename column",
  alterColumn: "Edit column",
  dropColumn: "Drop column",
  createIndex: "Create index",
  dropIndex: "Drop index",
  createForeignKey: "Create foreign key",
  dropForeignKey: "Drop foreign key",
})[kind];

const isDestructive = (kind: TStructureOperationKind) => ["dropTable", "dropColumn", "dropIndex", "dropForeignKey", "alterColumn"].includes(kind);

export const StructureChangeDialog: Component<TStructureChangeDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  const [nextName, setNextName] = createSignal("");
  const [declaredType, setDeclaredType] = createSignal("TEXT");
  const [nullable, setNullable] = createSignal(true);
  const [primaryKey, setPrimaryKey] = createSignal(false);
  const [unique, setUnique] = createSignal(false);
  const [strict, setStrict] = createSignal(true);
  const [withoutRowid, setWithoutRowid] = createSignal(false);
  const [defaultValue, setDefaultValue] = createSignal("");
  const [columns, setColumns] = createSignal("");
  const [referenceTable, setReferenceTable] = createSignal("");
  const [referenceColumns, setReferenceColumns] = createSignal("");

  createEffect(() => {
    if (!props.open) return;
    setName(["dropIndex", "dropForeignKey"].includes(props.kind) ? props.columnName ?? "" : "");
    setNextName("");
    setDeclaredType(props.column?.declaredType || "TEXT");
    setNullable(props.column?.nullable ?? true);
    setDefaultValue(props.column?.defaultSql ?? "");
    setColumns(props.kind === "createTable" ? "id" : props.columnName ?? "");
    setPrimaryKey(props.kind === "createTable" || Boolean(props.column?.primaryKeyOrder));
    setUnique(false);
    setStrict(true);
    setWithoutRowid(false);
    setReferenceTable("");
    setReferenceColumns("");
  });

  createEffect(() => {
    if (props.kind === "createTable" && strict() && !STRICT_COLUMN_TYPES.includes(declaredType())) setDeclaredType("TEXT");
  });

  const columnTypes = () => props.kind === "createTable" && strict() ? STRICT_COLUMN_TYPES : COLUMN_TYPES;

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const tableName = props.tableName ?? (props.kind === "createTable" ? name().trim() : "");
    const columnName = props.columnName ?? (["addColumn", "createIndex"].includes(props.kind) ? name().trim() : name().trim());
    const base: Record<string, unknown> = { kind: props.kind, table: tableName };
    if (props.kind === "createTable") Object.assign(base, {
      table: name().trim(),
      columns: [{ name: columns().trim(), declaredType: declaredType(), nullable: nullable(), primaryKeyOrder: primaryKey() ? 1 : null }],
      strict: strict(),
      withoutRowid: withoutRowid(),
    });
    if (props.kind === "renameTable") Object.assign(base, { newName: nextName().trim() });
    if (props.kind === "dropTable") Object.assign(base, { table: props.tableName });
    if (props.kind === "addColumn") Object.assign(base, { column: { name: columnName, declaredType: declaredType(), nullable: nullable(), defaultSql: defaultValue().trim() || null, primaryKeyOrder: primaryKey() ? 1 : null } });
    if (props.kind === "alterColumn") Object.assign(base, { column: columnName, definition: { name: columnName, declaredType: declaredType(), nullable: nullable(), defaultSql: defaultValue().trim() || null, primaryKeyOrder: primaryKey() ? 1 : null } });
    if (props.kind === "renameColumn") Object.assign(base, { column: props.columnName ?? name().trim(), newName: nextName().trim() });
    if (props.kind === "dropColumn") Object.assign(base, { column: props.columnName ?? name().trim() });
    if (props.kind === "createIndex") Object.assign(base, { name: name().trim(), columns: columns().split(",").map((value) => value.trim()).filter(Boolean), unique: unique() });
    if (props.kind === "dropIndex") {
      delete base.table;
      Object.assign(base, { name: name().trim() });
    }
    if (props.kind === "createForeignKey") Object.assign(base, {
      columns: columns().split(",").map((value) => value.trim()).filter(Boolean),
      referencedTable: referenceTable().trim(),
      referencedColumns: referenceColumns().split(",").map((value) => value.trim()).filter(Boolean),
    });
    if (props.kind === "dropForeignKey") Object.assign(base, { id: Number(name().trim()) });
    props.onSubmit(base);
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.dialogOverlay} />
        <Dialog.Content class={styles.dialogContent}>
          <Dialog.Title class={styles.dialogTitle}>{operationTitle(props.kind)}</Dialog.Title>
          <Dialog.Description class={styles.dialogDescription}>
            This change is applied to the physical draft. The live database remains unchanged until coordinated apply.
          </Dialog.Description>
          <form class={styles.form} onSubmit={submit}>
            <Show when={["createTable", "addColumn", "createIndex", "dropIndex", "dropForeignKey"].includes(props.kind)}>
              <TextField.Root value={name()} onChange={setName}>
                <TextField.Label class={styles.label}>{props.kind === "createTable" ? "Table name" : props.kind.includes("Index") ? "Index name" : props.kind === "dropForeignKey" ? "Foreign key ID" : "Column name"}</TextField.Label>
                <TextField.Input class={styles.input} autofocus />
              </TextField.Root>
            </Show>
            <Show when={["renameTable", "renameColumn"].includes(props.kind)}>
              <TextField.Root value={nextName()} onChange={setNextName}>
                <TextField.Label class={styles.label}>New name</TextField.Label>
                <TextField.Input class={styles.input} autofocus />
              </TextField.Root>
            </Show>
            <Show when={["createTable", "addColumn", "alterColumn"].includes(props.kind)}>
              <Select.Root<string>
                options={columnTypes()}
                value={declaredType()}
                onChange={(value) => value && setDeclaredType(value)}
                itemComponent={(itemProps) => (
                  <Select.Item item={itemProps.item} class={styles.selectItem}>
                    <Select.ItemLabel>{itemProps.item.rawValue}</Select.ItemLabel>
                    <Select.ItemIndicator><Check size={12} /></Select.ItemIndicator>
                  </Select.Item>
                )}
              >
                <Select.Label class={styles.label}>Declared type</Select.Label>
                <Select.Trigger class={styles.selectTrigger}>
                  <Select.Value<string>>{(state) => state.selectedOption()}</Select.Value>
                  <Select.Icon><ChevronDown size={13} /></Select.Icon>
                </Select.Trigger>
                <Select.HiddenSelect />
                <Select.Portal><Select.Content class={styles.selectContent}><Select.Listbox /></Select.Content></Select.Portal>
              </Select.Root>
              <TextField.Root value={defaultValue()} onChange={setDefaultValue}>
                <TextField.Label class={styles.label}>Default expression (optional)</TextField.Label>
                <TextField.Input class={styles.input} placeholder="NULL" />
              </TextField.Root>
              <Switch.Root checked={nullable()} onChange={setNullable} class={styles.switchRoot}>
                <Switch.Input />
                <Switch.Control class={styles.switchControl}><Switch.Thumb class={styles.switchThumb} /></Switch.Control>
                <Switch.Label class={styles.switchLabel}>Allow NULL</Switch.Label>
              </Switch.Root>
              <Checkbox.Root checked={primaryKey()} onChange={setPrimaryKey} class={styles.checkboxRoot}>
                <Checkbox.Input />
                <Checkbox.Control class={styles.checkboxControl}><Checkbox.Indicator><Check size={12} /></Checkbox.Indicator></Checkbox.Control>
                <Checkbox.Label>{props.kind === "createTable" ? "Initial column is primary key" : "Primary key column"}</Checkbox.Label>
              </Checkbox.Root>
            </Show>
            <Show when={props.kind === "createTable"}>
              <Switch.Root checked={strict()} onChange={setStrict} class={styles.switchRoot}>
                <Switch.Input />
                <Switch.Control class={styles.switchControl}><Switch.Thumb class={styles.switchThumb} /></Switch.Control>
                <Switch.Label class={styles.switchLabel}>STRICT table (recommended)</Switch.Label>
              </Switch.Root>
              <Switch.Root checked={withoutRowid()} onChange={setWithoutRowid} class={styles.switchRoot}>
                <Switch.Input />
                <Switch.Control class={styles.switchControl}><Switch.Thumb class={styles.switchThumb} /></Switch.Control>
                <Switch.Label class={styles.switchLabel}>WITHOUT ROWID</Switch.Label>
              </Switch.Root>
            </Show>
            <Show when={["createTable", "createIndex", "createForeignKey"].includes(props.kind)}>
              <TextField.Root value={columns()} onChange={setColumns}>
                <TextField.Label class={styles.label}>{props.kind === "createTable" ? "Initial column name" : "Columns (comma separated)"}</TextField.Label>
                <TextField.Input class={styles.input} />
              </TextField.Root>
            </Show>
            <Show when={props.kind === "createIndex"}>
              <Switch.Root checked={unique()} onChange={setUnique} class={styles.switchRoot}>
                <Switch.Input />
                <Switch.Control class={styles.switchControl}><Switch.Thumb class={styles.switchThumb} /></Switch.Control>
                <Switch.Label class={styles.switchLabel}>Unique index</Switch.Label>
              </Switch.Root>
            </Show>
            <Show when={props.kind === "createForeignKey"}>
              <TextField.Root value={referenceTable()} onChange={setReferenceTable}>
                <TextField.Label class={styles.label}>Referenced table</TextField.Label>
                <TextField.Input class={styles.input} />
              </TextField.Root>
              <TextField.Root value={referenceColumns()} onChange={setReferenceColumns}>
                <TextField.Label class={styles.label}>Referenced columns</TextField.Label>
                <TextField.Input class={styles.input} />
              </TextField.Root>
            </Show>
            <Show when={isDestructive(props.kind)}>
              <p class={styles.warning}>Review affected objects and data carefully. The server will generate the exact SQLite-compatible SQL and validate the draft.</p>
            </Show>
            <div class={styles.dialogActions}>
              <Dialog.CloseButton class={styles.button} disabled={props.busy}>Cancel</Dialog.CloseButton>
              <Button type="submit" class={`${styles.button} ${isDestructive(props.kind) ? styles.danger : styles.primary}`} disabled={props.busy}>
                {props.busy ? "Applying to draft…" : operationTitle(props.kind)}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
