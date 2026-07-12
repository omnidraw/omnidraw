import { Button } from "@kobalte/core/button";
import { useNavigate, useParams } from "@solidjs/router";
import PanelLeft from "lucide-solid/icons/panel-left";
import { For, Show, createEffect, createSignal, type Component } from "solid-js";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { setStore } from "@/store";
import { RESOURCE_CATALOG_CHANGED_EVENT } from "@/feature/sidebar/components/CONSTANTS";
import styles from "./resource.module.css";

type TResource = { id: string; kind: "kv" | "secretStore" | "db"; name: string; status: string; last_error: unknown; created_at: string; updated_at: string };
type TReference = { actor_definition_name: string; slot_name: string; allow_read: boolean; allow_write: boolean };
type TDbConfiguration = { schema_id: string; applied_version: number; target_version: number };
type TMigration = { schema_id: string; version: number; name: string; sql: string; checksum: string; status: "draft" | "published" };

const kindLabel = (kind: TResource["kind"]) => kind === "kv" ? "Key-value resource" : kind === "secretStore" ? "Secret store resource" : "Database resource";

const ResourcePage: Component = () => {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [resource, setResource] = createSignal<TResource | null>(null);
  const [references, setReferences] = createSignal<TReference[]>([]);
  const [configuration, setConfiguration] = createSignal<TDbConfiguration | null>(null);
  const [migrations, setMigrations] = createSignal<TMigration[]>([]);
  const [name, setName] = createSignal("");
  const [migrationName, setMigrationName] = createSignal("");
  const [migrationSql, setMigrationSql] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [deleteArmed, setDeleteArmed] = createSignal(false);

  const load = async () => {
    setError("");
    const [resourceError, result] = await orpcWebsocketService.apiService.api.actors.resources.get({ resourceId: params.id });
    if (resourceError) { setError(resourceError.message); setResource(null); return; }
    setResource(result);
    setName(result.name);
    const [referenceError, resourceReferences] = await orpcWebsocketService.apiService.api.actors.resources.references({ resourceId: params.id });
    if (!referenceError) setReferences(resourceReferences);
    if (result.kind === "db") {
      const [configError, config] = await orpcWebsocketService.apiService.api.actors.dbResources.configuration({ resourceId: params.id });
      if (!configError) {
        setConfiguration(config);
        const [migrationError, rows] = await orpcWebsocketService.apiService.api.actors.dbMigrations.list({ schemaId: config.schema_id });
        if (!migrationError) setMigrations(rows);
      }
    } else { setConfiguration(null); setMigrations([]); }
  };

  createEffect(() => { void params.id; void load(); });

  const rename = async () => {
    if (!name().trim() || name().trim() === resource()?.name) return;
    setBusy(true);
    const [err] = await orpcWebsocketService.apiService.api.actors.resources.rename({ resourceId: params.id, name: name().trim() });
    setBusy(false);
    if (err) return showErrorToast(err.message);
    showSuccessToast("Resource renamed");
    window.dispatchEvent(new Event(RESOURCE_CATALOG_CHANGED_EVENT));
    await load();
  };

  const remove = async () => {
    if (!deleteArmed()) { setDeleteArmed(true); return; }
    setBusy(true);
    const [err] = await orpcWebsocketService.apiService.api.actors.resources.delete({ resourceId: params.id });
    setBusy(false);
    if (err) { showErrorToast(err.message); setDeleteArmed(false); return; }
    showSuccessToast("Resource deleted");
    window.dispatchEvent(new Event(RESOURCE_CATALOG_CHANGED_EVENT));
    navigate("/");
  };

  const createMigration = async () => {
    const config = configuration();
    if (!config || !migrationName().trim() || !migrationSql().trim()) return;
    const nextVersion = Math.max(0, ...migrations().map((row) => row.version)) + 1;
    setBusy(true);
    const [err] = await orpcWebsocketService.apiService.api.actors.dbMigrations.createDraft({ schemaId: config.schema_id, version: nextVersion, name: migrationName().trim(), sql: migrationSql() });
    setBusy(false);
    if (err) return showErrorToast(err.message);
    setMigrationName(""); setMigrationSql(""); showSuccessToast(`Migration ${nextVersion} saved as draft`); await load();
  };

  const publishMigration = async (version: number) => {
    const config = configuration(); if (!config) return;
    setBusy(true);
    const [err] = await orpcWebsocketService.apiService.api.actors.dbMigrations.publish({ schemaId: config.schema_id, version });
    setBusy(false);
    if (err) return showErrorToast(err.message);
    showSuccessToast(`Migration ${version} published`); await load();
  };

  const applyMigration = async (version: number) => {
    setBusy(true);
    const [previewError] = await orpcWebsocketService.apiService.api.actors.dbResources.previewMigration({ resourceId: params.id, targetVersion: version });
    if (previewError) { setBusy(false); return showErrorToast(previewError.message); }
    const [err] = await orpcWebsocketService.apiService.api.actors.dbResources.migrate({ resourceId: params.id, targetVersion: version });
    setBusy(false);
    if (err) return showErrorToast(err.message);
    showSuccessToast(`Database migrated to version ${version}`); await load();
  };

  return (
    <div class={styles.page}>
      <Show when={resource()} fallback={<div class={styles.empty}><p class={error() ? styles.error : styles.muted}>{error() || "Loading resource…"}</p></div>}>
        {(current) => <>
          <header class={styles.header}>
            <div><p class={styles.eyebrow}>{kindLabel(current().kind)}</p><h2 class={styles.title}>{current().name}</h2></div>
            <div class={styles.headerActions}>
              <Button class={`${styles.button} ${styles.iconButton}`} aria-label="Toggle sidebar" onClick={() => setStore("sidebarVisible", (visible) => !visible)}><PanelLeft size={15} /></Button>
              <Button class={`${styles.button} ${styles.danger}`} disabled={busy()} onClick={remove}>{deleteArmed() ? "Confirm delete" : "Delete"}</Button>
            </div>
          </header>
          <main class={styles.content}>
            <section class={styles.summary}>
              <div class={styles.summaryItem}><span class={styles.label}>Status</span><span class={styles.status}><i class={`${styles.dot} ${current().status === "ready" ? styles.dotReady : ""}`} />{current().status}</span></div>
              <div class={styles.summaryItem}><span class={styles.label}>Type</span><span class={styles.value}>{current().kind}</span></div>
              <div class={styles.summaryItem}><span class={styles.label}>Created</span><span class={styles.value}>{new Date(current().created_at).toLocaleString()}</span></div>
              <div class={styles.summaryItem}><span class={styles.label}>ID</span><span class={styles.value} title={current().id}>{current().id}</span></div>
            </section>
            <div class={styles.twoColumn}>
              <section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>Settings</h3></div><div class={styles.panelBody}><div class={styles.form}><label class={styles.field}><span class={styles.label}>Display name</span><input class={styles.input} value={name()} onInput={(e) => setName(e.currentTarget.value)} /></label><div class={styles.actions}><Button class={`${styles.button} ${styles.primary}`} disabled={busy() || !name().trim() || name().trim() === current().name} onClick={rename}>Save name</Button></div></div></div></section>
              <section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>References</h3><span class={styles.value}>{references().length}</span></div><Show when={references().length} fallback={<div class={`${styles.empty} ${styles.muted}`}>Not bound to a widget definition.</div>}><table class={styles.table}><thead><tr><th>Definition</th><th>Slot</th><th>Access</th></tr></thead><tbody><For each={references()}>{(ref) => <tr><td>{ref.actor_definition_name}</td><td>{ref.slot_name}</td><td>{[ref.allow_read && "read", ref.allow_write && "write"].filter(Boolean).join(" + ")}</td></tr>}</For></tbody></table></Show></section>
            </div>
            <Show when={current().kind === "kv"}><section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>Values</h3><Button class={`${styles.button} ${styles.primary}`} disabled>Add value</Button></div><div class={styles.empty}><p class={styles.muted}>No host-management value API is available yet. Values are currently read and written by bound actors.</p></div></section></Show>
            <Show when={current().kind === "secretStore"}><section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>Secrets</h3><Button class={`${styles.button} ${styles.primary}`} disabled>Add secret</Button></div><div class={styles.empty}><p class={styles.muted}>Secret names and values are not exposed by the current management API. Bound actors manage secrets without revealing stored values here.</p></div></section></Show>
            <Show when={current().kind === "db" && configuration()}>{(config) => <>
              <section class={styles.summary}><div class={styles.summaryItem}><span class={styles.label}>Schema</span><span class={styles.value}>{config().schema_id}</span></div><div class={styles.summaryItem}><span class={styles.label}>Applied version</span><span class={styles.value}>{config().applied_version}</span></div><div class={styles.summaryItem}><span class={styles.label}>Target version</span><span class={styles.value}>{config().target_version}</span></div><div class={styles.summaryItem}><span class={styles.label}>Migrations</span><span class={styles.value}>{migrations().length}</span></div></section>
              <div class={styles.twoColumn}>
                <section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>Migrations</h3></div><Show when={migrations().length} fallback={<div class={`${styles.empty} ${styles.muted}`}>Schema is at version 0. Add the first migration.</div>}><table class={styles.table}><thead><tr><th>Version</th><th>Name</th><th>Status</th><th>Action</th></tr></thead><tbody><For each={migrations()}>{(row) => <tr><td>{row.version}</td><td>{row.name}</td><td>{row.status}</td><td><Show when={row.status === "draft"} fallback={<Button class={styles.button} disabled={busy() || row.version <= config().applied_version} onClick={() => applyMigration(row.version)}>{row.version <= config().applied_version ? "Applied" : "Apply"}</Button>}><Button class={`${styles.button} ${styles.primary}`} disabled={busy()} onClick={() => publishMigration(row.version)}>Publish</Button></Show></td></tr>}</For></tbody></table></Show></section>
                <section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>Add migration</h3></div><div class={styles.panelBody}><div class={styles.form}><label class={styles.field}><span class={styles.label}>Name</span><input class={styles.input} value={migrationName()} onInput={(e) => setMigrationName(e.currentTarget.value)} placeholder="create-notes" /></label><label class={styles.field}><span class={styles.label}>SQL</span><textarea class={styles.textarea} value={migrationSql()} onInput={(e) => setMigrationSql(e.currentTarget.value)} placeholder="CREATE TABLE notes (...);" /></label><div class={styles.actions}><Button class={`${styles.button} ${styles.primary}`} disabled={busy() || !migrationName().trim() || !migrationSql().trim()} onClick={createMigration}>Save draft</Button></div></div></div></section>
              </div>
            </>}</Show>
          </main>
        </>}
      </Show>
    </div>
  );
};

export default ResourcePage;
