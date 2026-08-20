import { Portal } from '@solidjs/web';
import type { TOmnidrawToolIcon } from '@omnidraw/sdk/tool-icon';
import type {
  TWidgetPublicFileEntry,
  TWidgetPublicFilePreview,
} from '../ports';
import { File, Folder, PanelLeft } from '@/shell/framework/components/icons';
import { activateModalFocusScope } from '@/shell/framework/components/ui/modal-focus-scope';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  untrack,
  type Component,
} from 'solid-js';
import {
  ToolIconPicker,
  toolIconValidationError,
} from '../ToolIconPicker/ToolIconPicker';
import { useWidgetCatalog } from './WidgetCatalogProvider';
import {
  WidgetIcon,
  publishedWidgetIconSafetyError,
} from './components/WidgetIcon';
import styles from './WidgetDetailPage.module.css';
import type { TSidebarController, TWidgetDetailQueryPort } from '../ports';
import type { TWidgetSource } from './types';
import type {
  TWidgetPublicDeletionPlan,
  TWidgetPublicMutationResult,
} from '@/core/app/private-operation-contract';

export type TWidgetDetailPageProps = {
  source: TWidgetSource | null;
  name: string | null;
  controller: TSidebarController;
  query: TWidgetDetailQueryPort;
};

type TTab = 'overview' | 'config' | 'functions' | 'resources' | 'files';

const TABS = Object.freeze([
  { value: 'overview', label: 'Overview' },
  { value: 'config', label: 'Config' },
  { value: 'functions', label: 'Functions' },
  { value: 'resources', label: 'Resources' },
  { value: 'files', label: 'Files' },
] satisfies readonly Readonly<{ value: TTab; label: string }>[]);

function editableIcon(value: TOmnidrawToolIcon | null | undefined): TOmnidrawToolIcon | null {
  return value?.svgIcon !== undefined
    ? { svgIcon: value.svgIcon }
    : value?.lucidIcon !== undefined
      ? { lucidIcon: value.lucidIcon }
      : null;
}

function iconsEqual(
  left: TOmnidrawToolIcon | null,
  right: TOmnidrawToolIcon | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.lucidIcon === right.lucidIcon && left.svgIcon === right.svgIcon;
}

