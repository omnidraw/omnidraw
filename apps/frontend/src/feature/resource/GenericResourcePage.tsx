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
import {
  fnCanApplySecretReveal,
  fnSecretRevealIdentityIsCurrent,
  type TSecretRevealRequestIdentity,
} from "./fn.secret-reveal";

export type TGenericResourcePageProps = { resource: TRouteResource };
type TKvDataEntry = { key: string; valuePreview: string; valueTruncated: boolean; revision: number; createdAt: string; updatedAt: string };
type TSecretDataEntry = { name: string; revision: number; createdAt: string; updatedAt: string };
type TDataPage =
  | { kind: "kv"; entries: TKvDataEntry[]; nextCursor: string | null }
  | { kind: "secretStore"; entries: TSecretDataEntry[]; nextCursor: string | null };
type TEntryEditor = { mode: "create" | "edit"; key: string; revision: number | null; value: string; valueTruncated: boolean };
type TDeleteEntry = { key: string; revision: number };
type TRevealedSecret = TSecretRevealRequestIdentity & { value: string };

const SECRET_REVEAL_INACTIVITY_MS = 30_000;

export const GenericResourcePage: Component<TGenericResourcePageProps> = (props) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = createSignal(props.resource.name);
  const [displayName, setDisplayName] = createSignal(props.resource.name);
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
  const [secretValueVisible, setSecretValueVisible] = createSignal(false);
  const [revealPending, setRevealPending] = createSignal<TSecretRevealRequestIdentity | null>(null);
  const [revealedSecret, setRevealedSecret] = createSignal<TRevealedSecret | null>(null);
  const [revealError, setRevealError] = createSignal<Pick<TSecretRevealRequestIdentity, "resourceId" | "name" | "revision"> | null>(null);
  let currentResourceId = "";
  let initializedDataResourceId = "";
  let dataRequest = 0;
  let revealGeneration = 0;
  let prefixSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let revealInactivityTimer: ReturnType<typeof setTimeout> | undefined;

  const clearSecretReveal = () => {
    revealGeneration += 1;
    if (revealInactivityTimer !== undefined) clearTimeout(revealInactivityTimer);
    revealInactivityTimer = undefined;
    setRevealPending(null);
    setRevealedSecret(null);
    setRevealError(null);
  };

  const armSecretRevealTimeout = () => {
    if (revealInactivityTimer !== undefined) clearTimeout(revealInactivityTimer);
    revealInactivityTimer = setTimeout(() => clearSecretReveal(), SECRET_REVEAL_INACTIVITY_MS);
  };

  const clearSecretRevealWhenHidden = () => {
    if (document.visibilityState !== "visible") clearSecretReveal();
  };
  const clearSecretRevealOnPageHide = () => clearSecretReveal();

  window.addEventListener("pagehide", clearSecretRevealOnPageHide);
  document.addEventListener("visibilitychange", clearSecretRevealWhenHidden);

  onCleanup(() => {
    window.removeEventListener("pagehide", clearSecretRevealOnPageHide);
    document.removeEventListener("visibilitychange", clearSecretRevealWhenHidden);
    if (prefixSearchTimer !== undefined) clearTimeout(prefixSearchTimer);
    clearSecretReveal();
  });

  const activeTab = () => searchParams.tab === "data" ? "data" : "overview";
  const kvPage = () => dataPage()?.kind === "kv" ? dataPage() as Extract<TDataPage, { kind: "kv" }> : null;
  const secretPage = () => dataPage()?.kind === "secretStore" ? dataPage() as Extract<TDataPage, { kind: "secretStore" }> : null;

  createEffect(() => {
    const tab = activeTab();
    const identity = revealPending() ?? revealedSecret();
    if (tab !== "data") {
      if (identity || revealError()) clearSecretReveal();
      return;
    }
    if (identity && !fnSecretRevealIdentityIsCurrent(identity, props.resource.id, tab, secretPage())) {
      clearSecretReveal();
    }
  });

  createEffect(() => {
    if (!revealedSecret()) return;
    const noteActivity = () => armSecretRevealTimeout();
    armSecretRevealTimeout();
    window.addEventListener("pointerdown", noteActivity, { passive: true });
    window.addEventListener("keydown", noteActivity);
    window.addEventListener("wheel", noteActivity, { passive: true });
    window.addEventListener("focusin", noteActivity);
    onCleanup(() => {
      if (revealInactivityTimer !== undefined) clearTimeout(revealInactivityTimer);
      revealInactivityTimer = undefined;
      window.removeEventListener("pointerdown", noteActivity);
      window.removeEventListener("keydown", noteActivity);
      window.removeEventListener("wheel", noteActivity);
      window.removeEventListener("focusin", noteActivity);
    });
  });

  const loadData = async (cursor?: string, selectedPrefix = appliedPrefix(), resourceId = props.resource.id): Promise<boolean> => {
    clearSecretReveal();
    const request = ++dataRequest;
    setDataLoading(true);
    setDataError("");
    const [loadError, value] = await orpcWebsocketService.apiService.api.resource.resources.data({
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
    setPrefix("");
    setAppliedPrefix("");
    setDataPage(null);
    setDataError("");
    setDataLoading(false);
    setCursorHistory([undefined]);
    setEntryEditor(null);
    setEntryDelete(null);
    setEntryError("");
    setSecretValueVisible(false);
    clearSecretReveal();
  });

  createEffect(() => {
    const resourceId = props.resource.id;
    if (activeTab() !== "data" || initializedDataResourceId === resourceId) return;
    initializedDataResourceId = resourceId;
    void loadData(undefined, "", resourceId);
  });

  const selectTab = (value: string) => {
    clearSecretReveal();
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
    clearSecretReveal();
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
    clearSecretReveal();
    setEntryError("");
    setSecretValueVisible(false);
    setEntryEditor({ mode: "create", key: appliedPrefix(), revision: null, value: props.resource.kind === "kv" ? "{}" : "", valueTruncated: false });
  };

  const openEditKvEntry = (entry: TKvDataEntry) => {
    clearSecretReveal();
    let value = "";
    if (!entry.valueTruncated) {
      try { value = JSON.stringify(JSON.parse(entry.valuePreview), null, 2); } catch { value = entry.valuePreview; }
    }
    setEntryError("");
    setEntryEditor({ mode: "edit", key: entry.key, revision: entry.revision, value, valueTruncated: entry.valueTruncated });
  };

  const openEditSecretEntry = (entry: TSecretDataEntry) => {
    clearSecretReveal();
    setEntryError("");
    setSecretValueVisible(false);
    setEntryEditor({ mode: "edit", key: entry.name, revision: entry.revision, value: "", valueTruncated: false });
  };

  const closeEntryEditor = () => {
    setEntryEditor(null);
    setEntryError("");
    setSecretValueVisible(false);
  };

  const openDeleteEntry = (entry: TDeleteEntry) => {
    clearSecretReveal();
    setEntryDelete(entry);
  };

  const revealSecret = async (entry: TSecretDataEntry) => {
    clearSecretReveal();
    const request: TSecretRevealRequestIdentity = {
      generation: revealGeneration,
      resourceId: props.resource.id,
      name: entry.name,
      revision: entry.revision,
    };
    setRevealPending(request);
    const [requestError, value] = await orpcWebsocketService.apiService.api.resource.resources.dataRevealSecret({
      resourceId: request.resourceId,
      name: request.name,
    });
    if (request.generation !== revealGeneration) return;
    setRevealPending(null);
    if (requestError) {
      setRevealedSecret(null);
      setRevealError(request);
      return;
    }
    if (!fnCanApplySecretReveal(
      request,
      revealGeneration,
      props.resource.id,
      activeTab(),
      document.visibilityState === "visible",
      secretPage(),
      { kind: value.kind, name: value.name, revision: value.revision },
    )) return;
    setRevealError(null);
    setRevealedSecret({ ...request, value: value.value });
  };

  const revealedFor = (entry: TSecretDataEntry): TRevealedSecret | null => {
    const revealed = revealedSecret();
    return revealed?.resourceId === props.resource.id
      && revealed.name === entry.name
      && revealed.revision === entry.revision
      ? revealed
      : null;
  };

  const revealPendingFor = (entry: TSecretDataEntry): boolean => {
    const pending = revealPending();
    return pending?.resourceId === props.resource.id
      && pending.name === entry.name
      && pending.revision === entry.revision;
  };

  const revealFailedFor = (entry: TSecretDataEntry): boolean => {
    const failure = revealError();
    return failure?.resourceId === props.resource.id
      && failure.name === entry.name
      && failure.revision === entry.revision;
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
    const [saveError] = await orpcWebsocketService.apiService.api.resource.resources.dataSet({
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
    closeEntryEditor();
    setCursorHistory([undefined]);
    await loadData(undefined);
    showSuccessToast(props.resource.kind === "kv" ? (editor.mode === "create" ? "Value created" : "Value updated") : (editor.mode === "create" ? "Secret created" : "Secret rotated"));
  };

  const removeEntry = async () => {
    const entry = entryDelete();
    if (!entry) return;
    setEntryBusy(true);
    const [removeError] = await orpcWebsocketService.apiService.api.resource.resources.dataDelete({
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
    const [renameError] = await orpcWebsocketService.apiService.api.resource.resources.rename({ resourceId: props.resource.id, name: value });
    setBusy(false);
    if (renameError) return showErrorToast(renameError.message);
    setDisplayName(value);
    showSuccessToast("Resource renamed");
    catalogInvalidation.invalidate("resources");
  };

  const remove = async () => {
    clearSecretReveal();
    setBusy(true);
    const [deleteError] = await orpcWebsocketService.apiService.api.resource.resources.delete({ resourceId: props.resource.id });
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
            <section class={styles.panel}><div class={styles.panelHeader}><h3 class={styles.panelTitle}>Settings</h3></div><div class={styles.panelBody}><TextField.Root value={name()} onChange={setName}><TextField.Label class={styles.label}>Display name</TextField.Label><TextField.Input class={styles.input} /></TextField.Root><div class={styles.actions}><Button class={`${styles.button} ${styles.primary}`} disabled={busy() || !name().trim() || name().trim() === displayName()} onClick={rename}>Save name</Button></div></div></section>
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
                <Button class={styles.button} disabled={dataLoading()} onClick={() => void loadData(cursorHistory().at(-1))}>Refresh</Button>
                <Button class={styles.button} disabled={dataLoading() || (!prefix() && !appliedPrefix())} onClick={() => void clearSearch()}>Clear</Button>
                <Show when={dataError()}><p class={styles.error} role="alert">{dataError()}</p></Show>
              </div>
              <Show when={kvPage()}>{(page) => <div class={styles.tableScroll}><table class={styles.table}><thead><tr><th>Key</th><th>Value preview</th><th>Revision</th><th>Updated</th><th>Actions</th></tr></thead><tbody><For each={page().entries} fallback={<tr><td colSpan={5} class={styles.empty}>{dataLoading() ? "Loading values…" : "No matching values."}</td></tr>}>{(entry) => <tr><td><code>{entry.key}</code></td><td class={styles.valuePreview}><code>{entry.valuePreview}{entry.valueTruncated ? "…" : ""}</code></td><td>{entry.revision}</td><td>{entry.updatedAt}</td><td><div class={styles.rowActions}><Button class={styles.rowButton} onClick={() => openEditKvEntry(entry)}>Edit</Button><Button class={`${styles.rowButton} ${styles.danger}`} onClick={() => setEntryDelete({ key: entry.key, revision: entry.revision })}>Delete</Button></div></td></tr>}</For></tbody></table></div>}</Show>
              <Show when={secretPage()}>{(page) => (
                <div class={styles.tableScroll}>
                  <table class={styles.table}>
                    <thead><tr><th>Name</th><th>Value</th><th>Revision</th><th>Created</th><th>Updated</th><th>Actions</th></tr></thead>
                    <tbody>
                      <For each={page().entries} fallback={<tr><td colSpan={6} class={styles.empty}>{dataLoading() ? "Loading secret names…" : "No matching secret names."}</td></tr>}>
                        {(entry) => (
                          <tr>
                            <td><code>{entry.name}</code></td>
                            <td class={styles.secretValueCell}>
                              <Show
                                when={revealedFor(entry)}
                                fallback={(
                                  <div class={styles.secretValueControl}>
                                    <span class={styles.visuallyHidden}>Secret value masked</span>
                                    <code class={styles.secretValueText} aria-hidden="true">••••••••</code>
                                  </div>
                                )}
                              >
                                {(revealed) => (
                                  <div class={`${styles.secretValueControl} ${styles.secretValueRevealed}`}>
                                    <code class={styles.secretValueText}>{revealed().value}</code>
                                  </div>
                                )}
                              </Show>
                              <Show when={revealFailedFor(entry)}><span class={styles.revealError} role="alert">Unable to reveal this secret.</span></Show>
                            </td>
                            <td>{entry.revision}</td>
                            <td>{entry.createdAt}</td>
                            <td>{entry.updatedAt}</td>
                            <td>
                              <div class={styles.rowActions}>
                                <Button
                                  class={styles.rowButton}
                                  aria-label={revealedFor(entry) ? "Hide secret value" : revealPendingFor(entry) ? "Revealing secret value" : "Reveal secret value"}
                                  aria-pressed={revealedFor(entry) !== null}
                                  disabled={revealPendingFor(entry)}
                                  onClick={() => revealedFor(entry) ? clearSecretReveal() : void revealSecret(entry)}
                                >
                                  {revealedFor(entry) ? "Hide" : revealPendingFor(entry) ? "Revealing…" : "Reveal"}
                                </Button>
                                <Button class={styles.rowButton} onClick={() => openEditSecretEntry(entry)}>Rotate</Button>
                                <Button class={`${styles.rowButton} ${styles.danger}`} onClick={() => openDeleteEntry({ key: entry.name, revision: entry.revision })}>Delete</Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              )}</Show>
              <Show when={!dataPage()}><div class={`${styles.empty} ${styles.tableScroll}`}>{dataLoading() ? "Loading data…" : "No data loaded."}</div></Show>
              <div class={styles.pagination}><Button class={styles.button} disabled={dataLoading() || cursorHistory().length <= 1} onClick={() => void previousPage()}>Previous</Button><span>Page {cursorHistory().length}{appliedPrefix() ? ` · prefix “${appliedPrefix()}”` : ""}</span><Button class={styles.button} disabled={dataLoading() || !dataPage()?.nextCursor} onClick={() => void nextPage()}>Next</Button></div>
            </section>
          </main>
        </Tabs.Content>
      </Tabs.Root>
      <Dialog.Root open={entryEditor() !== null} onOpenChange={(open) => { if (!open && !entryBusy()) closeEntryEditor(); }}>
        <Dialog.Portal>
          <Dialog.Overlay class={styles.dialogOverlay} />
          <Dialog.Content class={styles.dialogContent}>
            <Dialog.Title class={styles.panelTitle}>{entryEditor()?.mode === "create" ? (props.resource.kind === "kv" ? "Add value" : "Add secret") : (props.resource.kind === "kv" ? "Edit value" : "Rotate secret")}</Dialog.Title>
            <Dialog.Description class={styles.muted}>{props.resource.kind === "kv" ? "Values are stored as JSON. Saving requires the revision that was loaded." : "Secret values are encrypted at rest and masked by default. Use Show or Reveal only when you intend to expose a value on screen."}</Dialog.Description>
            <Show when={entryEditor()}>{(editor) => (
              <div class={styles.form}>
                <TextField.Root value={editor().key} onChange={(key) => setEntryEditor({ ...editor(), key })} disabled={editor().mode === "edit"}>
                  <TextField.Label class={styles.label}>{props.resource.kind === "kv" ? "Key" : "Secret name"}</TextField.Label>
                  <TextField.Input class={styles.input} autocomplete="off" />
                </TextField.Root>
                <Show
                  when={props.resource.kind === "kv"}
                  fallback={(
                    <TextField.Root value={editor().value} onChange={(value) => setEntryEditor({ ...editor(), value })}>
                      <TextField.Label class={styles.label}>{editor().mode === "create" ? "Secret value" : "Replacement secret value"}</TextField.Label>
                      <div class={styles.inputWithAction}>
                        <TextField.Input
                          id="secret-entry-value"
                          class={`${styles.input} ${secretValueVisible() ? "" : styles.secretInputMasked}`}
                          type="text"
                          autocomplete="off"
                          autocapitalize="off"
                          spellcheck={false}
                          data-1p-ignore
                          data-bwignore
                          data-lpignore="true"
                        />
                        <Button
                          type="button"
                          class={`${styles.button} ${styles.inputAction}`}
                          aria-controls="secret-entry-value"
                          aria-label={secretValueVisible() ? "Hide secret value" : "Show secret value"}
                          aria-pressed={secretValueVisible()}
                          onClick={() => setSecretValueVisible((visible) => !visible)}
                        >
                          {secretValueVisible() ? "Hide" : "Show"}
                        </Button>
                      </div>
                    </TextField.Root>
                  )}
                >
                  <TextField.Root value={editor().value} onChange={(value) => setEntryEditor({ ...editor(), value })}>
                    <TextField.Label class={styles.label}>JSON value</TextField.Label>
                    <TextField.TextArea class={styles.textarea} placeholder={editor().valueTruncated ? "Current value is larger than its preview. Enter the complete replacement JSON." : "{}"} />
                  </TextField.Root>
                </Show>
                <Show when={editor().valueTruncated}><p class={styles.muted}>The current value was not loaded because it exceeds the preview limit. Enter a complete replacement value.</p></Show>
                <Show when={entryError()}><p class={styles.dialogError} role="alert">{entryError()}</p></Show>
              </div>
            )}</Show>
            <div class={styles.actions}><Dialog.CloseButton class={styles.button} disabled={entryBusy()}>Cancel</Dialog.CloseButton><Button class={`${styles.button} ${styles.primary}`} disabled={entryBusy()} onClick={() => void saveEntry()}>{entryBusy() ? "Saving…" : entryEditor()?.mode === "create" ? "Create" : props.resource.kind === "kv" ? "Save value" : "Rotate secret"}</Button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AlertDialog.Root open={entryDelete() !== null} onOpenChange={(open) => { if (!open && !entryBusy()) setEntryDelete(null); }}><AlertDialog.Portal><AlertDialog.Overlay class={styles.dialogOverlay} /><AlertDialog.Content class={styles.dialogContent}><AlertDialog.Title class={styles.panelTitle}>Delete {props.resource.kind === "kv" ? "value" : "secret"}</AlertDialog.Title><AlertDialog.Description class={styles.muted}>Permanently delete <code>{entryDelete()?.key}</code>? The delete succeeds only if revision {entryDelete()?.revision} is still current.</AlertDialog.Description><div class={styles.actions}><AlertDialog.CloseButton class={styles.button} disabled={entryBusy()}>Cancel</AlertDialog.CloseButton><Button class={`${styles.button} ${styles.dangerConfirm}`} disabled={entryBusy()} onClick={() => void removeEntry()}>{entryBusy() ? "Deleting…" : "Delete"}</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
      <AlertDialog.Root open={deleteOpen()} onOpenChange={setDeleteOpen}><AlertDialog.Portal><AlertDialog.Overlay class={styles.dialogOverlay} /><AlertDialog.Content class={styles.dialogContent}><AlertDialog.Title class={styles.panelTitle}>Delete resource</AlertDialog.Title><AlertDialog.Description class={styles.muted}>This permanently deletes {displayName()}. This action cannot be undone.</AlertDialog.Description><div class={styles.actions}><AlertDialog.CloseButton class={styles.button}>Cancel</AlertDialog.CloseButton><Button class={`${styles.button} ${styles.dangerConfirm}`} disabled={busy()} onClick={remove}>Delete resource</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    </div>
  );
};

export default GenericResourcePage;
