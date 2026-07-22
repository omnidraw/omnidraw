import * as AlertDialog from '@kobalte/core/alert-dialog';
import { Button } from '@kobalte/core/button';
import * as Tabs from '@kobalte/core/tabs';
import { ActorStateMachineView } from '@vibecanvas/ui-actor-legacy';
import { ToolIconPicker } from '../ToolIconPicker/ToolIconPicker';
import type { TWidgetDetail, TWidgetFileEntry, TWidgetFilePreview, TWidgetSource } from '@vibecanvas/orpc-client';
import File from 'lucide-solid/icons/file';
import Folder from 'lucide-solid/icons/folder';
import PanelLeft from 'lucide-solid/icons/panel-left';
import Trash2 from 'lucide-solid/icons/trash-2';
import { For, Show, createEffect, createMemo, createSignal, type Component } from 'solid-js';
import { useWidgetCatalog } from './WidgetCatalogProvider';
import { WidgetIcon } from './components/WidgetIcon';
import { fnWidgetMessageRows } from './fn.widget-manifest';
import styles from './WidgetDetailPage.module.css';
import type { TSidebarController, TWidgetDetailQueryPort } from '../ports';
import { WidgetPublicationDialog } from '../../publication/WidgetPublicationDialog';
import type { TWidgetPublicationState } from '../../publication/interface';

export type TWidgetDetailPageProps = {
  source: TWidgetSource | null;
  name: string | null;
  controller: TSidebarController;
  query: TWidgetDetailQueryPort;
};
type TTab = 'overview' | 'config' | 'messages' | 'states' | 'files';

