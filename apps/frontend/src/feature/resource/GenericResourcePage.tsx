import * as AlertDialog from "@kobalte/core/alert-dialog";
import { Button } from "@kobalte/core/button";
import * as Dialog from "@kobalte/core/dialog";
import * as Tabs from "@kobalte/core/tabs";
import * as TextField from "@kobalte/core/text-field";
import { useNavigate, useSearchParams } from "@solidjs/router";
import PanelLeft from "lucide-solid/icons/panel-left";
import { For, Show, createEffect, createSignal, onCleanup, type Component } from "solid-js";
import { showErrorToast, showSuccessToast } from "@/components/ui/Toast";
import { catalogInvalidation } from "@/ai-chat-adapters";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { setStore } from "@/store";
import type { TRouteResource } from "@/pages/resource";
import styles from "@/pages/resource.module.css";

export type TGenericResourcePageProps = { resource: TRouteResource };
type TReference = { actor_definition_name: string; slot_name: string; allow_read: boolean; allow_write: boolean };
type TKvDataEntry = { key: string; valuePreview: string; valueTruncated: boolean; revision: number; createdAt: string; updatedAt: string };
type TSecretDataEntry = { name: string; revision: number; createdAt: string; updatedAt: string };
type TDataPage =
  | { kind: "kv"; entries: TKvDataEntry[]; nextCursor: string | null }
  | { kind: "secretStore"; entries: TSecretDataEntry[]; nextCursor: string | null };
type TEntryEditor = { mode: "create" | "edit"; key: string; revision: number | null; value: string; valueTruncated: boolean };
type TDeleteEntry = { key: string; revision: number };

