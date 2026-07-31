import * as AlertDialog from '@kobalte/core/alert-dialog';
import { Button } from '@kobalte/core/button';
import * as Tabs from '@kobalte/core/tabs';
import type { TWidgetDetail, TWidgetFileEntry, TWidgetFilePreview, TWidgetSource } from '@omnidraw/orpc-client';
import File from 'lucide-solid/icons/file';
import Folder from 'lucide-solid/icons/folder';
import PanelLeft from 'lucide-solid/icons/panel-left';
import Trash2 from 'lucide-solid/icons/trash-2';
import { For, Show, createEffect, createMemo, createSignal, type Component } from 'solid-js';
import { useWidgetCatalog } from './WidgetCatalogProvider';
import { WidgetIcon } from './components/WidgetIcon';
import styles from './WidgetDetailPage.module.css';
import type { TSidebarController, TWidgetDetailQueryPort } from '../ports';
import { WidgetPublicationDialog } from '../../publication/WidgetPublicationDialog';
import type {
  TWidgetPublicationPreviewSelection,
  TWidgetPublicationState,
} from '../../publication/interface';

export type TWidgetDetailPageProps = {
  source: TWidgetSource | null;
  name: string | null;
  controller: TSidebarController;
  query: TWidgetDetailQueryPort;
};

type TTab =
  | 'overview'
  | 'config'
  | 'functions'
  | 'collaborative-state'
  | 'runs'
  | 'logs'
  | 'resources'
  | 'files';

type TTabDefinition = Readonly<{
  value: TTab;
  label: string;
}>;