export const WidgetDetailPage: Component<TWidgetDetailPageProps> = (props) => {
  const application = props.controller.application;
  const catalogState = useWidgetCatalog();
  const [detail, setDetail] = createSignal<TWidgetDetail | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [files, setFiles] = createSignal<TWidgetFileEntry[] | null>(null);
  const [filesError, setFilesError] = createSignal('');
  const [preview, setPreview] = createSignal<TWidgetFilePreview | null>(null);
  const [previewError, setPreviewError] = createSignal('');
  const [icon, setIcon] = createSignal<TWidgetDetail['variant']['tool']['icon']>(null);
  const [group, setGroup] = createSignal('');
  const [metadataName, setMetadataName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [toolLabel, setToolLabel] = createSignal('');
  const [priority, setPriority] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [publishOpen, setPublishOpen] = createSignal(false);
  const [publicationState, setPublicationState] = createSignal<TWidgetPublicationState>({ open: false, loading: true, publishing: false, actionLabel: 'Publish' });
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  let detailRequest = 0;
  let fileListRequest = 0;
  let previewRequest = 0;

  const activeTab = (): TTab => props.query.tab() === 'config'
    || props.query.tab() === 'messages'
    || props.query.tab() === 'states'
    || props.query.tab() === 'files'
    ? props.query.tab() as TTab
    : 'overview';
  const selectedPath = () => props.query.path() ?? '';
  const messages = createMemo(() => fnWidgetMessageRows(detail()?.manifest ?? null));
  const legacyManifest = createMemo(() => {
    const manifest = detail()?.manifest;
    return manifest && 'actor' in manifest ? manifest : null;
  });

  const loadDetail = async () => {
    const source = props.source;
    const name = props.name;
    const request = ++detailRequest;
    setLoading(true);
    setError('');
    if (!source || !name) {
      setLoading(false);
      setDetail(null);
      setError('This widget route is malformed.');
      return;
    }
    const [loadError, value] = await props.controller.apiService.api.agent.widgets.detail({ name, source });
    if (request !== detailRequest) return;
    setLoading(false);
    if (loadError) {
      setDetail(null);
      setError(loadError.message);
      return;
    }
    if (!value) {
      setDetail(null);
      setError(`${source === 'published' ? 'Published widget' : 'Widget draft'} not found.`);
      await catalogState.refresh();
      return;
    }
    setDetail(value);
    setIcon(value.variant.tool.icon);
    setGroup(value.variant.tool.group ?? '');
    setMetadataName(value.manifest?.name ?? value.name);
    setDescription(value.manifest?.description ?? '');
    const legacy = value.manifest && 'actor' in value.manifest ? value.manifest : null;
    setToolLabel(legacy?.widget.tool.label ?? value.variant.tool.label ?? '');
    setPriority(legacy?.widget.tool.priority === undefined ? '' : String(legacy.widget.tool.priority));
  };

  const loadFiles = async () => {
    if (!props.source || !props.name) return;
    const request = ++fileListRequest;
    setFilesError('');
    const [loadError, value] = await props.controller.apiService.api.agent.widgets.files({ name: props.name, source: props.source });
    if (request !== fileListRequest) return;
    if (loadError || !value) {
      setFiles(null);
      setFilesError(loadError?.message ?? 'Widget files were not found.');
      return;
    }
    setFiles(value);
  };

  const loadPreview = async (path: string) => {
    if (!props.source || !props.name || !path) { setPreview(null); return; }
    const request = ++previewRequest;
    setPreview(null);
    setPreviewError('');
    const [loadError, value] = await props.controller.apiService.api.agent.widgets.file({ name: props.name, source: props.source, path });
    if (request !== previewRequest) return;
    if (loadError || !value) {
      setPreviewError(loadError?.message ?? 'Widget file was not found.');
      return;
    }
    setPreview(value);
  };

  createEffect(() => {
    void props.source;
    void props.name;
    setFiles(null);
    setPreview(null);
    void loadDetail();
  });

  createEffect(() => {
    if (activeTab() !== 'files') return;
    const name = props.name;
    const source = props.source;
    if (!name || !source) return;
    if (!files()) void loadFiles();
  });

  createEffect(() => {
    if (activeTab() !== 'files') return;
    const path = selectedPath();
    void loadPreview(path);
  });

  const selectTab = (value: string) => {
    const tab: TTab = value === 'config' || value === 'messages' || value === 'states' || value === 'files' ? value : 'overview';
    props.query.set(tab === 'files' ? { tab, path: selectedPath() || undefined } : { tab, path: undefined });
  };

  const editAsDraft = async () => {
    const current = detail();
    if (!current || current.source !== 'published') return;
    setSaving(true);
    const [ensureError] = await props.controller.apiService.api.agent.widgets.ensureDraft({
      name: current.name,
      expectedPublishedFingerprint: current.variant.contentFingerprint ?? undefined,
    });
    setSaving(false);
    if (ensureError) { application.notifyError(ensureError.message); return; }
    await catalogState.refresh();
    application.navigate(`/widgets/draft/${encodeURIComponent(current.name)}?tab=config`);
  };

  const saveMetadata = async () => {
    const current = detail();
    if (!current || current.source !== 'draft') return;
    const nextName = metadataName().trim();
    const nextLabel = toolLabel().trim();
    const priorityText = priority().trim();
    const nextPriority = priorityText.length > 0 ? Number(priorityText) : null;
    if (!nextName) { application.notifyError('Widget name is required.'); return; }
    if (!nextLabel) { application.notifyError('Tool label is required.'); return; }
    if (nextPriority !== null && !Number.isFinite(nextPriority)) { application.notifyError('Priority must be a number.'); return; }
    setSaving(true);
    const [saveError, result] = await props.controller.apiService.api.agent.widgets.patchDraftMetadata({
      name: current.name,
      expectedRevision: current.variant.revision,
      patch: {
        name: nextName,
        description: description(),
        ...(legacyManifest()
          ? { tool: { label: nextLabel, icon: icon(), group: group() || null, priority: nextPriority } }
          : {}),
      },
    });
    setSaving(false);
    if (saveError) {
      const selected = {
        name: metadataName(),
        description: description(),
        label: toolLabel(),
        priority: priority(),
        icon: icon(),
        group: group(),
      };
      application.notifyError(saveError.message);
      await loadDetail();
      if (saveError.message.includes('STALE_REVISION:')) {
        setMetadataName(selected.name);
        setDescription(selected.description);
        setToolLabel(selected.label);
        setPriority(selected.priority);
        setIcon(selected.icon);
        setGroup(selected.group);
      }
      return;
    }
    application.notifySuccess('Widget draft configuration saved');
    await catalogState.refresh();
    if (result.name !== current.name) {
      application.navigate(`/widgets/draft/${encodeURIComponent(result.name)}?tab=config`, { replace: true });
      return;
    }
    await loadDetail();
  };

  const removeWidget = async () => {
    const current = detail();
    if (!current) return;
    setDeleting(true);
    const [deleteError, result] = await props.controller.apiService.api.agent.widgets.delete({ name: current.name, source: current.source });
    setDeleting(false);
    if (deleteError) { application.notifyError(deleteError.message); return; }
    setDeleteOpen(false);
    const selectedSourceDeleted = current.source === 'published' ? result.deletedPublished : result.deletedDraft;
    const issueDescription = result.issues.map((issue) => issue.message).join(' ');
    if (result.issues.length > 0) {
      const title = selectedSourceDeleted ? 'Widget cleanup completed with warnings' : 'Widget cleanup incomplete';
      if (selectedSourceDeleted) application.notifySuccess(title, issueDescription);
      else application.notifyError(title, issueDescription);
    } else {
      application.notifySuccess(current.source === 'published'
        ? result.deletedInstances
          ? 'Published widget, draft, and instances deleted'
          : 'Published widget archived'
        : 'Widget draft deleted');
    }
    await catalogState.refresh();
    if (selectedSourceDeleted) application.navigate('/');
    else await loadDetail();
  };

  return (
    <Show when={!loading() && detail()} fallback={<div class={styles.routeState} role="status"><p>{error() || 'Loading widget…'}</p></div>}>
      {(current) => <Tabs.Root class={styles.page} value={activeTab()} onChange={selectTab}>
        <header class={styles.header}>
          <div class={styles.titleBlock}>
            <WidgetIcon icon={current().variant.tool.icon} class={styles.headerIcon} />
            <div><p class={styles.eyebrow}>{current().source === 'published' ? 'Published widget' : 'Widget draft'}</p><h2>{current().variant.displayName}</h2></div>
          </div>
          <div class={styles.headerActions}>
            <Show when={current().source === 'published'}><Button class={styles.button} disabled={saving()} onClick={editAsDraft}>Edit as draft</Button></Show>
            <Show when={current().source === 'draft'}><Button class={`${styles.button} ${styles.primary}`} disabled={!current().variant.draftId || saving() || publicationState().loading || publicationState().open || publicationState().publishing} aria-busy={publicationState().publishing} onClick={() => setPublishOpen(true)}>{publicationState().publishing ? `${publicationState().actionLabel}ing…` : publicationState().loading ? 'Checking…' : publicationState().actionLabel}</Button></Show>
            <Button class={`${styles.button} ${styles.iconButton}`} aria-label="Toggle sidebar" onClick={application.toggleSidebar}><PanelLeft size={15} /></Button>
          </div>
        </header>
        <Tabs.List class={styles.tabs}><Tabs.Trigger class={styles.tab} value="overview">Overview</Tabs.Trigger><Tabs.Trigger class={styles.tab} value="config">Config</Tabs.Trigger><Tabs.Trigger class={styles.tab} value="messages">Messages</Tabs.Trigger><Tabs.Trigger class={styles.tab} value="states">States</Tabs.Trigger><Tabs.Trigger class={styles.tab} value="files">Files</Tabs.Trigger></Tabs.List>

        <Tabs.Content class={styles.content} value="overview"><div class={styles.contentInner}>
          <section class={styles.panel}><h3>Widget</h3><dl class={styles.definitionList}><dt>Slug</dt><dd>{current().variant.slug ?? '—'}</dd><dt>Health</dt><dd><Show when={current().problem} fallback={<span class={styles.healthy}>Healthy</span>}>{(problem) => <span class={styles.problem}>{problem().code}</span>}</Show></dd><dt>Description</dt><dd>{current().variant.description || 'No description.'}</dd><dt>Tool label</dt><dd>{current().variant.tool.label ?? '—'}</dd><dt>Behavior</dt><dd>{current().variant.tool.behaviorType ?? '—'}</dd><dt>Tool group</dt><dd>{current().variant.tool.group ?? 'Ungrouped'}</dd><dt>Source relationship</dt><dd>{current().relation}</dd><dt>Updated</dt><dd>{current().variant.updatedAt ?? 'Unknown'}</dd></dl></section>
          <Show when={current().source === 'draft'}><section class={styles.panel}><h3>Validation</h3><p class={styles.muted}>{current().variant.validation?.status ?? 'unknown'}</p><For each={current().variant.validation?.errors}>{(item) => <p class={styles.validationError}>{item}</p>}</For><For each={current().variant.validation?.warnings}>{(item) => <p class={styles.validationWarning}>{item}</p>}</For></section></Show>
          <Show when={current().problem}>{(problem) => <section class={styles.problemPanel}><h3>{problem().code}</h3><p>{problem().message}</p></section>}</Show>
          <section class={`${styles.panel} ${styles.dangerPanel}`}><div><h3>Delete {current().source === 'published' ? 'published widget' : 'draft'}</h3><p class={styles.muted}>{current().source === 'published' ? current().variant.kind === 'widget' ? 'Archives this publication and deletes its draft if one exists. Existing canvas instances stay pinned to their immutable revision.' : 'Permanently removes the published widget, its draft if one exists, and all canvas actor instances.' : 'Permanently removes only this draft. The published widget and all of its canvas instances remain unchanged.'}</p></div><Button class={`${styles.button} ${styles.dangerButton}`} onClick={() => setDeleteOpen(true)}><Trash2 size={13} /> {current().source === 'published' ? current().variant.kind === 'widget' ? 'Archive publication' : 'Delete widget' : 'Delete draft'}</Button></section>
        </div></Tabs.Content>

        <Tabs.Content class={styles.content} value="config"><div class={styles.contentInner}>
          <section class={styles.panel}><h3>Widget configuration</h3><Show when={current().manifest} fallback={<p class={styles.validationError}>The manifest is invalid. Repair vibecanvas.json from the Files tab before editing structured configuration.</p>}><Show when={current().source === 'draft'} fallback={<><p class={styles.muted}>Published configuration is immutable. Create or reuse a draft to edit it.</p><Button class={styles.button} onClick={editAsDraft}>Edit as draft</Button></>}>
            <div class={styles.formGrid}>
              <label>Name<input class={styles.input} value={metadataName()} onInput={(event) => setMetadataName(event.currentTarget.value)} maxlength={120} /><span class={styles.fieldHint}>Renaming a draft creates a new draft identity; an existing published widget keeps its current name.</span></label>
              <label>Tool label<input class={styles.input} value={toolLabel()} onInput={(event) => setToolLabel(event.currentTarget.value)} maxlength={120} /></label>
              <label class={styles.fullField}>Description<textarea class={`${styles.input} ${styles.textarea}`} value={description()} onInput={(event) => setDescription(event.currentTarget.value)} maxlength={4000} /></label>
              <div class={styles.fullField}><ToolIconPicker value={icon()} onChange={setIcon} /></div>
              <label>Group<select class={styles.select} value={group()} onChange={(event) => setGroup(event.currentTarget.value)}><option value="">Ungrouped</option><For each={catalogState.catalog()?.groups}>{(item) => <option value={item.name}>{item.name}</option>}</For></select></label>
              <label>Priority<input class={styles.input} inputmode="decimal" value={priority()} onInput={(event) => setPriority(event.currentTarget.value)} placeholder="Default" /></label>
              <div class={`${styles.formActions} ${styles.fullField}`}><Button class={`${styles.button} ${styles.primary}`} disabled={saving()} onClick={saveMetadata}>{saving() ? 'Saving…' : 'Save configuration'}</Button></div>
            </div>
          </Show></Show></section>
        </div></Tabs.Content>

        <Tabs.Content class={styles.content} value="messages"><div class={styles.contentInner}>
          <section class={styles.panel}><h3>Actor messages</h3><p class={styles.messageIntro}>A message is a named JSON payload sent across the widget–actor boundary. Input messages ask the actor to do something; output messages are events the actor may emit asynchronously, not direct function return values.</p></section>
          <div class={styles.messageColumns}>
            <section class={styles.panel}><h3>Accepted inputs</h3><For each={messages().inputs} fallback={<p class={styles.muted}>This actor declares no input messages.</p>}>{(message) => <article class={styles.messageCard}><div class={styles.messageHeader}><code>{message.name}</code><span>{message.acceptedInStates.length > 0 ? `Accepted in ${message.acceptedInStates.join(', ')}` : 'Not connected to a state transition'}</span></div><pre class={`${styles.code} ${styles.schemaCode}`}>{JSON.stringify(message.schema, null, 2)}</pre></article>}</For></section>
            <section class={styles.panel}><h3>Emitted outputs</h3><For each={messages().outputs} fallback={<p class={styles.muted}>This actor declares no output messages.</p>}>{(message) => <article class={styles.messageCard}><div class={styles.messageHeader}><code>{message.name}</code><span>Actor event</span></div><pre class={`${styles.code} ${styles.schemaCode}`}>{JSON.stringify(message.schema, null, 2)}</pre></article>}</For></section>
          </div>
        </div></Tabs.Content>

        <Tabs.Content class={`${styles.content} ${styles.statesContent}`} value="states"><Show when={legacyManifest()} fallback={<div class={styles.contentInner}><section class={styles.panel}><p class={styles.muted}>Manifest-v2 widgets use local Arrow state, collaborative state, and short server functions instead of an actor state machine.</p></section></div>}>{(manifest) => <ActorStateMachineView manifest={manifest()} variant="embedded" title={`${current().variant.displayName} actor`} />}</Show></Tabs.Content>

        <Tabs.Content class={`${styles.content} ${styles.filesContent}`} value="files"><div class={styles.fileWorkbench}>
          <aside class={styles.fileTree} aria-label="Widget files"><Show when={filesError()}>{(message) => <p class={styles.validationError}>{message()}</p>}</Show><For each={files()} fallback={<p class={styles.muted}>Loading files…</p>}>{(entry) => entry.kind === 'directory' ? <div class={styles.directory} style={{ 'padding-left': `${entry.path.split('/').length * .75}rem` }}><Folder size={12} /> {entry.path.split('/').at(-1)}</div> : <Button class={`${styles.fileRow} ${selectedPath() === entry.path ? styles.fileSelected : ''}`} style={{ 'padding-left': `${entry.path.split('/').length * .75}rem` }} onClick={() => props.query.set({ tab: 'files', path: entry.path })}><File size={12} /><span>{entry.path.split('/').at(-1)}</span><small>{entry.size} B</small></Button>}</For></aside>
          <section class={styles.preview}><Show when={previewError()}>{(message) => <p class={styles.validationError}>{message()}</p>}</Show><Show when={preview()} fallback={<p class={styles.muted}>Select a file to inspect it.</p>}>{(file) => <><div class={styles.previewHeader}><strong>{file().path}</strong><span>{file().size} bytes{file().truncated ? ' · preview truncated' : ''}</span></div>{file().binary ? <p class={styles.muted}>Binary file. Content preview is unavailable.</p> : <pre class={styles.code}>{file().text}</pre>}</>}</Show></section>
        </div></Tabs.Content>

        <AlertDialog.Root open={deleteOpen()} onOpenChange={(open) => { if (!deleting()) setDeleteOpen(open); }}><AlertDialog.Portal><AlertDialog.Overlay class={styles.dialogOverlay} /><AlertDialog.Content class={styles.dialogContent}><AlertDialog.Title class={styles.dialogTitle}>{current().source === 'published' ? current().variant.kind === 'widget' ? 'Archive published widget' : 'Delete published widget' : 'Delete widget draft'}</AlertDialog.Title><AlertDialog.Description class={styles.dialogDescription}>{current().source === 'published' ? current().variant.kind === 'widget' ? `Archive the published widget “${current().variant.displayName}” and delete its draft if one exists? Existing canvas instances remain pinned to this immutable revision.` : `Delete the published widget “${current().variant.displayName}”? Its draft, toolbar definition, and all canvas actor instances will also be permanently deleted. This cannot be undone.` : `Delete only the draft “${current().variant.displayName}”? The published widget and all of its canvas instances will remain unchanged. This cannot be undone.`}</AlertDialog.Description><div class={styles.dialogActions}><AlertDialog.CloseButton class={styles.button} disabled={deleting()}>Cancel</AlertDialog.CloseButton><Button class={`${styles.button} ${styles.dangerButton}`} disabled={deleting()} onClick={removeWidget}>{deleting() ? 'Deleting…' : current().source === 'published' ? current().variant.kind === 'widget' ? 'Archive publication' : 'Delete widget and instances' : 'Delete draft only'}</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
        <Show when={current().source === 'draft' ? current().variant.draftId : null}>
          {(draftId) => <WidgetPublicationDialog
            api={props.controller.apiService.api.agent}
            draftId={draftId()}
            draftName={current().name}
            open={publishOpen()}
            onOpenChange={setPublishOpen}
            onStateChange={setPublicationState}
            onPublished={async ({ result }) => {
              application.notifySuccess('Widget published');
              props.controller.invalidation.invalidate('widgets');
              await catalogState.refresh();
              setPublishOpen(false);
              application.navigate(`/widgets/published/${encodeURIComponent(result.manifest.name)}?tab=overview`, { replace: true });
            }}
          />}
        </Show>
      </Tabs.Root>}
    </Show>
  );
};