export const GenericResourcePage: Component<TGenericResourcePageProps> = (props) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = createSignal(props.resource.name);
  const [displayName, setDisplayName] = createSignal(props.resource.name);
  const [references, setReferences] = createSignal<TReference[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [prefix, setPrefix] = createSignal("");
  const [appliedPrefix, setAppliedPrefix] = createSignal("");
  const [dataPage, setDataPage] = createSignal<TDataPage | null>(null);
  const [dataLoading, setDataLoading] = createSignal(false);
  const [dataError, setDataError] = createSignal("");
  const [cursorHistory, setCursorHistory] = createSignal<(string | undefined)[]>([undefined]);
  const [entryEditor, setEntryEditor] = createSignal<TEntryEditor | null>(null);
  const [entryDelete, setEntryDelete] = createSignal<TDeleteEntry | null>(null);
  const [entryBusy, setEntryBusy] = createSignal(false);
  const [entryError, setEntryError] = createSignal("");
  let currentResourceId = "";
  let initializedDataResourceId = "";
  let dataRequest = 0;
  let prefixSearchTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (prefixSearchTimer !== undefined) clearTimeout(prefixSearchTimer);
  });

  const activeTab = () => searchParams.tab === "data" ? "data" : "overview";
  const kvPage = () => dataPage()?.kind === "kv" ? dataPage() as Extract<TDataPage, { kind: "kv" }> : null;
  const secretPage = () => dataPage()?.kind === "secretStore" ? dataPage() as Extract<TDataPage, { kind: "secretStore" }> : null;

  const loadReferences = async (resourceId: string) => {
    const [referenceError, value] = await orpcWebsocketService.apiService.api.actors.resources.references({ resourceId });
    if (resourceId === props.resource.id && !referenceError) setReferences(value);
  };

  const loadData = async (cursor?: string, selectedPrefix = appliedPrefix(), resourceId = props.resource.id): Promise<boolean> => {
    const request = ++dataRequest;
    setDataLoading(true);
    setDataError("");
    const [loadError, value] = await orpcWebsocketService.apiService.api.actors.resources.data({
      resourceId,
      prefix: selectedPrefix || undefined,
      cursor,
      limit: 50,
    });
    if (request !== dataRequest || resourceId !== props.resource.id) return false;
    setDataLoading(false);
    if (loadError) {
      setDataError(loadError.message);
      return false;
    }
    setDataPage(value);
    return true;
  };

  createEffect(() => {
    const resource = props.resource;
    if (resource.id === currentResourceId) return;
    currentResourceId = resource.id;
    if (prefixSearchTimer !== undefined) clearTimeout(prefixSearchTimer);
    prefixSearchTimer = undefined;
    initializedDataResourceId = "";
    dataRequest += 1;
    setName(resource.name);
    setDisplayName(resource.name);
    setReferences([]);
    setPrefix("");
    setAppliedPrefix("");
    setDataPage(null);
    setDataError("");
    setDataLoading(false);
    setCursorHistory([undefined]);
    setEntryEditor(null);
    setEntryDelete(null);
    setEntryError("");
    void loadReferences(resource.id);
  });

  createEffect(() => {
    const resourceId = props.resource.id;
    if (activeTab() !== "data" || initializedDataResourceId === resourceId) return;
    initializedDataResourceId = resourceId;
    void loadData(undefined, "", resourceId);
  });

  const selectTab = (value: string) => {
    const tab = value === "data" ? "data" : "overview";
    setSearchParams({ tab });
  };

  const searchData = async (selectedPrefix = prefix()) => {
    const loaded = await loadData(undefined, selectedPrefix);
    if (!loaded) return;
    setAppliedPrefix(selectedPrefix);
    setCursorHistory([undefined]);
  };

  const clearSearch = async () => {
    if (prefixSearchTimer !== undefined) clearTimeout(prefixSearchTimer);
    prefixSearchTimer = undefined;
    setPrefix("");
    const loaded = await loadData(undefined, "");
    if (!loaded) return;
    setAppliedPrefix("");
    setCursorHistory([undefined]);
  };

  const updatePrefix = (value: string) => {
    setPrefix(value);
    if (prefixSearchTimer !== undefined) clearTimeout(prefixSearchTimer);
    dataRequest += 1;
    setDataLoading(false);
    prefixSearchTimer = setTimeout(() => {
      prefixSearchTimer = undefined;
      void searchData(value);
    }, 300);
  };

  const applyPrefixImmediately = () => {
    if (prefixSearchTimer !== undefined) clearTimeout(prefixSearchTimer);
    prefixSearchTimer = undefined;
    void searchData(prefix());
  };

  const nextPage = async () => {
    const cursor = dataPage()?.nextCursor;
    if (!cursor || dataLoading()) return;
    const loaded = await loadData(cursor);
    if (loaded) setCursorHistory((history) => [...history, cursor]);
  };

  const previousPage = async () => {
    const history = cursorHistory();
    if (history.length <= 1 || dataLoading()) return;
    const previousCursor = history.at(-2);
    const loaded = await loadData(previousCursor);
    if (loaded) setCursorHistory(history.slice(0, -1));
  };

  const openCreateEntry = () => {
    setEntryError("");
    setEntryEditor({ mode: "create", key: appliedPrefix(), revision: null, value: props.resource.kind === "kv" ? "{}" : "", valueTruncated: false });
  };

  const openEditKvEntry = (entry: TKvDataEntry) => {
    let value = "";
    if (!entry.valueTruncated) {
      try { value = JSON.stringify(JSON.parse(entry.valuePreview), null, 2); } catch { value = entry.valuePreview; }
    }
    setEntryError("");
    setEntryEditor({ mode: "edit", key: entry.key, revision: entry.revision, value, valueTruncated: entry.valueTruncated });
  };

  const openEditSecretEntry = (entry: TSecretDataEntry) => {
    setEntryError("");
    setEntryEditor({ mode: "edit", key: entry.name, revision: entry.revision, value: "", valueTruncated: false });
  };

  const saveEntry = async () => {
    const editor = entryEditor();
    if (!editor) return;
    if (!editor.key.trim()) return setEntryError(props.resource.kind === "kv" ? "Key is required." : "Secret name is required.");
    let value: unknown = editor.value;
    if (props.resource.kind === "kv") {
      if (!editor.value.trim()) return setEntryError("Enter a JSON value.");
      try { value = JSON.parse(editor.value); } catch { return setEntryError("Value must be valid JSON."); }
    } else if (!editor.value) {
      return setEntryError(editor.mode === "create" ? "Secret value is required." : "Enter the replacement secret value.");
    }
    setEntryBusy(true);
    setEntryError("");
    const [saveError] = await orpcWebsocketService.apiService.api.actors.resources.dataSet({
      resourceId: props.resource.id,
      key: editor.key,
      expectedRevision: editor.revision,
      value,
    });
    setEntryBusy(false);
    if (saveError) {
      setEntryError(saveError.message);
      return;
    }
    setEntryEditor(null);
    setCursorHistory([undefined]);
    await loadData(undefined);
    showSuccessToast(props.resource.kind === "kv" ? (editor.mode === "create" ? "Value created" : "Value updated") : (editor.mode === "create" ? "Secret created" : "Secret rotated"));
  };

  const removeEntry = async () => {
    const entry = entryDelete();
    if (!entry) return;
    setEntryBusy(true);
    const [removeError] = await orpcWebsocketService.apiService.api.actors.resources.dataDelete({
      resourceId: props.resource.id,
      key: entry.key,
      expectedRevision: entry.revision,
    });
    setEntryBusy(false);
    if (removeError) {
      showErrorToast(removeError.message);
      setEntryDelete(null);
      await loadData(cursorHistory().at(-1));
      return;
    }
    setEntryDelete(null);
    setCursorHistory([undefined]);
    await loadData(undefined);
    showSuccessToast(props.resource.kind === "kv" ? "Value deleted" : "Secret deleted");
  };

  const rename = async () => {
    const value = name().trim();
    if (!value || value === displayName()) return;
    setBusy(true);
    const [renameError] = await orpcWebsocketService.apiService.api.actors.resources.rename({ resourceId: props.resource.id, name: value });
    setBusy(false);
    if (renameError) return showErrorToast(renameError.message);
    setDisplayName(value);
    showSuccessToast("Resource renamed");
    catalogInvalidation.invalidate("resources");
  };

  const remove = async () => {
    setBusy(true);
    const [deleteError] = await orpcWebsocketService.apiService.api.actors.resources.delete({ resourceId: props.resource.id });
    setBusy(false);
    if (deleteError) return showErrorToast(deleteError.message);
    showSuccessToast("Resource deleted");
    catalogInvalidation.invalidate("resources");
    navigate("/");
  };

  return (
    <div class={styles.page}>
      <Tabs.Root value={activeTab()} onChange={selectTab} class={styles.tabsRoot}>
        <header class={styles.header}>
          <div><p class={styles.eyebrow}>{props.resource.kind === "kv" ? "Key-value resource" : "Secret store resource"}</p><h2 class={styles.title}>{displayName()}</h2></div>
          <div class={styles.headerActions}><Button class={`${styles.button} ${styles.iconButton}`} aria-label="Toggle sidebar" onClick={() => setStore("sidebarVisible", (visible) => !visible)}><PanelLeft size={15} /></Button><Button class={`${styles.button} ${styles.danger}`} onClick={() => setDeleteOpen(true)}>Delete</Button></div>
        </header>
        <Tabs.List class={styles.tabsList} aria-label={`${props.resource.kind === "kv" ? "Key-value" : "Secret store"} resource workbench`}>
          <Tabs.Trigger class={styles.tab} value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger class={styles.tab} value="data">Data</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" class={styles.tabContent}>
          <main class={styles.content}>
            <section class={styles.summary}><div class={styles.summaryItem}><span class={styles.label}>Status</span><span class={styles.status}>{props.resource.status}</span></div><div class={styles.summaryItem}><span class={styles.label}>Type</span><span class={styles.value}>{props.resource.kind}</span></div><div class={styles.summaryItem}><span class={styles.label}>Created</span><span class={styles.value}>{props.resource.created_at}</span></div><div class={styles.summaryItem}><span class={styles.label}>ID</span><span class={styles.value} title={props.resource.id}>{props.resource.id}</span></div></section>
            <div class={styles.twoColumn}>
              <section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>Settings</h3></div><div class={styles.panelBody}><TextField.Root value={name()} onChange={setName}><TextField.Label class={styles.label}>Display name</TextField.Label><TextField.Input class={styles.input} /></TextField.Root><div class={styles.actions}><Button class={`${styles.button} ${styles.primary}`} disabled={busy() || !name().trim() || name().trim() === displayName()} onClick={rename}>Save name</Button></div></div></section>
              <section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>References</h3><span>{references().length}</span></div><table class={styles.table}><thead><tr><th>Definition</th><th>Slot</th><th>Access</th></tr></thead><tbody><For each={references()} fallback={<tr><td colSpan={3} class={styles.muted}>Not bound to an actor definition.</td></tr>}>{(reference) => <tr><td>{reference.actor_definition_name}</td><td>{reference.slot_name}</td><td>{[reference.allow_read && "read", reference.allow_write && "write"].filter(Boolean).join(" + ")}</td></tr>}</For></tbody></table></section>
            </div>
          </main>
        </Tabs.Content>

        <Tabs.Content value="data" class={`${styles.tabContent} ${styles.dataTabContent}`}>
          <main class={`${styles.content} ${styles.dataContent}`}>
            <section class={`${styles.panel} ${styles.dataPanel}`}>
              <div class={styles.panelHeader}><h3 class={styles.panelTitle}>{props.resource.kind === "kv" ? "Values" : "Secret names"}</h3><div class={styles.panelHeaderActions}><span>50 per page</span><Button class={`${styles.button} ${styles.primary}`} onClick={openCreateEntry}>{props.resource.kind === "kv" ? "Add value" : "Add secret"}</Button></div></div>
              <div class={styles.dataToolbar}>
                <TextField.Root value={prefix()} onChange={updatePrefix} class={styles.searchField}>
                  <TextField.Label class={styles.label}>{props.resource.kind === "kv" ? "Key prefix" : "Name prefix"}</TextField.Label>
                  <TextField.Input class={styles.input} placeholder={props.resource.kind === "kv" ? "e.g. settings/" : "e.g. production/"} onKeyDown={(event) => { if (event.key === "Enter") applyPrefixImmediately(); }} />
                </TextField.Root>
                <Button class={styles.button} disabled={dataLoading() || (!prefix() && !appliedPrefix())} onClick={() => void clearSearch()}>Clear</Button>
                <Show when={dataError()}><p class={styles.error} role="alert">{dataError()}</p></Show>
              </div>
              <Show when={kvPage()}>{(page) => <div class={styles.tableScroll}><table class={styles.table}><thead><tr><th>Key</th><th>Value preview</th><th>Revision</th><th>Updated</th><th>Actions</th></tr></thead><tbody><For each={page().entries} fallback={<tr><td colSpan={5} class={styles.empty}>{dataLoading() ? "Loading values…" : "No matching values."}</td></tr>}>{(entry) => <tr><td><code>{entry.key}</code></td><td class={styles.valuePreview}><code>{entry.valuePreview}{entry.valueTruncated ? "…" : ""}</code></td><td>{entry.revision}</td><td>{entry.updatedAt}</td><td><div class={styles.rowActions}><Button class={styles.rowButton} onClick={() => openEditKvEntry(entry)}>Edit</Button><Button class={`${styles.rowButton} ${styles.danger}`} onClick={() => setEntryDelete({ key: entry.key, revision: entry.revision })}>Delete</Button></div></td></tr>}</For></tbody></table></div>}</Show>
              <Show when={secretPage()}>{(page) => <div class={styles.tableScroll}><table class={styles.table}><thead><tr><th>Name</th><th>Revision</th><th>Created</th><th>Updated</th><th>Actions</th></tr></thead><tbody><For each={page().entries} fallback={<tr><td colSpan={5} class={styles.empty}>{dataLoading() ? "Loading secret names…" : "No matching secret names."}</td></tr>}>{(entry) => <tr><td><code>{entry.name}</code></td><td>{entry.revision}</td><td>{entry.createdAt}</td><td>{entry.updatedAt}</td><td><div class={styles.rowActions}><Button class={styles.rowButton} onClick={() => openEditSecretEntry(entry)}>Rotate</Button><Button class={`${styles.rowButton} ${styles.danger}`} onClick={() => setEntryDelete({ key: entry.name, revision: entry.revision })}>Delete</Button></div></td></tr>}</For></tbody></table></div>}</Show>
              <Show when={!dataPage()}><div class={`${styles.empty} ${styles.tableScroll}`}>{dataLoading() ? "Loading data…" : "No data loaded."}</div></Show>
              <div class={styles.pagination}><Button class={styles.button} disabled={dataLoading() || cursorHistory().length <= 1} onClick={() => void previousPage()}>Previous</Button><span>Page {cursorHistory().length}{appliedPrefix() ? ` · prefix “${appliedPrefix()}”` : ""}</span><Button class={styles.button} disabled={dataLoading() || !dataPage()?.nextCursor} onClick={() => void nextPage()}>Next</Button></div>
            </section>
          </main>
        </Tabs.Content>
      </Tabs.Root>
      <Dialog.Root open={entryEditor() !== null} onOpenChange={(open) => { if (!open && !entryBusy()) setEntryEditor(null); }}><Dialog.Portal><Dialog.Overlay class={styles.dialogOverlay} /><Dialog.Content class={styles.dialogContent}><Dialog.Title class={styles.panelTitle}>{entryEditor()?.mode === "create" ? (props.resource.kind === "kv" ? "Add value" : "Add secret") : (props.resource.kind === "kv" ? "Edit value" : "Rotate secret")}</Dialog.Title><Dialog.Description class={styles.muted}>{props.resource.kind === "kv" ? "Values are stored as JSON. Saving requires the revision that was loaded." : "Secret plaintext is write-only. Rotating replaces the value without reading the current plaintext."}</Dialog.Description><Show when={entryEditor()}>{(editor) => <div class={styles.form}><TextField.Root value={editor().key} onChange={(key) => setEntryEditor({ ...editor(), key })} disabled={editor().mode === "edit"}><TextField.Label class={styles.label}>{props.resource.kind === "kv" ? "Key" : "Secret name"}</TextField.Label><TextField.Input class={styles.input} autocomplete="off" /></TextField.Root><Show when={props.resource.kind === "kv"} fallback={<TextField.Root value={editor().value} onChange={(value) => setEntryEditor({ ...editor(), value })}><TextField.Label class={styles.label}>{editor().mode === "create" ? "Secret value" : "Replacement secret value"}</TextField.Label><TextField.Input class={styles.input} type="password" autocomplete="new-password" /></TextField.Root>}><TextField.Root value={editor().value} onChange={(value) => setEntryEditor({ ...editor(), value })}><TextField.Label class={styles.label}>JSON value</TextField.Label><TextField.TextArea class={styles.textarea} placeholder={editor().valueTruncated ? "Current value is larger than its preview. Enter the complete replacement JSON." : "{}"} /></TextField.Root></Show><Show when={editor().valueTruncated}><p class={styles.muted}>The current value was not loaded because it exceeds the preview limit. Enter a complete replacement value.</p></Show><Show when={entryError()}><p class={styles.dialogError} role="alert">{entryError()}</p></Show></div>}</Show><div class={styles.actions}><Dialog.CloseButton class={styles.button} disabled={entryBusy()}>Cancel</Dialog.CloseButton><Button class={`${styles.button} ${styles.primary}`} disabled={entryBusy()} onClick={() => void saveEntry()}>{entryBusy() ? "Saving…" : entryEditor()?.mode === "create" ? "Create" : props.resource.kind === "kv" ? "Save value" : "Rotate secret"}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
      <AlertDialog.Root open={entryDelete() !== null} onOpenChange={(open) => { if (!open && !entryBusy()) setEntryDelete(null); }}><AlertDialog.Portal><AlertDialog.Overlay class={styles.dialogOverlay} /><AlertDialog.Content class={styles.dialogContent}><AlertDialog.Title class={styles.panelTitle}>Delete {props.resource.kind === "kv" ? "value" : "secret"}</AlertDialog.Title><AlertDialog.Description class={styles.muted}>Permanently delete <code>{entryDelete()?.key}</code>? The delete succeeds only if revision {entryDelete()?.revision} is still current.</AlertDialog.Description><div class={styles.actions}><AlertDialog.CloseButton class={styles.button} disabled={entryBusy()}>Cancel</AlertDialog.CloseButton><Button class={`${styles.button} ${styles.dangerConfirm}`} disabled={entryBusy()} onClick={() => void removeEntry()}>{entryBusy() ? "Deleting…" : "Delete"}</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
      <AlertDialog.Root open={deleteOpen()} onOpenChange={setDeleteOpen}><AlertDialog.Portal><AlertDialog.Overlay class={styles.dialogOverlay} /><AlertDialog.Content class={styles.dialogContent}><AlertDialog.Title class={styles.panelTitle}>Delete resource</AlertDialog.Title><AlertDialog.Description class={styles.muted}>This permanently deletes {displayName()}. This action cannot be undone.</AlertDialog.Description><div class={styles.actions}><AlertDialog.CloseButton class={styles.button}>Cancel</AlertDialog.CloseButton><Button class={`${styles.button} ${styles.dangerConfirm}`} disabled={busy()} onClick={remove}>Delete resource</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    </div>
  );
};

export default GenericResourcePage;