const V2_TABS = Object.freeze([
  { value: 'overview', label: 'Overview' },
  { value: 'config', label: 'Config' },
  { value: 'functions', label: 'Functions' },
  { value: 'collaborative-state', label: 'Collaborative State' },
  { value: 'runs', label: 'Runs' },
  { value: 'logs', label: 'Logs' },
  { value: 'resources', label: 'Resources' },
  { value: 'files', label: 'Files' },
] satisfies readonly TTabDefinition[]);

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
  const [metadataName, setMetadataName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [publishOpen, setPublishOpen] = createSignal(false);
  const [publicationState, setPublicationState] = createSignal<TWidgetPublicationState>({
    open: false,
    loading: true,
    publishing: false,
    previewAvailable: false,
    previewSelected: false,
    actionLabel: 'Publish',
  });
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  let detailRequest = 0;
  let fileListRequest = 0;
  let previewRequest = 0;

  const selectedPath = () => props.query.path() ?? '';
  const v2Manifest = createMemo(() => detail()?.manifest ?? null);
  const inspectorTabs = createMemo<readonly TTabDefinition[]>(() => V2_TABS);
  const activeTab = (): TTab => {
    const requested = props.query.tab();
    return inspectorTabs().some((tab) => tab.value === requested)
      ? requested as TTab
      : 'overview';
  };

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
    setMetadataName(value.manifest?.name ?? value.name);
    setDescription(value.manifest?.description ?? '');
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
    const tab = inspectorTabs().find((candidate) => candidate.value === value)?.value ?? 'overview';
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
    if (!nextName) { application.notifyError('Widget name is required.'); return; }
    setSaving(true);
    const [saveError, result] = await props.controller.apiService.api.agent.widgets.patchDraftMetadata({
      name: current.name,
      expectedRevision: current.variant.revision,
      patch: {
        name: nextName,
        description: description(),
      },
    });
    setSaving(false);
    if (saveError) {
      const selected = {
        name: metadataName(),
        description: description(),
      };
      application.notifyError(saveError.message);
      await loadDetail();
      if (saveError.message.includes('STALE_REVISION:')) {
        setMetadataName(selected.name);
        setDescription(selected.description);
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

  const resolvePreviewSelections = async (): Promise<
    readonly TWidgetPublicationPreviewSelection[]
  > => {
    const current = detail();
    if (
      !current
      || current.source !== 'draft'
      || current.variant.draftId === null
    ) return [];
    const listOwners = props.controller.apiService.api.agent.widgetPreview?.owner?.list;
    const canvases = application.canvases?.() ?? [];
    if (!listOwners || canvases.length === 0) return [];

    const selections = await Promise.all(canvases.map(async (canvas) => {
      const [listError, owners] = await listOwners({
        canvasId: canvas.id,
        draftId: current.variant.draftId!,
      });
      if (listError || !owners) {
        throw new Error(
          listError?.message
          ?? `Could not inspect ready Previews on “${canvas.name}”.`,
        );
      }
      return owners
        .filter((owner) =>
          owner.draftId === current.variant.draftId
          && owner.canvasId === canvas.id
          && owner.status === 'ready'
          && owner.activeRevisionId !== null
          && owner.bindingPlanDigestSha256 !== null
          && owner.closedAtMs === null)
        .map((owner): TWidgetPublicationPreviewSelection => ({
          previewId: owner.id,
          previewRevisionId: owner.activeRevisionId!,
          expectedBindingRevision: owner.bindingRevision,
          expectedBindingPlanDigestSha256: owner.bindingPlanDigestSha256!,
          canvasId: owner.canvasId,
          frameNodeId: owner.frameNodeId,
          label: `${canvas.name} · ${owner.role === 'companion' ? 'Companion' : 'Placed'} Preview · frame ${owner.frameNodeId.slice(0, 12)}`,
        }));
    }));
    return selections.flat();
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
            <Show when={current().source === 'draft'}><Button
              class={`${styles.button} ${styles.primary}`}
              disabled={!current().variant.draftId || saving() || publicationState().loading || publicationState().open || publicationState().publishing}
              aria-busy={publicationState().publishing}
              title={!current().variant.draftId
                ? 'Validate this widget again from its owning AI chat before publishing.'
                : !publicationState().loading && !publicationState().previewAvailable
                  ? 'Open or place this draft on a canvas and wait for its Preview to become ready.'
                  : undefined}
              onClick={() => setPublishOpen(true)}
            >{!current().variant.draftId
              ? 'Needs validation'
              : publicationState().publishing
                ? `${publicationState().actionLabel}ing…`
                : publicationState().loading
                  ? 'Checking…'
                  : publicationState().previewSelected
                    ? publicationState().actionLabel
                    : publicationState().previewAvailable
                      ? 'Choose Preview'
                      : 'Needs Preview'}</Button></Show>
            <Button class={`${styles.button} ${styles.iconButton}`} aria-label="Toggle sidebar" onClick={application.toggleSidebar}><PanelLeft size={15} /></Button>
          </div>
        </header>
        <Tabs.List class={styles.tabs}>
          <For each={inspectorTabs()}>{(tab) => (
            <Tabs.Trigger class={styles.tab} value={tab.value}>{tab.label}</Tabs.Trigger>
          )}</For>
        </Tabs.List>

        <Tabs.Content class={styles.content} value="overview"><div class={styles.contentInner}>
          <section class={styles.panel}><h3>Widget</h3><dl class={styles.definitionList}><dt>Slug</dt><dd>{current().variant.slug ?? '—'}</dd><dt>Health</dt><dd><Show when={current().problem} fallback={<span class={styles.healthy}>Healthy</span>}>{(problem) => <span class={styles.problem}>{problem().code}</span>}</Show></dd><dt>Description</dt><dd>{current().variant.description || 'No description.'}</dd><dt>Tool label</dt><dd>{current().variant.tool.label ?? '—'}</dd><dt>Behavior</dt><dd>{current().variant.tool.behaviorType ?? '—'}</dd><dt>Tool group</dt><dd>{current().variant.tool.group ?? 'Ungrouped'}</dd><dt>Source relationship</dt><dd>{current().relation}</dd><dt>Updated</dt><dd>{current().variant.updatedAt ?? 'Unknown'}</dd></dl></section>
          <Show when={current().source === 'draft' && !publicationState().loading && !publicationState().previewAvailable}>
            <section class={styles.panel}>
              <h3>Publication</h3>
              <p class={styles.muted}>Publication requires an exact ready frame-owned Preview. Open or place this draft on a canvas, wait for the Preview to become ready, then publish from its title bar or return here.</p>
            </section>
          </Show>
          <Show when={current().source === 'draft'}><section class={styles.panel}><h3>Validation</h3><p class={styles.muted}>{current().variant.validation?.status ?? 'unknown'}</p><For each={current().variant.validation?.errors}>{(item) => <p class={styles.validationError}>{item}</p>}</For><For each={current().variant.validation?.warnings}>{(item) => <p class={styles.validationWarning}>{item}</p>}</For></section></Show>
          <Show when={current().problem}>{(problem) => <section class={styles.problemPanel}><h3>{problem().code}</h3><p>{problem().message}</p></section>}</Show>
          <section class={`${styles.panel} ${styles.dangerPanel}`}><div><h3>Delete {current().source === 'published' ? 'published widget' : 'draft'}</h3><p class={styles.muted}>{current().source === 'published' ? 'Archives this publication and deletes its draft if one exists. Existing canvas instances stay pinned to their immutable revision.' : 'Permanently removes only this draft. The published widget and all of its canvas instances remain unchanged.'}</p></div><Button class={`${styles.button} ${styles.dangerButton}`} onClick={() => setDeleteOpen(true)}><Trash2 size={13} /> {current().source === 'published' ? 'Archive publication' : 'Delete draft'}</Button></section>
        </div></Tabs.Content>

        <Tabs.Content class={styles.content} value="config"><div class={styles.contentInner}>
          <section class={styles.panel}><h3>Widget configuration</h3><Show when={current().manifest} fallback={<p class={styles.validationError}>The manifest is invalid. Repair omnidraw.json from the Files tab before editing structured configuration.</p>}><Show when={current().source === 'draft'} fallback={<><p class={styles.muted}>Published configuration is immutable. Create or reuse a draft to edit it.</p><Button class={styles.button} onClick={editAsDraft}>Edit as draft</Button></>}>
            <div class={styles.formGrid}>
              <label>Name<input class={styles.input} value={metadataName()} onInput={(event) => setMetadataName(event.currentTarget.value)} maxlength={120} /><span class={styles.fieldHint}>Renaming a draft creates a new draft identity; an existing published widget keeps its current name.</span></label>
              <label class={styles.fullField}>Description<textarea class={`${styles.input} ${styles.textarea}`} value={description()} onInput={(event) => setDescription(event.currentTarget.value)} maxlength={4000} /></label>
              <div class={`${styles.formActions} ${styles.fullField}`}><Button class={`${styles.button} ${styles.primary}`} disabled={saving()} onClick={saveMetadata}>{saving() ? 'Saving…' : 'Save configuration'}</Button></div>
            </div>
          </Show></Show></section>
        </div></Tabs.Content>

          <Tabs.Content class={styles.content} value="functions"><div class={styles.contentInner}>
            <section class={styles.panel}>
              <h3>Server runtime</h3>
              <Show when={v2Manifest()?.server} fallback={<p class={styles.muted}>This widget is browser-only and declares no server entry.</p>}>
                {(server) => <dl class={styles.definitionList}>
                  <dt>Entry</dt><dd><code>{server().entry}</code></dd>
                  <dt>Runtime ABI</dt><dd><code>{server().runtimeAbi}</code></dd>
                  <dt>Browser-safe functions</dt><dd>{current().functions.length}</dd>
                </dl>}
              </Show>
            </section>
            <section class={styles.panel}>
              <h3>Functions</h3>
              <For each={current().functions} fallback={<p class={styles.muted}>{v2Manifest()?.server ? 'No browser-safe function descriptors are available for this revision.' : 'Browser-only widgets have no server functions.'}</p>}>
                {(descriptor) => <article class={styles.inspectorCard}>
                  <div class={styles.inspectorCardHeader}><code>{descriptor.exportName}</code><span class={styles.badge}>{descriptor.effect}</span></div>
                  <dl class={styles.definitionList}>
                    <dt>Resources</dt><dd>{descriptor.resources.map((resource) => `${resource.slot} (${resource.effect})`).join(', ') || 'None'}</dd>
                    <dt>Timeout</dt><dd>{descriptor.limits.timeoutMs} ms</dd>
                    <dt>Memory</dt><dd>{descriptor.limits.memoryTier}</dd>
                    <dt>Output limit</dt><dd>{descriptor.limits.outputByteLimit} bytes</dd>
                    <dt>Log limit</dt><dd>{descriptor.limits.logByteLimit} bytes</dd>
                    <dt>Retry</dt><dd>{descriptor.retry.mode === 'none' ? 'None' : `Up to ${descriptor.retry.maxAttempts} attempts`}</dd>
                  </dl>
                  <div class={styles.schemaGrid}>
                    <div><h4>Input schema</h4><pre class={`${styles.code} ${styles.schemaCode}`}>{JSON.stringify(descriptor.inputSchema, null, 2)}</pre></div>
                    <div><h4>Output schema</h4><pre class={`${styles.code} ${styles.schemaCode}`}>{JSON.stringify(descriptor.outputSchema, null, 2)}</pre></div>
                  </div>
                </article>}
              </For>
            </section>
          </div></Tabs.Content>

          <Tabs.Content class={styles.content} value="collaborative-state"><div class={styles.contentInner}>
            <section class={styles.panel}>
              <h3>Instance-scoped collaborative state</h3>
              <p class={styles.messageIntro}>Each placed widget instance owns centralized versioned JSON state scoped to its organization, canvas, and exact instance identity. Definition revisions do not share mutable state.</p>
              <dl class={styles.definitionList}>
                <dt>Definition revision</dt><dd><code>{current().variant.revision}</code></dd>
                <dt>Lifecycle</dt><dd>Created lazily and changed through compare-and-swap updates from the widget state service.</dd>
                <dt>Manifest entry</dt><dd><code>{v2Manifest()?.ui.entry ?? 'Unavailable'}</code></dd>
              </dl>
            </section>
            <section class={styles.panel}>
              <h3>Placement</h3>
              <Show when={current().variant.placement} fallback={<p class={styles.muted}>No placement descriptor is available for this revision.</p>}>
                {(placement) => <dl class={styles.definitionList}>
                  <dt>Source</dt><dd>{placement().reference.source}</dd>
                  <dt>Reference</dt><dd><code>{placement().reference.name}</code></dd>
                  <dt>Frame</dt><dd>{placement().bounds.width} × {placement().bounds.height}</dd>
                </dl>}
              </Show>
            </section>
          </div></Tabs.Content>

          <Tabs.Content class={styles.content} value="runs"><div class={styles.contentInner}>
            <section class={styles.panel}>
              <h3>Invocation-scoped runs</h3>
              <p class={styles.messageIntro}>Server functions run only when invoked and do not aggregate mutable runtime state across widget instances.</p>
            </section>
            <div class={styles.inspectorGrid}>
              <For each={current().functions} fallback={<section class={styles.panel}><p class={styles.muted}>There are no server functions to run for this revision.</p></section>}>
                {(descriptor) => <article class={`${styles.panel} ${styles.compactCard}`}>
                  <div class={styles.inspectorCardHeader}><code>{descriptor.exportName}</code><span class={styles.badge}>{descriptor.effect}</span></div>
                  <dl class={styles.definitionList}>
                    <dt>Deadline</dt><dd>{descriptor.limits.timeoutMs} ms</dd>
                    <dt>Memory tier</dt><dd>{descriptor.limits.memoryTier}</dd>
                    <dt>Retry policy</dt><dd>{descriptor.retry.mode === 'none' ? 'No automatic retry' : `${descriptor.retry.maxAttempts} attempts maximum`}</dd>
                  </dl>
                </article>}
              </For>
            </div>
            <section class={styles.panel}><h3>Run history</h3><p class={styles.muted}>No invocation is selected. Runs are addressed by the invocation ID returned by each function call, so status and output stay attached to that exact invocation.</p></section>
          </div></Tabs.Content>

          <Tabs.Content class={styles.content} value="logs"><div class={styles.contentInner}>
            <section class={styles.panel}>
              <h3>Invocation logs</h3>
              <p class={styles.messageIntro}>Logs are bounded and retained per function invocation. Select an invocation from its calling widget or session to inspect its output and logs.</p>
            </section>
            <section class={styles.panel}>
              <h3>Per-invocation budgets</h3>
              <For each={current().functions} fallback={<p class={styles.muted}>This revision declares no server-function log streams.</p>}>
                {(descriptor) => <div class={styles.budgetRow}><code>{descriptor.exportName}</code><span>{descriptor.limits.logByteLimit} bytes maximum</span></div>}
              </For>
            </section>
            <section class={styles.panel}><h3>Log stream</h3><p class={styles.muted}>No invocation is selected.</p></section>
          </div></Tabs.Content>

          <Tabs.Content class={styles.content} value="resources"><div class={styles.contentInner}>
            <section class={styles.panel}>
              <h3>Manifest resource requirements</h3>
              <p class={styles.messageIntro}>Functions receive logical resource slots. Concrete resource IDs, credentials, storage paths, and writable handles remain host-owned.</p>
            </section>
            <div class={styles.inspectorGrid}>
              <For each={v2Manifest()?.resources ?? []} fallback={<section class={styles.panel}><p class={styles.muted}>This widget declares no resource requirements.</p></section>}>
                {(requirement) => {
                  const operations = Object.keys(requirement.operations ?? {}).sort((left, right) => left.localeCompare(right));
                  return <article class={`${styles.panel} ${styles.compactCard}`}>
                    <div class={styles.inspectorCardHeader}><code>{requirement.slot}</code><span class={styles.badge}>{requirement.kind}</span></div>
                    <dl class={styles.definitionList}>
                      <dt>Effect ceiling</dt><dd>{requirement.effect === 'read_write' ? 'read + write' : requirement.effect}</dd>
                      <dt>Binding</dt><dd>{requirement.required === undefined ? 'Manifest default' : requirement.required ? 'Required' : 'Optional'}</dd>
                      <dt>Named operations</dt><dd>{operations.join(', ') || 'None'}</dd>
                      <dt>Arbitrary SQL</dt><dd>{requirement.arbitrarySql ? 'Allowed by manifest' : 'Not allowed'}</dd>
                    </dl>
                  </article>;
                }}
              </For>
            </div>
          </div></Tabs.Content>

        <Tabs.Content class={`${styles.content} ${styles.filesContent}`} value="files"><div class={styles.fileWorkbench}>
          <aside class={styles.fileTree} aria-label="Widget files"><Show when={filesError()}>{(message) => <p class={styles.validationError}>{message()}</p>}</Show><For each={files()} fallback={<p class={styles.muted}>Loading files…</p>}>{(entry) => entry.kind === 'directory' ? <div class={styles.directory} style={{ 'padding-left': `${entry.path.split('/').length * .75}rem` }}><Folder size={12} /> {entry.path.split('/').at(-1)}</div> : <Button class={`${styles.fileRow} ${selectedPath() === entry.path ? styles.fileSelected : ''}`} style={{ 'padding-left': `${entry.path.split('/').length * .75}rem` }} onClick={() => props.query.set({ tab: 'files', path: entry.path })}><File size={12} /><span>{entry.path.split('/').at(-1)}</span><small>{entry.size} B</small></Button>}</For></aside>
          <section class={styles.preview}><Show when={previewError()}>{(message) => <p class={styles.validationError}>{message()}</p>}</Show><Show when={preview()} fallback={<p class={styles.muted}>Select a file to inspect it.</p>}>{(file) => <><div class={styles.previewHeader}><strong>{file().path}</strong><span>{file().size} bytes{file().truncated ? ' · preview truncated' : ''}</span></div>{file().binary ? <p class={styles.muted}>Binary file. Content preview is unavailable.</p> : <pre class={styles.code}>{file().text}</pre>}</>}</Show></section>
        </div></Tabs.Content>

        <AlertDialog.Root open={deleteOpen()} onOpenChange={(open) => { if (!deleting()) setDeleteOpen(open); }}><AlertDialog.Portal><AlertDialog.Overlay class={styles.dialogOverlay} /><AlertDialog.Content class={styles.dialogContent}><AlertDialog.Title class={styles.dialogTitle}>{current().source === 'published' ? 'Archive published widget' : 'Delete widget draft'}</AlertDialog.Title><AlertDialog.Description class={styles.dialogDescription}>{current().source === 'published' ? `Archive the published widget “${current().variant.displayName}” and delete its draft if one exists? Existing canvas instances remain pinned to this immutable revision.` : `Delete only the draft “${current().variant.displayName}”? The published widget and all of its canvas instances will remain unchanged. This cannot be undone.`}</AlertDialog.Description><div class={styles.dialogActions}><AlertDialog.CloseButton class={styles.button} disabled={deleting()}>Cancel</AlertDialog.CloseButton><Button class={`${styles.button} ${styles.dangerButton}`} disabled={deleting()} onClick={removeWidget}>{deleting() ? 'Deleting…' : current().source === 'published' ? 'Archive publication' : 'Delete draft only'}</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
        <Show when={current().source === 'draft' ? current().variant.draftId : null}>
          {(draftId) => <WidgetPublicationDialog
            api={props.controller.apiService.api.agent}
            draftId={draftId()}
            draftName={current().name}
            createIdempotencyKey={props.controller.browser.createIdempotencyKey}
            resolvePreviewSelections={resolvePreviewSelections}
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