export const WidgetDetailPage: Component<TWidgetDetailPageProps> = (props) => {
  const application = untrack(() => props.controller.application);
  const catalogState = useWidgetCatalog();
  const [files, setFiles] = createSignal<readonly TWidgetPublicFileEntry[] | null>(null);
  const [filesTruncated, setFilesTruncated] = createSignal(false);
  const [filesError, setFilesError] = createSignal('');
  const [preview, setPreview] = createSignal<TWidgetPublicFilePreview | null>(null);
  const [previewError, setPreviewError] = createSignal('');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [label, setLabel] = createSignal('');
  const [group, setGroup] = createSignal('');
  const [priority, setPriority] = createSignal('0');
  const [icon, setIcon] = createSignal<TOmnidrawToolIcon | null>(null);
  const [action, setAction] = createSignal<'save' | 'published-icon' | 'metadata' | 'build' | null>(null);
  const [actionError, setActionError] = createSignal('');
  const [publishedIconReconciliation, setPublishedIconReconciliation] =
    createSignal<TWidgetPublicMutationResult | null>(null);
  const [deletionPlan, setDeletionPlan] = createSignal<TWidgetPublicDeletionPlan | null>(null);
  const [deletionOperationId, setDeletionOperationId] = createSignal<string | null>(null);
  const [deletionOpen, setDeletionOpen] = createSignal(false);
  const [deletionPhase, setDeletionPhase] = createSignal<'planning' | 'committing' | null>(null);
  const [deletionError, setDeletionError] = createSignal('');
  const [deletionReviewError, setDeletionReviewError] = createSignal('');
  let deleteTrigger: HTMLButtonElement | undefined;
  let deleteCancel: HTMLButtonElement | undefined;
  let deletionContent: HTMLDivElement | undefined;
  const tabsId = createUniqueId();
  const deletionTitleId = createUniqueId();
  const deletionDescriptionId = createUniqueId();
  let fileListRequest = 0;
  let previewRequest = 0;
  let actionInFlight = false;
  let deletionInFlight: 'planning' | 'committing' | null = null;
  let deletionPlanGeneration = 0;
  let disposed = false;

  const entry = createMemo(() => (
    catalogState.catalog()?.entries.find((candidate) => candidate.widgetKey === props.name) ?? null
  ));
  const form = createMemo(() => {
    const selected = entry();
    if (props.source === 'draft') return selected?.draft ?? null;
    if (props.source === 'published') return selected?.published ?? null;
    return null;
  });
  const selectedPath = () => props.query.path() ?? '';
  const activeTab = (): TTab => {
    const requested = props.query.tab();
    return TABS.some((tab) => tab.value === requested) ? requested as TTab : 'overview';
  };

  createEffect(
    () => ({ source: props.source, name: props.name }),
    () => {
      deletionPlanGeneration += 1;
      deletionInFlight = null;
      setDeletionPhase(null);
      setDeletionPlan(null);
      setDeletionOperationId(null);
      setDeletionOpen(false);
      setDeletionError('');
      setDeletionReviewError('');
    },
  );

  onCleanup(() => {
    disposed = true;
    deletionPlanGeneration += 1;
    deletionInFlight = null;
  });

  const deletionRequestIsCurrent = (
    generation: number,
    source: TWidgetSource,
    widgetKey: string,
  ) => (
    !disposed
    && generation === deletionPlanGeneration
    && props.source === source
    && props.name === widgetKey
  );

  createEffect(
    () => form()?.config ?? null,
    (config) => {
      fileListRequest += 1;
      previewRequest += 1;
      setFiles(null);
      setPreview(null);
      setActionError('');
      setPublishedIconReconciliation(null);
      setDeletionPlan(null);
      setDeletionOperationId(null);
      setDeletionOpen(false);
      setDeletionError('');
      setDeletionReviewError('');
      if (config === null) return;
      setName(config.name);
      setDescription(config.description);
      setLabel(config.tool.label);
      setGroup(config.tool.group ?? '');
      setPriority(String(config.tool.priority));
      setIcon(editableIcon(config.tool.icon));
    },
  );

  const loadFiles = async (identity: Readonly<{ source: TWidgetSource; name: string }>) => {
    const request = ++fileListRequest;
    setFilesError('');
    const [loadError, value] = await props.controller.apiService.api.widget.catalog.files.list({
      widgetKey: identity.name,
      source: identity.source,
    });
    if (request !== fileListRequest) return;
    if (loadError || !value) {
      setFiles(null);
      setFilesError(loadError?.message ?? "Widget files are unavailable.");
      return;
    }
    setFiles(value.entries);
    setFilesTruncated(value.truncated);
  };

  const loadPreview = async (identity: Readonly<{
    source: TWidgetSource;
    name: string;
    path: string;
  }> | null) => {
    if (identity === null) {
      setPreview(null);
      return;
    }
    const request = ++previewRequest;
    setPreview(null);
    setPreviewError('');
    const [loadError, value] = await props.controller.apiService.api.widget.catalog.files.read({
      widgetKey: identity.name,
      source: identity.source,
      path: identity.path,
    });
    if (request !== previewRequest) return;
    if (loadError || !value) {
      setPreviewError(loadError?.message ?? "The widget file preview is unavailable.");
      return;
    }
    setPreview(value);
  };

  createEffect(
    () => activeTab() === 'files' && files() === null && props.source !== null && props.name !== null
      ? { source: props.source, name: props.name }
      : null,
    (identity) => {
      if (identity !== null) void loadFiles(identity);
    },
  );
  createEffect(
    () => activeTab() === 'files' && props.source !== null && props.name !== null && selectedPath()
      ? { source: props.source, name: props.name, path: selectedPath() }
      : null,
    (identity) => void loadPreview(identity),
  );

  const selectTab = (value: string) => {
    const tab = TABS.find((candidate) => candidate.value === value)?.value ?? 'overview';
    props.query.set(tab === 'files'
      ? { tab, path: selectedPath() || undefined }
      : { tab, path: undefined });
  };

  const tabId = (tab: TTab) => `${tabsId}-${tab}-tab`;
  const tabPanelId = (tab: TTab) => `${tabsId}-${tab}-panel`;
  const handleTabKeyDown = (event: KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex]!;
    selectTab(nextTab.value);
    document.getElementById(tabId(nextTab.value))?.focus();
  };

  const publishedIconSafetyError = createMemo(() => (
    props.source === 'published' ? publishedWidgetIconSafetyError(icon()) : null
  ));
  const iconError = createMemo(() => (
    toolIconValidationError(icon()) ?? publishedIconSafetyError()
  ));
  const publishedIconDirty = createMemo(() => (
    props.source === 'published'
    && !iconsEqual(icon(), editableIcon(form()?.config?.tool.icon))
  ));

  const configInput = () => ({
    name: name().trim(),
    description: description().trim(),
    tool: {
      label: label().trim(),
      icon: icon(),
      group: group().trim() || null,
      priority: Number(priority()),
    },
  });

  const saveConfig = async () => {
    const selected = form();
    if (
      actionInFlight
      || props.source !== 'draft'
      || !props.name
      || !selected?.manifestDigestSha256
      || iconError() !== null
    ) return;
    actionInFlight = true;
    setAction('save');
    setActionError('');
    const [saveError] = await props.controller.apiService.api.widget.config.saveDraft({
      widgetKey: props.name,
      expectedManifestDigestSha256: selected.manifestDigestSha256,
      config: configInput(),
    });
    actionInFlight = false;
    setAction(null);
    if (saveError) {
      setActionError(saveError.message);
      application.notifyError('Could not save widget Config', saveError.message);
      return;
    }
    await catalogState.refresh();
    application.notifySuccess('Widget draft Config saved');
  };

  const savePublishedIcon = async () => {
    const pendingReconciliation = publishedIconReconciliation();
    const catalog = catalogState.catalog();
    const selected = form();
    if (
      actionInFlight
      || props.source !== 'published'
      || !props.name
      || (!pendingReconciliation && (
        !catalog
        || !selected?.manifestDigestSha256
        || !publishedIconDirty()
        || iconError() !== null
      ))
    ) return;
    actionInFlight = true;
    setAction('published-icon');
    setActionError('');

    let mutation = pendingReconciliation;
    if (mutation === null) {
      const [saveError, value] = await props.controller.apiService.api.widget.publication.updateIcon({
        widgetKey: props.name,
        expectedPublishedManifestDigestSha256: selected!.manifestDigestSha256!,
        expectedCatalogDigestSha256: catalog!.catalogDigestSha256,
        icon: icon(),
      });
      if (saveError || !value) {
        actionInFlight = false;
        setAction(null);
        const message = saveError?.message ?? 'The icon update returned no catalog identity.';
        setActionError(message);
        application.notifyError('Could not save published widget icon', message);
        return;
      }
      mutation = value;
      setPublishedIconReconciliation(mutation);
    }

    const refreshSucceeded = await catalogState.refresh();
    const refreshed = refreshSucceeded ? catalogState.catalog() : null;
    const reconciled = refreshed !== null && (
      refreshed.generation > mutation.generation
      || (
        refreshed.generation === mutation.generation
        && refreshed.catalogDigestSha256 === mutation.catalogDigestSha256
      )
    );
    actionInFlight = false;
    setAction(null);
    if (!reconciled) {
      const message = catalogState.error()
        ? `The icon was saved, but the refreshed catalog is unavailable: ${catalogState.error()}`
        : 'The icon was saved, but the refreshed catalog has not observed it yet.';
      setActionError(`${message} Retry refresh to reconcile the page.`);
      application.notifyError('Published widget icon needs refresh', message);
      return;
    }
    setPublishedIconReconciliation(null);
    application.notifySuccess('Published widget icon saved');
  };

  const publish = async (kind: 'metadata' | 'build') => {
    const catalog = catalogState.catalog();
    const selected = form();
    if (
      actionInFlight
      || props.source !== 'draft'
      || !props.name
      || !catalog
      || !selected?.manifestDigestSha256
    ) return;
    actionInFlight = true;
    setAction(kind);
    setActionError('');
    const input = {
      widgetKey: props.name,
      expectedManifestDigestSha256: selected.manifestDigestSha256,
      expectedCatalogDigestSha256: catalog.catalogDigestSha256,
    };
    const [publishError] = kind === 'metadata'
      ? await props.controller.apiService.api.widget.publication.publishMetadata(input)
      : await props.controller.apiService.api.widget.publication.buildAndPublish(input);
    actionInFlight = false;
    setAction(null);
    if (publishError) {
      setActionError(publishError.message);
      application.notifyError(
        kind === 'metadata' ? 'Could not publish metadata' : 'Could not build and publish',
        publishError.message,
      );
      return;
    }
    await catalogState.refresh();
    application.notifySuccess(
      kind === 'metadata' ? 'Widget metadata published' : 'Widget built and published',
      kind === 'build'
        ? 'Existing draft frames remain Previews; add the published widget separately to place the publication.'
        : undefined,
    );
  };

  const restoreDeleteFocus = () => {
    props.controller.browser.setTimeout(() => deleteTrigger?.focus(), 0);
  };

  const planDeletion = async () => {
    const source = props.source;
    const widgetKey = props.name;
    if (deletionInFlight !== null || source === null || widgetKey === null) return;
    const generation = ++deletionPlanGeneration;
    deletionInFlight = 'planning';
    setDeletionPhase('planning');
    setDeletionError('');
    setDeletionReviewError('');
    const [planError, plan] = await props.controller.apiService.api.widget.deletion.plan({
      widgetKey,
      source,
    });
    if (!deletionRequestIsCurrent(generation, source, widgetKey)) return;
    deletionInFlight = null;
    setDeletionPhase(null);
    if (planError || !plan) {
      const message = planError?.message ?? 'The deletion consequences could not be resolved.';
      setDeletionError(message);
      application.notifyError('Could not plan widget deletion', message);
      restoreDeleteFocus();
      return;
    }
    setDeletionPlan(plan);
    setDeletionOperationId(props.controller.browser.createIdempotencyKey());
    setDeletionOpen(true);
  };

  const closeDeletion = () => {
    if (deletionInFlight !== null) return;
    deletionPlanGeneration += 1;
    setDeletionOpen(false);
    setDeletionPlan(null);
    setDeletionOperationId(null);
    setDeletionError('');
    restoreDeleteFocus();
  };

  const commitDeletion = async () => {
    const plan = deletionPlan();
    const operationId = deletionOperationId();
    const source = props.source;
    const widgetKey = props.name;
    if (
      deletionInFlight !== null
      || plan === null
      || operationId === null
      || source === null
      || widgetKey === null
      || plan.source !== source
      || plan.widgetKey !== widgetKey
    ) return;
    const generation = deletionPlanGeneration;
    deletionInFlight = 'committing';
    setDeletionPhase('committing');
    setDeletionError('');
    const [deleteError] = await props.controller.apiService.api.widget.deletion.commit({
      planToken: plan.planToken,
      operationId,
    });
    if (!deletionRequestIsCurrent(generation, source, widgetKey)) return;
    deletionInFlight = null;
    setDeletionPhase(null);
    if (deleteError) {
      const stale = deleteError.code === 'WIDGET_DELETION_STALE_PLAN';
      const message = stale
        ? 'The widget changed after you reviewed deletion. Review the current consequences and confirm again.'
        : deleteError.message;
      setDeletionError(message);
      application.notifyError('Could not delete widget', message);
      if (stale) {
        setDeletionOpen(false);
        setDeletionPlan(null);
        setDeletionOperationId(null);
        setDeletionReviewError(message);
        restoreDeleteFocus();
      }
      return;
    }
    props.controller.invalidation.invalidate('widgets');
    application.notifySuccess(
      plan.source === 'draft' ? 'Widget draft deleted' : 'Widget publication deleted',
    );
    application.navigate('/', { replace: true });
  };

  const deletionDescription = createMemo(() => {
    const plan = deletionPlan();
    if (plan === null) return '';
    if (plan.source === 'draft') {
      return `Delete the exact draft “${plan.widgetKey}”? This removes ${plan.previewPlacementCount} Preview frame${plan.previewPlacementCount === 1 ? '' : 's'}, its accepted Preview/build state, and ${plan.chatMountCount} AI Chat mount${plan.chatMountCount === 1 ? '' : 's'}. The publication and every placed published instance remain. Independent resources remain.`;
    }
    return `Delete the publication “${plan.widgetKey}”? This removes the publication${plan.pairedDraftPresent ? ', its same-key draft and derived Preview/build state' : ''}, ${plan.placementCount} Canvas placement${plan.placementCount === 1 ? '' : 's'}, and ${plan.chatMountCount} AI Chat mount${plan.chatMountCount === 1 ? '' : 's'}. Independent resources remain.`;
  });

  createEffect(
    () => deletionOpen(),
    (open) => {
      if (!open) return;
      return activateModalFocusScope({
        content: () => deletionContent,
        escapeDisabled: () => deletionInFlight === 'committing',
        initialFocus: () => deleteCancel,
        onEscape: closeDeletion,
        ownerDocument: deletionContent?.ownerDocument ?? document,
        returnFocus: () => deleteTrigger,
      });
    },
  );

  const configDirty = createMemo(() => {
    const persisted = form()?.config;
    return props.source === 'draft'
      && persisted !== null
      && persisted !== undefined
      && JSON.stringify(configInput()) !== JSON.stringify({
        name: persisted.name,
        description: persisted.description,
        tool: persisted.tool,
      });
  });

  const metadataUnavailableReason = createMemo(() => {
    if (configDirty()) return 'Save the draft Config before publishing.';
    if (form()?.health !== 'healthy' || entry()?.published?.health !== 'healthy') {
      return 'Metadata publication requires healthy draft and published folders.';
    }
    if (entry()?.differences.executableManifest !== 'same') {
      return 'Executable Config differs; use Build and Publish.';
    }
    if (entry()?.differences.presentation !== 'different') {
      return 'Published Config already matches the draft.';
    }
    return null;
  });
  const metadataAvailable = createMemo(() => (
    props.source === 'draft' && metadataUnavailableReason() === null
  ));

  return <Show
    when={!catalogState.loading() && entry() && form()}
    fallback={<div class={styles.routeState} role="status">
      <p>{catalogState.error() || 'Widget source was not found.'}</p>
    </div>}
  >
    <>
    <div class={styles.page}>
      <header class={styles.header}>
        <div class={styles.titleBlock}>
          <WidgetIcon icon={form()!.config?.tool.icon ?? null} class={styles.headerIcon} />
          <div>
            <p class={styles.eyebrow}>{props.source === 'published' ? 'Published widget' : 'Widget draft'}</p>
            <h2>{form()!.config?.name ?? props.name}</h2>
          </div>
        </div>
        <div class={styles.headerActions}>
          <Show when={props.source === 'draft'}>
            <button
              type="button"
              class={`${styles.button} ${styles.saveButton}`}
              disabled={action() !== null || !configDirty() || iconError() !== null}
              onClick={() => void saveConfig()}
            >{action() === 'save' ? 'Saving draft…' : 'Save draft'}</button>
            <button
              type="button"
              class={styles.button}
              disabled={!metadataAvailable() || action() !== null}
              title={metadataAvailable()
                ? 'Publish presentation Config without rebuilding executable files.'
                : metadataUnavailableReason() ?? undefined}
              onClick={() => void publish('metadata')}
            >{action() === 'metadata' ? 'Publishing metadata…' : 'Publish metadata'}</button>
            <button
              type="button"
              class={`${styles.button} ${styles.primary}`}
              disabled={action() !== null || form()!.health !== 'healthy' || configDirty()}
              title={configDirty() ? 'Save the draft Config before building.' : undefined}
              onClick={() => void publish('build')}
            >{action() === 'build' ? 'Building and publishing…' : 'Build and Publish'}</button>
          </Show>
          <button
            type="button"
            class={`${styles.button} ${styles.iconButton}`}
            aria-label="Toggle sidebar"
            onClick={application.toggleSidebar}
          ><PanelLeft size={15} /></button>
        </div>
      </header>
      <Show when={actionError()}>{(message) => (
        <p class={styles.validationError} role="alert">{message()}</p>
      )}</Show>
      <div class={styles.tabs} role="tablist">
        <For each={TABS}>{(tab, index) => (
          <button
            type="button"
            id={tabId(tab.value)}
            class={styles.tab}
            role="tab"
            aria-selected={activeTab() === tab.value ? 'true' : 'false'}
            aria-controls={tabPanelId(tab.value)}
            tabindex={activeTab() === tab.value ? 0 : -1}
            data-selected={activeTab() === tab.value ? '' : undefined}
            onClick={() => selectTab(tab.value)}
            onKeyDown={(event) => handleTabKeyDown(event, index())}
          >{tab.label}</button>
        )}</For>
      </div>

      <Show when={activeTab() === 'overview'}><div id={tabPanelId('overview')} class={styles.content} role="tabpanel" aria-labelledby={tabId('overview')} tabindex="0"><div class={styles.contentInner}>
        <section class={styles.panel}>
          <h3>Filesystem catalog</h3>
          <dl class={styles.definitionList}>
            <dt>Widget key</dt><dd>{entry()!.widgetKey}</dd>
            <dt>Source</dt><dd>{props.source}</dd>
            <dt>Health</dt><dd class={form()!.health === 'healthy' ? styles.healthy : styles.problem}>{form()!.health}</dd>
            <dt>Draft and publication</dt><dd>{entry()!.differences.status}</dd>
            <dt>Presentation</dt><dd>{entry()!.differences.presentation}</dd>
            <dt>Executable Config</dt><dd>{entry()!.differences.executableManifest}</dd>
            <dt>Files</dt><dd>{form()!.fileCount}</dd>
          </dl>
        </section>
        <section class={styles.panel}>
          <h3>Presentation</h3>
          <p>{form()!.config?.description ?? 'Structured Config is unavailable.'}</p>
          <dl class={styles.definitionList}>
            <dt>Tool label</dt><dd>{form()!.config?.tool.label ?? '—'}</dd>
            <dt>Group</dt><dd>{form()!.config?.tool.group ?? 'Ungrouped'}</dd>
            <dt>Priority</dt><dd>{form()!.config?.tool.priority ?? '—'}</dd>
          </dl>
        </section>
        <For each={form()!.issues}>{(issue) => <section class={styles.problemPanel}>
          <h3>{issue.code}</h3><p>{issue.message}</p>
        </section>}</For>
        <section class={`${styles.panel} ${styles.dangerPanel}`}>
          <div>
            <h3>Danger zone</h3>
            <p class={styles.muted}>{props.source === 'draft'
              ? 'Delete this exact draft without deleting its publication or placed published instances.'
              : 'Delete this publication, its same-key draft when present, and every Canvas placement.'}</p>
          </div>
          <button
            type="button"
            ref={deleteTrigger}
            class={`${styles.button} ${styles.dangerButton}`}
            disabled={deletionPhase() !== null}
            onClick={() => void planDeletion()}
          >{deletionPhase() === 'planning' ? 'Reviewing deletion…' : 'Delete widget'}</button>
        </section>
        <Show when={!deletionOpen() ? deletionReviewError() || deletionError() : ''}>{(message) => (
          <p class={styles.validationError} role="alert">{message()}</p>
        )}</Show>
      </div></div></Show>

      <Show when={activeTab() === 'config'}><div id={tabPanelId('config')} class={styles.content} role="tabpanel" aria-labelledby={tabId('config')} tabindex="0"><div class={styles.contentInner}>
        <section class={styles.panel}>
          <h3>Widget Config</h3>
          <Show when={form()!.config} fallback={<p class={styles.validationError}>Repair omnidraw.json in the Files workspace before editing structured Config.</p>}>
            <Show when={props.source === 'draft'} fallback={<>
              <p class={styles.muted}>Published Config is read-only except for its icon. Saving the icon replaces metadata only and does not rebuild executable files.</p>
              <div class={styles.publishedIconEditor}>
                <ToolIconPicker value={icon()} onChange={setIcon} />
                <Show when={publishedIconSafetyError()}>{(message) => (
                  <p class={styles.validationError} role="alert">{message()}</p>
                )}</Show>
                <div class={styles.publishedIconActions}>
                  <button
                    type="button"
                    class={`${styles.button} ${styles.saveButton}`}
                    disabled={action() !== null || (
                      publishedIconReconciliation() === null
                      && (!publishedIconDirty() || iconError() !== null)
                    )}
                    onClick={() => void savePublishedIcon()}
                  >{action() === 'published-icon'
                      ? publishedIconReconciliation() === null ? 'Saving icon…' : 'Refreshing icon…'
                      : publishedIconReconciliation() === null ? 'Save icon' : 'Retry refresh'}</button>
                </div>
              </div>
              <pre class={styles.code}>{JSON.stringify(form()!.config, null, 2)}</pre>
            </>}>
              <div class={styles.formGrid}>
                <label>Name<input class={styles.input} value={name()} maxlength={200} onInput={(event) => setName(event.currentTarget.value)} /></label>
                <label>Tool label<input class={styles.input} value={label()} maxlength={120} onInput={(event) => setLabel(event.currentTarget.value)} /></label>
                <label class={styles.fullField}>Description<textarea class={`${styles.input} ${styles.textarea}`} value={description()} maxlength={2000} onInput={(event) => setDescription(event.currentTarget.value)} /></label>
                <label>Group<input class={styles.input} value={group()} maxlength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="utilities" onInput={(event) => setGroup(event.currentTarget.value)} /></label>
                <label>Priority<input class={styles.input} type="number" min="-1000" max="1000" step="1" value={priority()} onInput={(event) => setPriority(event.currentTarget.value)} /></label>
                <div><ToolIconPicker value={icon()} onChange={setIcon} /></div>
              </div>
            </Show>
          </Show>
        </section>
      </div></div></Show>

      <Show when={activeTab() === 'functions'}><div id={tabPanelId('functions')} class={styles.content} role="tabpanel" aria-labelledby={tabId('functions')} tabindex="0"><div class={styles.contentInner}>
        <section class={styles.panel}><h3>Browser-safe function descriptors</h3>
          <For each={form()!.functions} fallback={<p class={styles.muted}>This source exposes no published browser-safe functions.</p>}>
            {(descriptor) => <article class={styles.inspectorCard}>
              <div class={styles.inspectorCardHeader}><code>{descriptor.exportName}</code><span class={styles.badge}>{descriptor.effect}</span></div>
              <dl class={styles.definitionList}>
                <dt>Resources</dt><dd>{descriptor.resources.map((resource) => `${resource.slot} (${resource.effect})`).join(', ') || 'None'}</dd>
                <dt>Timeout</dt><dd>{descriptor.limits.timeoutMs} ms</dd>
                <dt>Memory</dt><dd>{descriptor.limits.memoryTier}</dd>
                <dt>Output limit</dt><dd>{descriptor.limits.outputByteLimit} bytes</dd>
                <dt>Log limit</dt><dd>{descriptor.limits.logByteLimit} bytes</dd>
              </dl>
            </article>}
          </For>
        </section>
      </div></div></Show>

      <Show when={activeTab() === 'resources'}><div id={tabPanelId('resources')} class={styles.content} role="tabpanel" aria-labelledby={tabId('resources')} tabindex="0"><div class={styles.contentInner}>
        <section class={styles.panel}><h3>Portable resource requirements</h3>
          <For each={form()!.resources} fallback={<p class={styles.muted}>This widget declares no resource requirements.</p>}>
            {(requirement) => <article class={styles.inspectorCard}>
              <div class={styles.inspectorCardHeader}><code>{requirement.slot}</code><span class={styles.badge}>{requirement.kind}</span></div>
              <dl class={styles.definitionList}>
                <dt>Effect ceiling</dt><dd>{requirement.effect}</dd>
                <dt>Required</dt><dd>{requirement.required ? 'Yes' : 'No'}</dd>
              </dl>
            </article>}
          </For>
        </section>
      </div></div></Show>

      <Show when={activeTab() === 'files'}><div id={tabPanelId('files')} class={`${styles.content} ${styles.filesContent}`} role="tabpanel" aria-labelledby={tabId('files')} tabindex="0">
        <div class={styles.fileWorkbench}>
          <aside class={styles.fileTree} aria-label="Widget files">
            <Show when={filesError()}>{(message) => <p class={styles.validationError} role="alert">{message()}</p>}</Show>
            <Show when={filesTruncated()}><p class={styles.validationWarning}>The bounded file list was truncated.</p></Show>
            <For each={files()} fallback={<p class={styles.muted}>Loading files…</p>}>
              {(file) => file.kind === 'directory'
                ? <div class={styles.directory} style={{ 'padding-left': `${file.path.split('/').length * .75}rem` }}><Folder size={12} /> {file.path.split('/').at(-1)}</div>
                : <button type="button" class={`${styles.fileRow} ${selectedPath() === file.path ? styles.fileSelected : ''}`} style={{ 'padding-left': `${file.path.split('/').length * .75}rem` }} onClick={() => props.query.set({ tab: 'files', path: file.path })}><File size={12} /><span>{file.path.split('/').at(-1)}</span><small>{file.byteSize} B</small></button>}
            </For>
          </aside>
          <section class={styles.preview}>
            <Show when={previewError()}>{(message) => <p class={styles.validationError} role="alert">{message()}</p>}</Show>
            <Show when={preview()} fallback={<p class={styles.muted}>Select a file to inspect it.</p>}>
              {(file) => <><div class={styles.previewHeader}><strong>{file().path}</strong><span>{file().byteSize} bytes{file().truncated ? ' · preview omitted by limit' : ''}</span></div>{file().binary ? <p class={styles.muted}>Binary file. Content preview is unavailable.</p> : file().text === null ? <p class={styles.muted}>Content preview is unavailable.</p> : <pre class={styles.code}>{file().text}</pre>}</>}
            </Show>
          </section>
        </div>
      </div></Show>
    </div>
    <Show when={deletionOpen()}>
      <Portal>
        <div
          class={styles.dialogOverlay}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && deletionPhase() !== 'committing') closeDeletion();
          }}
        />
        <div
          ref={(element) => { deletionContent = element; }}
          class={styles.dialogContent}
          role="alertdialog"
          aria-modal="true"
          tabindex="-1"
          aria-labelledby={deletionTitleId}
          aria-describedby={deletionDescriptionId}
        >
          <h2 id={deletionTitleId} class={styles.dialogTitle}>Delete {deletionPlan()?.source === 'draft' ? 'widget draft' : 'widget publication'}</h2>
          <p id={deletionDescriptionId} class={styles.dialogDescription}>
            {deletionDescription()}
          </p>
          <Show when={deletionError()}>{(message) => (
            <p class={styles.validationError} role="alert">{message()}</p>
          )}</Show>
          <div class={styles.dialogActions}>
            <button
              type="button"
              ref={(element) => { deleteCancel = element; }}
              class={styles.button}
              disabled={deletionPhase() === 'committing'}
              onClick={closeDeletion}
            >Cancel</button>
            <button
              type="button"
              class={`${styles.button} ${styles.dangerButton}`}
              disabled={deletionPhase() === 'committing'}
              onClick={() => void commitDeletion()}
            >{deletionPhase() === 'committing' ? 'Deleting…' : 'Delete permanently'}</button>
          </div>
        </div>
      </Portal>
    </Show>
    </>
  </Show>;
};
