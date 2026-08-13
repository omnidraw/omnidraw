import { Button } from "@kobalte/core/button";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show, type Component } from "solid-js";
import { fnForeignKeySummary, fnIndexColumns } from "@/core/resources/fn.db-resource";
import type { TDbObject } from "@/core/resources/types";
import type { TStructureOperationKind } from "./StructureChangeDialog";
import styles from "../DbResourcePage.module.css";

export type TObjectInspectorProps = {
  object: TDbObject | null;
  editableDraft: boolean;
  onChange: (kind: TStructureOperationKind, value?: string) => void;
};

export const ObjectInspector: Component<TObjectInspectorProps> = (props) => (
  <Show when={props.object} fallback={<p class={styles.muted}>Object details appear here.</p>}>
    {(object) => <>
      <section><div class={styles.inspectorTitle}><h4>Indexes</h4><Show when={props.editableDraft && object().kind === "table"}><Button class={styles.linkButton} onClick={() => props.onChange("createIndex")}>Add</Button></Show></div><For each={object().indexes} fallback={<p class={styles.muted}>None</p>}>{(index) => <div class={styles.inspectorRow}><div><strong>{index.name}</strong><small>{fnIndexColumns(index)}{index.unique ? " · unique" : ""}</small></div><Show when={props.editableDraft}><Button class={styles.iconButton} aria-label={`Drop index ${index.name}`} onClick={() => props.onChange("dropIndex", index.name)}><Trash2 size={12} /></Button></Show></div>}</For></section>
      <section><div class={styles.inspectorTitle}><h4>Foreign keys</h4><Show when={props.editableDraft && object().kind === "table"}><Button class={styles.linkButton} onClick={() => props.onChange("createForeignKey")}>Add</Button></Show></div><For each={object().foreignKeys} fallback={<p class={styles.muted}>None</p>}>{(foreignKey) => <div class={styles.inspectorRow}><div><strong>FK {foreignKey.id}</strong><small>{fnForeignKeySummary(foreignKey)}</small></div><Show when={props.editableDraft}><Button class={styles.iconButton} aria-label="Drop foreign key" onClick={() => props.onChange("dropForeignKey", String(foreignKey.id))}><Trash2 size={12} /></Button></Show></div>}</For></section>
      <section><h4>Triggers</h4><For each={object().triggers} fallback={<p class={styles.muted}>None</p>}>{(trigger) => <div class={styles.inspectorRow}><div><strong>{trigger.name}</strong><small>{trigger.createSql}</small></div></div>}</For></section>
      <section><h4>Create SQL</h4><pre class={styles.code}>{object().createSql || "Not available"}</pre></section>
    </>}
  </Show>
);
