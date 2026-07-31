import type { CapsuleMountDiagnostics, CapsuleViewport } from '@omnidraw/capsule-omnidraw/host';
import type { TWidgetCapsuleProps } from '@omnidraw/widget-contract';
import type {
  TAiChatApiPort,
  TWidgetBrowserPort,
} from '../ports';
import { TraceMap } from '@jridgewell/trace-mapping';
import { fxDecodeAndVerifyUiArtifact } from '../widget-runtime/fx.decode-and-verify-ui-artifact';
import {
  fxDecodeAndVerifySourceMapArtifact,
} from '../widget-runtime/fx.decode-and-verify-source-map-artifact';
import type {
  TWidgetPreviewRuntimeIdentity,
  TWidgetRuntimeIdentity,
  TWidgetRuntimeTransportPort,
  TWidgetUiArtifactMountPort,
  TWidgetUiRuntimePreloadedRenderOwner,
} from '../widget-runtime/interface';
import type { WidgetUiRuntime } from '../widget-runtime/WidgetUiRuntime';
import { createWidgetFunctionHostBridge } from '../widget-runtime/create-widget-function-host-bridge';
import { PREVIEW_LOG_MAX_ENTRIES } from './CONSTANTS';
import {
  createEphemeralPreviewStateOwner,
  type TEphemeralPreviewStateOwner,
} from './create-ephemeral-preview-state';
import { fnNormalizePreviewDiagnostic } from './fn.preview-diagnostic';
import {
  fnProjectPreviewLogEntry,
  fnRetainPreviewLogEntries,
  type TPreviewLogEntry,
  type TPreviewLogEvent,
  type TPreviewLogSelection,
} from './fn.preview-log';
import { fnPreviewGuestViewport } from './fn.preview-viewport';
import type { TPreviewWidgetPayload } from './fn.canvas-widget';

const PREVIEW_MOUNT_LEASE_RENEW_MAX_DELAY_MS = 30_000;

type TPreviewMountLeaseDescriptor = NonNullable<
  Awaited<
    ReturnType<
      TAiChatApiPort['api']['agent']['widgetPreview']['mount']['acquire']
    >
  >[1]
>;

type TPreviewMountLeaseState = {
  acquireAttempted: boolean;
  acquireOperation?: Promise<void>;
  descriptor?: TPreviewMountLeaseDescriptor;
  leaseId: string;
  releaseOperation?: Promise<void>;
  renewOperation?: Promise<void>;
  renewTimer?: unknown;
  stopped: boolean;
};

type TMountedPreview = {
  active: boolean;
  bindingPlanDigestSha256: string;
  bindingRevision: number;
  buildSequence: number;
  committedMutationId: string;
  container: HTMLDivElement;
  destroyOperation?: Promise<void>;
  handle?: TWidgetUiRuntimePreloadedRenderOwner;
  lease: TPreviewMountLeaseState;
  mountOperation?: Promise<TWidgetUiRuntimePreloadedRenderOwner>;
  previewId: string;
  previewRevisionId: string;
  refreshSequence: number;
  revision: string;
  runtimeFailureObserved: boolean;
};

type TPreviewDiagnosticScope = Readonly<{
  previewId: string;
  previewRevisionId: string;
  draftRevision: string;
  buildSequence: number;
  committedMutationId: string;
}>;

type TPublishedPreviewSelection = Readonly<{
  bindingPlanDigestSha256: string;
  bindingRevision: number;
  previewId: string;
  previewRevisionId: string;
}>;

export type TPreviewPublicationSelection = Readonly<{
  draftId: string;
  expectedRevision: string;
  previewId: string;
  previewRevisionId: string;
  expectedBindingRevision: number;
  expectedBindingPlanDigestSha256: string;
  canvasId: string;
  frameNodeId: string;
  buildSequence: number;
}>;

export type TPreviewPendingBuild = Readonly<{
  previewId: string;
  revision: string;
  sourceDigestSha256: string;
  committedMutationId: string;
  buildId: string;
  buildSequence: number;
}>;

export type TPreviewDraftFence = Readonly<{
  draftId: string;
  revision: string;
  sourceDigestSha256: string;
  committedMutationId: string;
  buildSequence: number;
}>;

export type TPreviewPortalControlState = Readonly<{
  liveUpdatesPaused: boolean;
  automaticRefreshPending: boolean;
  pendingBuild: TPreviewPendingBuild | null;
  publishable: boolean;
}>;

type TPreviewOwner = NonNullable<
  Awaited<
    ReturnType<
      TAiChatApiPort['api']['agent']['widgetPreview']['owner']['ensure']
    >
  >[1]
>;

export type TPreviewPortalRuntime = Readonly<{
  refresh(): Promise<void>;
  autoRefresh(): Promise<void>;
  pauseLiveUpdates(): void;
  resumeLiveUpdates(): Promise<void>;
  cancelBuild(): Promise<boolean>;
  controlState(): TPreviewPortalControlState;
  reset(): Promise<void>;
  publish(
    expectedSelection?: TPreviewPublicationSelection,
    idempotencyKey?: string,
  ): Promise<boolean>;
  publicationSelection(): TPreviewPublicationSelection | null;
  reportOwnerState(owner: TPreviewOwner): void;
  invalidateDraftFence(): void;
  reportDraftFence(fence: TPreviewDraftFence): void;
  reportProgress(progress: Readonly<{
    previewId: string;
    revision: string;
    sourceDigestSha256: string;
    committedMutationId: string;
    buildId: string;
    buildSequence: number;
    phase:
      | 'queued'
      | 'installing'
      | 'building'
      | 'validating'
      | 'ready'
      | 'failed'
      | 'superseded';
  }>): void;
  currentRevision(): string | null;
  setProps(value: TWidgetCapsuleProps): void;
  setViewport(value: CapsuleViewport): void;
  setFocused(focused: boolean, options?: FocusOptions): void;
  freeze(reason?: string): Promise<void>;
  resume(reason?: string): Promise<void>;
  diagnostics(): CapsuleMountDiagnostics | null;
  destroy(reason?: string): Promise<void>;
}>;

export type TCreatePreviewPortalRuntimeArgs = Readonly<{
  root: HTMLDivElement;
  payload: TPreviewWidgetPayload;
  canvasId: string;
  frameNodeId: string;
  api: Pick<
    TAiChatApiPort['api']['agent']['widgetPreview'],
    'build' | 'cancel' | 'diagnostics' | 'mount' | 'owner'
  >;
  publishApi: Pick<TAiChatApiPort['api']['agent']['widgetPublish'], 'publish'>;
  codec: Pick<TWidgetBrowserPort, 'decodeBase64' | 'digestSha256'>;
  mount: TWidgetUiArtifactMountPort;
  runtime: Pick<WidgetUiRuntime, 'renderPreloadedOwned'>;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  nowMs(): number;
  functions: Readonly<{
    transport: TWidgetRuntimeTransportPort;
    organizationId(): string;
    createIdempotencyKey(): string;
    createLeaseId(): string;
    scheduleTimeout(callback: () => void, timeoutMs: number): unknown;
    cancelTimeout(timer: unknown): void;
    wait(timeoutMs: number, signal?: AbortSignal): Promise<void>;
    isTargetCurrent(identity: TWidgetRuntimeIdentity): boolean;
  }>;
  onControlStateChange?(state: TPreviewPortalControlState): void;
  onError(error: unknown): void;
}>;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (
    error !== null
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
    && error.message.trim().length > 0
  ) {
    return error.message.trim();
  }
  return fallback;
}

export function createPreviewPortalRuntime(
  args: TCreatePreviewPortalRuntimeArgs,
): TPreviewPortalRuntime {
  const dom = args.root.ownerDocument;
  const shell = dom.createElement('section');
  const layers = dom.createElement('div');
  const status = dom.createElement('div');
  const statusMessage = dom.createElement('span');
  const terminal = dom.createElement('aside');
  const terminalHeader = dom.createElement('div');
  const terminalTitle = dom.createElement('strong');
  const terminalViewport = dom.createElement('div');
  const terminalList = dom.createElement('div');
  const clearLogButton = dom.createElement('button');
  const diagnosticStatus = dom.createElement('span');
  const diagnosticStatusMessage = dom.createElement('span');
  const resolveDiagnosticButton = dom.createElement('button');
  let disposed = false;
  let destroyOperation: Promise<void> | undefined;
  let sequence = 0;
  let current: TMountedPreview | null = null;
  let viewport: CapsuleViewport | null = null;
  let props: TWidgetCapsuleProps = {};
  let focused = false;
  let focusOptions: FocusOptions | undefined;
  let frozen = false;
  let publishSelectionValid = false;
  let latestBuildSequence = 0;
  let latestDraftFence: TPreviewDraftFence | null = null;
  let draftFenceReconciliationRequired = false;
  let liveUpdatesPaused = false;
  let automaticRefreshPending = false;
  let pendingBuild: TPreviewPendingBuild | null = null;
  let publishedSelection: TPublishedPreviewSelection | null = null;
  let runtimeDiagnostics: TPreviewOwner['runtimeDiagnostics'] = [];
  let previewLogEntries: readonly TPreviewLogEntry[] = [];
  let previewLogSequence = 0;
  let stateOwner = createEphemeralPreviewStateOwner();
  let ownerPromise: Promise<TPreviewOwner> | null = null;
  const pending = new Set<TMountedPreview>();
  const pendingFrames = new Map<number, () => void>();
  const pendingDiagnostics = new Set<string>();
  const loggedDiagnostics = new Set<string>();
  const stateOwners = new Set<TEphemeralPreviewStateOwner>([stateOwner]);

  shell.dataset.previewStatus = 'idle';
  shell.setAttribute('aria-label', 'Widget Preview');
  shell.style.position = 'relative';
  shell.style.display = 'flex';
  shell.style.flexDirection = 'column';
  shell.style.width = '100%';
  shell.style.height = '100%';
  shell.style.overflow = 'hidden';
  layers.dataset.previewGuestContent = '';
  layers.style.position = 'relative';
  layers.style.flex = '1 1 auto';
  layers.style.minHeight = '0';
  layers.style.overflow = 'hidden';
  layers.style.isolation = 'isolate';
  status.style.position = 'absolute';
  status.style.width = '1px';
  status.style.height = '1px';
  status.style.overflow = 'hidden';
  status.style.clipPath = 'inset(50%)';
  status.style.whiteSpace = 'nowrap';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  statusMessage.dataset.previewStatusMessage = '';
  terminal.dataset.previewLogTerminal = '';
  terminal.setAttribute('aria-label', 'Preview logs');
  terminal.tabIndex = 0;
  terminal.style.position = 'relative';
  terminal.style.zIndex = '3';
  terminal.style.setProperty('display', 'flex', 'important');
  terminal.style.flex = '0 0 96px';
  terminal.style.flexDirection = 'column';
  terminal.style.minHeight = '72px';
  terminal.style.maxHeight = '38%';
  terminal.style.overflow = 'hidden';
  terminal.style.borderTop = '1px solid var(--border, #374151)';
  terminal.style.background = 'var(--preview-terminal-background, #111827)';
  terminal.style.color = 'var(--preview-terminal-foreground, #e5e7eb)';
  terminal.style.font = '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  terminalHeader.style.display = 'flex';
  terminalHeader.style.alignItems = 'center';
  terminalHeader.style.gap = '8px';
  terminalHeader.style.minHeight = '26px';
  terminalHeader.style.padding = '3px 8px';
  terminalHeader.style.borderBottom = '1px solid var(--border, #374151)';
  terminalTitle.textContent = 'Preview logs';
  terminalTitle.style.marginRight = 'auto';
  terminalTitle.style.fontWeight = '600';
  terminalViewport.dataset.previewLogViewport = '';
  terminalViewport.setAttribute('role', 'log');
  terminalViewport.setAttribute('aria-live', 'polite');
  terminalViewport.setAttribute('aria-relevant', 'additions');
  terminalViewport.tabIndex = 0;
  terminalViewport.style.flex = '1 1 auto';
  terminalViewport.style.minHeight = '0';
  terminalViewport.style.overflow = 'auto';
  terminalViewport.style.padding = '5px 8px 7px';
  terminalList.dataset.previewLogEntries = '';
  clearLogButton.type = 'button';
  clearLogButton.textContent = 'Clear';
  clearLogButton.setAttribute('aria-label', 'Clear Preview logs');
  clearLogButton.style.padding = '1px 5px';
  clearLogButton.style.border = '1px solid var(--border, #4b5563)';
  clearLogButton.style.borderRadius = '4px';
  clearLogButton.style.background = 'transparent';
  clearLogButton.style.color = 'inherit';
  clearLogButton.style.font = 'inherit';
  clearLogButton.style.cursor = 'pointer';
  diagnosticStatus.dataset.previewDiagnosticStatus = '';
  diagnosticStatus.hidden = true;
  diagnosticStatus.style.alignItems = 'center';
  diagnosticStatus.style.gap = '8px';
  diagnosticStatus.style.maxWidth = '100%';
  diagnosticStatus.style.whiteSpace = 'nowrap';
  diagnosticStatusMessage.dataset.previewDiagnosticMessage = '';
  diagnosticStatusMessage.style.display = 'none';
  resolveDiagnosticButton.type = 'button';
  resolveDiagnosticButton.textContent = 'Resolve';
  resolveDiagnosticButton.setAttribute(
    'aria-label',
    'Resolve the latest Preview runtime diagnostic',
  );
  resolveDiagnosticButton.style.font = 'inherit';
  resolveDiagnosticButton.style.cursor = 'pointer';
  diagnosticStatus.append(diagnosticStatusMessage, resolveDiagnosticButton);
  status.append(statusMessage);
  terminalHeader.append(terminalTitle, diagnosticStatus, clearLogButton);
  terminalViewport.append(terminalList);
  terminal.append(terminalHeader, terminalViewport, status);
  shell.append(layers, terminal);
  args.root.replaceChildren(shell);
  clearLogButton.disabled = true;

  const currentMatchesDraftFence = (): boolean => (
    !draftFenceReconciliationRequired
    && current !== null
    && (
      latestDraftFence === null
      || (
        current.revision === latestDraftFence.revision
        && current.committedMutationId === latestDraftFence.committedMutationId
        && current.buildSequence === latestDraftFence.buildSequence
      )
    )
  );

  const controlState = (): TPreviewPortalControlState => Object.freeze({
    liveUpdatesPaused,
    automaticRefreshPending,
    pendingBuild,
    publishable: (
      !disposed
      && current !== null
      && publishSelectionValid
      && currentMatchesDraftFence()
    ),
  });

  const emitControlState = (): void => {
    args.onControlStateChange?.(controlState());
  };

  const setPublishSelectionValid = (valid: boolean): void => {
    if (publishSelectionValid === valid) return;
    publishSelectionValid = valid;
    emitControlState();
  };

  const acceptDraftFence = (
    fence: TPreviewDraftFence,
    reconcilesStream: boolean,
  ): boolean => {
    if (
      fence.draftId !== args.payload.draftId
      || fence.revision.length === 0
      || fence.sourceDigestSha256 !== fence.revision
      || fence.committedMutationId.length === 0
      || !Number.isSafeInteger(fence.buildSequence)
      || fence.buildSequence < 1
    ) return false;
    const previous = latestDraftFence;
    if (
      previous !== null
      && (
        fence.buildSequence < previous.buildSequence
        || (
          fence.buildSequence === previous.buildSequence
          && (
            fence.revision !== previous.revision
            || fence.committedMutationId !== previous.committedMutationId
          )
        )
        || (
          fence.committedMutationId === previous.committedMutationId
          && (
            fence.revision !== previous.revision
            || fence.buildSequence !== previous.buildSequence
          )
        )
      )
    ) return false;
    latestDraftFence = Object.freeze({ ...fence });
    if (reconcilesStream && draftFenceReconciliationRequired) {
      draftFenceReconciliationRequired = false;
      emitControlState();
    }
    if (current !== null && !currentMatchesDraftFence()) {
      setPublishSelectionValid(false);
    }
    return true;
  };

  const logSelection = (
    selected: TMountedPreview | null = current,
  ): TPreviewLogSelection | null => (
    selected === null
      ? null
      : {
          revision: selected.revision,
          bindingRevision: selected.bindingRevision,
        }
  );

  const renderPreviewLog = (): void => {
    const previousScrollTop = terminalViewport.scrollTop;
    const followsTail = terminalList.childElementCount === 0
      || (
        terminalViewport.scrollHeight
        - previousScrollTop
        - terminalViewport.clientHeight
      ) <= 2;
    const fragment = dom.createDocumentFragment();
    for (const entry of previewLogEntries) {
      const row = dom.createElement('div');
      const source = dom.createElement('span');
      const message = dom.createElement('span');
      row.dataset.previewLogEntry = String(entry.sequence);
      row.dataset.previewLogLevel = entry.level;
      row.dataset.previewLogSource = entry.source;
      if (entry.buildSequence !== null) {
        row.dataset.previewLogBuildSequence = String(entry.buildSequence);
      }
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'max-content minmax(0, 1fr)';
      row.style.columnGap = '7px';
      row.style.padding = '1px 0';
      source.textContent = entry.source === 'build'
        && entry.buildSequence !== null
        ? `[build #${String(entry.buildSequence)}]`
        : `[${entry.source}]`;
      source.style.color = 'var(--preview-terminal-muted, #9ca3af)';
      message.textContent = entry.message;
      message.style.minWidth = '0';
      message.style.whiteSpace = 'pre-wrap';
      message.style.overflowWrap = 'anywhere';
      message.style.color = entry.level === 'error'
        ? 'var(--preview-terminal-error, #fca5a5)'
        : entry.level === 'warning'
          ? 'var(--preview-terminal-warning, #fcd34d)'
          : entry.level === 'success'
            ? 'var(--preview-terminal-success, #86efac)'
            : 'inherit';
      if (entry.truncated) {
        message.title = 'This Preview log entry was truncated by the host.';
      }
      row.append(source, message);
      fragment.append(row);
    }
    terminalList.replaceChildren(fragment);
    clearLogButton.disabled = previewLogEntries.length === 0;
    terminalViewport.scrollTop = followsTail
      ? terminalViewport.scrollHeight
      : previousScrollTop;
  };

  const appendPreviewLog = (event: TPreviewLogEvent): TPreviewLogEntry => {
    previewLogSequence += 1;
    const entry = fnProjectPreviewLogEntry({
      sequence: previewLogSequence,
      event,
    });
    previewLogEntries = fnRetainPreviewLogEntries({
      entries: previewLogEntries,
      entry,
    });
    renderPreviewLog();
    return entry;
  };

  const setStatus = (
    state: 'building' | 'error' | 'ready',
    message: string,
    event: TPreviewLogEvent = {
      kind: 'lifecycle',
      level: state === 'error'
        ? 'error'
        : state === 'ready'
          ? 'success'
          : 'info',
      message,
    },
  ): void => {
    shell.dataset.previewStatus = state;
    const entry = appendPreviewLog(event);
    statusMessage.textContent = entry.message;
    status.hidden = false;
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
  };

  const shortRevision = (revision: string): string => revision.slice(0, 8);

  const displayedStatus = (selected: TMountedPreview): string => (
    `Showing ${shortRevision(selected.revision)} • bindings #${selected.bindingRevision}`
  );

  const withDisplayedStatus = (
    message: string,
    selected: TMountedPreview | null = current,
  ): string => (
    selected === null ? message : `${message} ${displayedStatus(selected)}`
  );

  const applyOwnerState = (owner: TPreviewOwner): void => {
    if (
      owner.id !== args.payload.previewId
      || owner.canvasId !== args.canvasId
      || owner.frameNodeId !== args.frameNodeId
      || owner.draftId !== args.payload.draftId
      || owner.originChatId !== args.payload.originChatId
      || owner.role !== args.payload.role
      || owner.status === 'closed'
    ) return;
    runtimeDiagnostics = owner.runtimeDiagnostics
      .filter(
        (record) => (
          record.diagnostic.previewRevisionId === owner.activeRevisionId
        ),
      )
      .slice(-PREVIEW_LOG_MAX_ENTRIES);
    diagnosticStatus.hidden = runtimeDiagnostics.length === 0;
    diagnosticStatus.style.display = runtimeDiagnostics.length > 0
      ? 'inline-flex'
      : 'none';
    const latestDiagnostic = runtimeDiagnostics.at(-1)?.diagnostic;
    const diagnosticMessage = latestDiagnostic === undefined
      ? ''
      : `${latestDiagnostic.code}: ${latestDiagnostic.message} • `
        + `Awaiting retest ${String(runtimeDiagnostics.length)}`;
    diagnosticStatusMessage.textContent = diagnosticMessage;
    diagnosticStatusMessage.title = diagnosticMessage;
    resolveDiagnosticButton.disabled = runtimeDiagnostics.length === 0;
    const activeDiagnostics = runtimeDiagnostics.map((record) => ({
      record,
      key: JSON.stringify([
        record.diagnostic.previewRevisionId,
        record.diagnostic.fingerprint,
        record.status,
        record.diagnostic.occurrenceCount,
        record.reportedAtMs,
      ]),
    }));
    const activeDiagnosticKeys = new Set(
      activeDiagnostics.map(({ key }) => key),
    );
    for (const key of loggedDiagnostics) {
      if (!activeDiagnosticKeys.has(key)) loggedDiagnostics.delete(key);
    }
    for (const { key, record } of activeDiagnostics) {
      if (loggedDiagnostics.has(key)) continue;
      loggedDiagnostics.add(key);
      appendPreviewLog({
        kind: 'diagnostic',
        code: record.diagnostic.code,
        message: record.diagnostic.message,
        occurrenceCount: record.diagnostic.occurrenceCount,
      });
    }
    if (
      owner.publishedPreviewRevisionId !== null
      && owner.publishedBindingRevision !== null
      && owner.publishedBindingPlanDigestSha256 !== null
      && owner.publishedWidgetRevisionId !== null
      && owner.publishedIdempotencyKey !== null
      && owner.activeRevisionId === owner.publishedPreviewRevisionId
      && owner.sourceDigestSha256 !== null
    ) {
      publishedSelection = Object.freeze({
        bindingPlanDigestSha256: owner.publishedBindingPlanDigestSha256,
        bindingRevision: owner.publishedBindingRevision,
        previewId: owner.id,
        previewRevisionId: owner.publishedPreviewRevisionId,
      });
    }
    const selected = current;
    if (selected !== null) {
      setPublishSelectionValid(
        publishedSelection === null
        || publishedSelection.bindingPlanDigestSha256
          !== selected.bindingPlanDigestSha256
        || publishedSelection.bindingRevision !== selected.bindingRevision
        || publishedSelection.previewId !== selected.previewId
        || publishedSelection.previewRevisionId !== selected.previewRevisionId,
      );
    }
  };

  const waitForFrame = (): Promise<void> => new Promise((resolve) => {
    const handle = args.requestFrame(() => {
      pendingFrames.delete(handle);
      resolve();
    });
    pendingFrames.set(handle, resolve);
  });

  const cancelPendingFrames = (): void => {
    for (const [handle, resolve] of pendingFrames) {
      args.cancelFrame(handle);
      resolve();
    }
    pendingFrames.clear();
  };

  const leaseRequest = (
    mounted: TMountedPreview,
  ): Readonly<{
    previewId: string;
    previewRevisionId: string;
    canvasId: string;
    frameNodeId: string;
    leaseId: string;
  }> => ({
    previewId: mounted.previewId,
    previewRevisionId: mounted.previewRevisionId,
    canvasId: args.canvasId,
    frameNodeId: args.frameNodeId,
    leaseId: mounted.lease.leaseId,
  });

  const validateLeaseDescriptor = (
    mounted: TMountedPreview,
    descriptor: TPreviewMountLeaseDescriptor,
  ): void => {
    if (
      descriptor.leaseId !== mounted.lease.leaseId
      || descriptor.previewId !== mounted.previewId
      || descriptor.previewRevisionId !== mounted.previewRevisionId
      || descriptor.canvasId !== args.canvasId
      || descriptor.frameNodeId !== args.frameNodeId
      || !Number.isSafeInteger(descriptor.expiresAtMs)
      || descriptor.expiresAtMs <= args.nowMs()
    ) {
      throw new Error('Preview mount lease returned a different or expired authority.');
    }
  };

  const releaseMountedLease = (
    mounted: TMountedPreview,
  ): Promise<void> => {
    if (!mounted.lease.acquireAttempted) return Promise.resolve();
    if (mounted.lease.releaseOperation !== undefined) {
      return mounted.lease.releaseOperation;
    }
    const operation = (async (): Promise<void> => {
      const [releaseError] = await args.api.mount.release(leaseRequest(mounted));
      if (releaseError) {
        args.onError(new Error(errorMessage(
          releaseError,
          'Could not release the Preview mount lease.',
        )));
      }
    })();
    mounted.lease.releaseOperation = operation;
    return operation;
  };

  const destroyMounted = (
    mounted: TMountedPreview,
    reason: string,
  ): Promise<void> => {
    if (mounted.destroyOperation !== undefined) {
      return mounted.destroyOperation;
    }
    const operation = (async (): Promise<void> => {
      mounted.active = false;
      mounted.lease.stopped = true;
      pending.delete(mounted);
      if (current === mounted) {
        current = null;
        setPublishSelectionValid(false);
      }
      if (mounted.lease.renewTimer !== undefined) {
        args.functions.cancelTimeout(mounted.lease.renewTimer);
        mounted.lease.renewTimer = undefined;
      }
      await mounted.lease.acquireOperation?.catch(() => undefined);
      await mounted.mountOperation?.catch(() => undefined);
      await mounted.handle?.destroy(reason).catch(() => undefined);
      await mounted.lease.renewOperation?.catch(() => undefined);
      await releaseMountedLease(mounted);
      mounted.container.remove();
    })();
    mounted.destroyOperation = operation;
    return operation;
  };

  const handleLeaseFailure = (
    mounted: TMountedPreview,
    error: unknown,
  ): void => {
    if (!mounted.active || mounted.lease.stopped) return;
    if (
      mounted === current
      || mounted.refreshSequence === sequence
    ) {
      setPublishSelectionValid(false);
      setStatus('error', withDisplayedStatus(errorMessage(
        error,
        'Preview mount authority expired.',
      )));
    }
    args.onError(error);
    void destroyMounted(mounted, 'preview-mount-lease-lost');
  };

  async function renewMountedLease(
    mounted: TMountedPreview,
    confirmExecution: boolean,
  ): Promise<void> {
    const [renewError, descriptor] =
      await args.api.mount.renew(leaseRequest(mounted));
    if (renewError || !descriptor) {
      throw new Error(errorMessage(
        renewError,
        'Preview mount authority is no longer available.',
      ));
    }
    validateLeaseDescriptor(mounted, descriptor);
    if (confirmExecution && descriptor.renewedAtMs <= descriptor.acquiredAtMs) {
      throw new Error('Preview execution confirmation did not advance its mount lease.');
    }
    mounted.lease.descriptor = descriptor;
    scheduleLeaseRenewal(mounted);
  }

  const scheduleLeaseRenewal = (
    mounted: TMountedPreview,
  ): void => {
    if (
      !mounted.active
      || mounted.lease.stopped
      || mounted.lease.descriptor === undefined
    ) return;
    const remainingMs =
      mounted.lease.descriptor.expiresAtMs - args.nowMs();
    if (remainingMs <= 0) {
      handleLeaseFailure(
        mounted,
        new Error('Preview mount authority expired.'),
      );
      return;
    }
    const delayMs = Math.min(
      PREVIEW_MOUNT_LEASE_RENEW_MAX_DELAY_MS,
      Math.max(1, Math.floor(remainingMs / 2)),
    );
    mounted.lease.renewTimer = args.functions.scheduleTimeout(() => {
      mounted.lease.renewTimer = undefined;
      if (!mounted.active || mounted.lease.stopped) return;
      const operation = renewMountedLease(mounted, false)
        .catch((error) => handleLeaseFailure(mounted, error))
        .finally(() => {
          mounted.lease.renewOperation = undefined;
        });
      mounted.lease.renewOperation = operation;
    }, delayMs);
  };

  const acquireMountedLease = (
    mounted: TMountedPreview,
  ): Promise<void> => {
    const operation = (async (): Promise<void> => {
      mounted.lease.acquireAttempted = true;
      const [acquireError, descriptor] =
        await args.api.mount.acquire(leaseRequest(mounted));
      if (acquireError || !descriptor) {
        throw new Error(errorMessage(
          acquireError,
          'Could not acquire Preview mount authority.',
        ));
      }
      validateLeaseDescriptor(mounted, descriptor);
      mounted.lease.descriptor = descriptor;
    })();
    mounted.lease.acquireOperation = operation;
    return operation;
  };

  const confirmMountedLease = async (
    mounted: TMountedPreview,
  ): Promise<void> => {
    if (mounted.lease.renewTimer !== undefined) {
      args.functions.cancelTimeout(mounted.lease.renewTimer);
      mounted.lease.renewTimer = undefined;
    }
    const operation = renewMountedLease(mounted, true);
    mounted.lease.renewOperation = operation;
    try {
      await operation;
    } finally {
      mounted.lease.renewOperation = undefined;
    }
  };

  const applyLocalState = async (
    mounted: TMountedPreview,
  ): Promise<void> => {
    const handle = mounted.handle;
    if (handle === undefined || !mounted.active) return;
    handle.setProps(props);
    if (viewport !== null) handle.setViewport(viewport);
    handle.setFocused(focused, focusOptions);
    if (frozen) await handle.freeze('preview-frozen');
  };

  const ensureOwner = (): Promise<TPreviewOwner> => {
    if (ownerPromise !== null) return ownerPromise;
    const operation = (async (): Promise<TPreviewOwner> => {
      const [ownerError, owner] = await args.api.owner.ensure({
        previewId: args.payload.previewId,
        canvasId: args.canvasId,
        frameNodeId: args.frameNodeId,
        draftId: args.payload.draftId,
        originChatId: args.payload.originChatId,
        role: args.payload.role,
      });
      if (ownerError || !owner) {
        throw new Error(errorMessage(
          ownerError,
          'Could not establish the durable Preview owner.',
        ));
      }
      if (
        owner.canvasId !== args.canvasId
        || owner.draftId !== args.payload.draftId
        || owner.originChatId !== args.payload.originChatId
        || owner.role !== args.payload.role
        || owner.status === 'closed'
      ) {
        throw new Error('Preview owner resolution returned a different durable owner.');
      }
      if (
        owner.id !== args.payload.previewId
        || owner.frameNodeId !== args.frameNodeId
      ) {
        throw new Error(
          'This Preview frame lost the canonical owner race; use the existing companion frame.',
        );
      }
      const ownerRef = {
          previewId: owner.id,
          canvasId: owner.canvasId,
          frameNodeId: owner.frameNodeId,
      };
      const [diagnosticsError, authoritativeDiagnostics] =
        await args.api.diagnostics.get(ownerRef);
      const reconciledOwner = !diagnosticsError && authoritativeDiagnostics
        ? { ...owner, runtimeDiagnostics: authoritativeDiagnostics }
        : owner;
      applyOwnerState(reconciledOwner);
      return reconciledOwner;
    })();
    ownerPromise = operation.catch((error) => {
      ownerPromise = null;
      throw error;
    });
    return ownerPromise;
  };

  const encodeFingerprint = (value: string): Uint8Array => (
    Uint8Array.from(value, (character) => character.charCodeAt(0))
  );

  const reportDiagnostic = async (
    scope: TPreviewDiagnosticScope,
    phase: 'verifying' | 'mounting' | 'starting' | 'runtime',
    error: unknown,
    refreshSequence: number,
    candidate: TMountedPreview | null,
  ): Promise<void> => {
    const isReportable = (): boolean => (
      !disposed
      && (
        refreshSequence === sequence
        || (candidate !== null && candidate === current && candidate.active)
      )
    );
    if (!isReportable()) return;
    const diagnostic = await fnNormalizePreviewDiagnostic({
      error,
      phase,
      draftRevision: scope.draftRevision,
      previewRevisionId: scope.previewRevisionId,
      buildSequence: scope.buildSequence,
      timestampMs: args.nowMs(),
      encodeFingerprint,
      digestSha256: args.codec.digestSha256,
    });
    const diagnosticKey = JSON.stringify([
      diagnostic.previewRevisionId,
      diagnostic.fingerprint,
    ]);
    if (!isReportable() || pendingDiagnostics.has(diagnosticKey)) return;
    pendingDiagnostics.add(diagnosticKey);
    try {
      const [reportError, result] = await args.api.diagnostics.report({
        previewId: scope.previewId,
        canvasId: args.canvasId,
        frameNodeId: args.frameNodeId,
        draftId: args.payload.draftId,
        originChatId: args.payload.originChatId,
        diagnostic,
      });
      if (reportError || !result?.accepted) {
        throw new Error(errorMessage(
          reportError,
          'Could not report the Widget Preview diagnostic.',
        ));
      }
      const [ownerError, owner] = await args.api.owner.get({
        previewId: scope.previewId,
        canvasId: args.canvasId,
        frameNodeId: args.frameNodeId,
      });
      if (ownerError || !owner) {
        throw new Error(errorMessage(
          ownerError,
          'Could not reconcile the Widget Preview diagnostic.',
        ));
      }
      applyOwnerState(owner);
    } finally {
      pendingDiagnostics.delete(diagnosticKey);
    }
  };

  const queueDiagnostic = (
    scope: TPreviewDiagnosticScope,
    phase: 'verifying' | 'mounting' | 'starting' | 'runtime',
    error: unknown,
    refreshSequence: number,
    candidate: TMountedPreview | null,
  ): void => {
    void reportDiagnostic(
      scope,
      phase,
      error,
      refreshSequence,
      candidate,
    ).catch((reportError) => args.onError(reportError));
  };

  const runRefresh = async (
    refreshSequence: number,
    resetState: boolean,
  ): Promise<void> => {
    setPublishSelectionValid(false);
    const candidateStateOwner = resetState
      ? createEphemeralPreviewStateOwner()
      : stateOwner;
    if (resetState) stateOwners.add(candidateStateOwner);
    let stateOwnerAdopted = false;
    setStatus(
      'building',
      withDisplayedStatus(
        current === null ? 'Building Preview…' : 'Building a newer Preview…',
      ),
    );
    let candidate: TMountedPreview | null = null;
    let attemptedRevision: string | null = null;
    let functionBridge: ReturnType<typeof createWidgetFunctionHostBridge> | null = null;
    let diagnosticScope: TPreviewDiagnosticScope | null = null;
    let failurePhase: 'verifying' | 'mounting' | 'starting' = 'verifying';
    try {
      const owner = await ensureOwner();
      if (disposed || refreshSequence !== sequence) return;
      const [buildError, result] = await args.api.build({
        draftId: args.payload.draftId,
        previewId: owner.id,
        canvasId: owner.canvasId,
        frameNodeId: owner.frameNodeId,
      });
      if (disposed || refreshSequence !== sequence) return;
      if (buildError || !result) {
        throw new Error(errorMessage(buildError, 'Could not build Preview.'));
      }
      attemptedRevision = result.revision ?? null;
      if (!result.ready) {
        throw new Error(result.message || 'Preview build failed.');
      }
      if (result.draftId !== args.payload.draftId) {
        throw new Error('Preview build returned a different draft owner.');
      }
      if (
        result.previewId !== owner.id
        || typeof result.previewRevisionId !== 'string'
        || result.previewRevisionId.length === 0
        || !Number.isSafeInteger(result.buildSequence)
        || result.buildSequence === null
        || result.buildSequence < 1
        || !Number.isSafeInteger(result.bindingRevision)
        || result.bindingRevision === null
        || result.bindingRevision < 0
        || typeof result.bindingPlanDigestSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(result.bindingPlanDigestSha256)
        || typeof result.committedMutationId !== 'string'
        || result.committedMutationId.length < 1
      ) {
        throw new Error('Preview build did not return its exact durable revision selection.');
      }
      if (
        latestDraftFence !== null
        && (
          result.revision !== latestDraftFence.revision
          || result.committedMutationId !== latestDraftFence.committedMutationId
          || result.buildSequence !== latestDraftFence.buildSequence
        )
      ) {
        throw new Error('Preview build returned an obsolete or cross-digest draft fence.');
      }
      diagnosticScope = {
        previewId: result.previewId,
        previewRevisionId: result.previewRevisionId,
        draftRevision: result.revision,
        buildSequence: result.buildSequence,
        committedMutationId: result.committedMutationId,
      };
      const artifact = await fxDecodeAndVerifyUiArtifact({
        codec: args.codec,
      }, {
        expectedDigestSha256: result.uiArtifact.digestSha256,
        expectedCapsuleArtifactHash:
          result.uiArtifact.runtimeDescriptor.capsuleArtifactHash,
        bytesBase64: result.uiArtifact.bytesBase64,
        runtimeDescriptor: result.uiArtifact.runtimeDescriptor,
      });
      if (artifact.retainedByteSize !== result.uiArtifact.byteSize) {
        throw new Error('Preview artifact byte size metadata mismatch.');
      }
      const sourceMapArtifact = result.sourceMapArtifact === null
        ? undefined
        : await fxDecodeAndVerifySourceMapArtifact({
            codec: args.codec,
            decodeUtf8: (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
            parseSourceMap: (json) => new TraceMap(json),
          }, {
            expectedDigestSha256: result.sourceMapArtifact.digestSha256,
            expectedCapsuleArtifactHash:
              result.uiArtifact.runtimeDescriptor.capsuleArtifactHash,
            expectedSourceRevision: result.revision,
            bytesBase64: result.sourceMapArtifact.bytesBase64,
          });
      if (
        sourceMapArtifact !== undefined
        && sourceMapArtifact.retainedByteSize !== result.sourceMapArtifact?.byteSize
      ) {
        throw new Error('Preview source-map byte size metadata mismatch.');
      }
      if (disposed || refreshSequence !== sequence) return;
      failurePhase = 'mounting';

      const previewIdentity: TWidgetPreviewRuntimeIdentity = Object.freeze({
        kind: 'draft_preview',
        draftId: result.draftId,
        definitionId: result.definitionId,
        revision: result.revision,
      });
      const container = dom.createElement('div');
      container.dataset.previewStage = result.revision;
      container.style.position = 'absolute';
      container.style.inset = '0';
      container.style.opacity = '0';
      container.style.pointerEvents = 'none';
      candidate = {
        active: true,
        bindingPlanDigestSha256: result.bindingPlanDigestSha256,
        bindingRevision: result.bindingRevision,
        buildSequence: result.buildSequence,
        committedMutationId: result.committedMutationId,
        container,
        lease: {
          acquireAttempted: false,
          leaseId: args.functions.createLeaseId(),
          stopped: false,
        },
        previewId: result.previewId,
        previewRevisionId: result.previewRevisionId,
        refreshSequence,
        revision: result.revision,
        runtimeFailureObserved: false,
      };
      pending.add(candidate);
      await acquireMountedLease(candidate);
      if (
        disposed
        || refreshSequence !== sequence
        || !candidate.active
      ) {
        await destroyMounted(candidate, 'preview-build-superseded');
        return;
      }
      layers.append(container);
      const mountedCandidate = candidate;
      const functionIdentity: TWidgetRuntimeIdentity = Object.freeze({
        orgId: args.functions.organizationId(),
        canvasId: args.canvasId,
        elementId: args.frameNodeId,
        widgetInstanceId: result.previewId,
        definitionId: result.definitionId,
        revisionId: result.previewRevisionId,
      });
      const mountedFunctionBridge = createWidgetFunctionHostBridge({
        identity: functionIdentity,
        transport: args.functions.transport,
        functionDescriptors: result.contract.functions,
        createIdempotencyKey: args.functions.createIdempotencyKey,
        nowMs: args.nowMs,
        wait: args.functions.wait,
        isTargetCurrent: () => (
          !disposed
          && mountedCandidate.active
          && (
            mountedCandidate === current
            || (
              refreshSequence === sequence
              && pending.has(mountedCandidate)
            )
          )
          && args.functions.isTargetCurrent(functionIdentity)
        ),
      });
      functionBridge = mountedFunctionBridge;
      const reportRuntimeError = (error: unknown): void => {
        if (
          !mountedCandidate.active
          || disposed
          || (
            mountedCandidate !== current
            && refreshSequence !== sequence
          )
        ) return;
        mountedCandidate.runtimeFailureObserved = true;
        setPublishSelectionValid(false);
        setStatus(
          'error',
          withDisplayedStatus(
            `Runtime failure in ${shortRevision(mountedCandidate.revision)}.`,
            mountedCandidate,
          ),
        );
        queueDiagnostic(
          {
            previewId: mountedCandidate.previewId,
            previewRevisionId: mountedCandidate.previewRevisionId,
            draftRevision: mountedCandidate.revision,
            buildSequence: mountedCandidate.buildSequence,
            committedMutationId: mountedCandidate.committedMutationId,
          },
          'runtime',
          error,
          refreshSequence,
          mountedCandidate,
        );
        args.onError(error);
      };
      const previousAdmission = current?.handle;
      candidate.handle = args.runtime.renderPreloadedOwned({
        apis: artifact.runtimeDescriptor.apiContract.groups,
        ...(viewport === null ? {} : { initialViewport: viewport }),
        initiallyFrozen: frozen,
        ...(previousAdmission === undefined
          ? {}
          : { swapFrom: previousAdmission }),
        mount: () => args.mount.mount({
          mode: 'preview',
          root: container,
          identity: previewIdentity,
          artifact,
          ...(sourceMapArtifact === undefined ? {} : { sourceMapArtifact }),
          functionDescriptors: result.contract.functions,
          browserFunctionDescriptorsDigestSha256:
            result.contract.browserFunctionDescriptorsDigestSha256,
          functionBridge: mountedFunctionBridge,
          collaborativeStateBridge: candidateStateOwner.open(),
          props,
          onDiagnostic: reportRuntimeError,
          onFatal: reportRuntimeError,
        }),
        onError(error) {
          if (mountedCandidate === current) args.onError(error);
        },
      });
      candidate.mountOperation = Promise.resolve(candidate.handle);
      if (!candidate.active) {
        await destroyMounted(candidate, 'preview-build-superseded');
        return;
      }
      await applyLocalState(candidate);
      failurePhase = 'starting';
      await candidate.handle.ready();
      if (disposed || refreshSequence !== sequence || !candidate.active) {
        await destroyMounted(candidate, 'preview-build-superseded');
        return;
      }
      await waitForFrame();
      if (disposed || refreshSequence !== sequence || !candidate.active) {
        await destroyMounted(candidate, 'preview-build-superseded');
        return;
      }
      await waitForFrame();
      if (disposed || refreshSequence !== sequence || !candidate.active) {
        await destroyMounted(candidate, 'preview-build-superseded');
        return;
      }
      await confirmMountedLease(candidate);
      if (disposed || refreshSequence !== sequence || !candidate.active) {
        await destroyMounted(candidate, 'preview-build-superseded');
        return;
      }

      const previous = current;
      const previousStateOwner = stateOwner;
      pending.delete(candidate);
      if (
        pendingBuild?.buildId === candidate.previewRevisionId
        && pendingBuild.buildSequence === candidate.buildSequence
        && (
          pendingBuild.sourceDigestSha256 !== candidate.revision
          || pendingBuild.committedMutationId !== candidate.committedMutationId
        )
      ) {
        throw new Error('Preview progress fence does not match the committed revision.');
      }
      current = candidate;
      latestBuildSequence = Math.max(latestBuildSequence, candidate.buildSequence);
      if (
        pendingBuild?.buildId === candidate.previewRevisionId
        && pendingBuild.buildSequence === candidate.buildSequence
      ) {
        pendingBuild = null;
        emitControlState();
      }
      setPublishSelectionValid(
        publishedSelection === null
        || publishedSelection.bindingPlanDigestSha256
          !== candidate.bindingPlanDigestSha256
        || publishedSelection.bindingRevision !== candidate.bindingRevision
        || publishedSelection.previewId !== candidate.previewId
        || publishedSelection.previewRevisionId !== candidate.previewRevisionId,
      );
      stateOwner = candidateStateOwner;
      stateOwnerAdopted = true;
      candidate.container.style.opacity = '1';
      candidate.container.style.pointerEvents = '';
      setStatus('ready', displayedStatus(candidate), {
        kind: 'revision',
        selection: {
          revision: candidate.revision,
          bindingRevision: candidate.bindingRevision,
        },
      });
      if (previous !== null) {
        await destroyMounted(previous, 'preview-replaced');
      }
      if (previousStateOwner !== candidateStateOwner) {
        previousStateOwner.dispose();
        stateOwners.delete(previousStateOwner);
      }
    } catch (error) {
      if (
        diagnosticScope !== null
        && candidate?.runtimeFailureObserved !== true
        && (
          refreshSequence === sequence
          || (candidate !== null && candidate === current && candidate.active)
        )
      ) {
        queueDiagnostic(
          diagnosticScope,
          failurePhase,
          error,
          refreshSequence,
          candidate,
        );
      }
      if (candidate !== null) {
        await destroyMounted(candidate, 'preview-mount-failed');
      }
      functionBridge?.dispose();
      if (disposed || refreshSequence !== sequence) return;
      setPublishSelectionValid(false);
      setStatus(
        'error',
        attemptedRevision === null
          ? withDisplayedStatus(errorMessage(error, 'Could not build Preview.'))
          : withDisplayedStatus(
              `Build ${shortRevision(attemptedRevision)} failed: ${
                errorMessage(error, 'Could not build Preview.')
              }`,
            ),
      );
      args.onError(error);
    } finally {
      if (resetState && !stateOwnerAdopted) {
        candidateStateOwner.dispose();
        stateOwners.delete(candidateStateOwner);
      }
    }
  };

  const requestRefresh = (resetState: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    sequence += 1;
    return runRefresh(sequence, resetState);
  };
  const explicitRefresh = (resetState: boolean): Promise<void> => {
    if (automaticRefreshPending) {
      automaticRefreshPending = false;
      emitControlState();
    }
    return requestRefresh(resetState);
  };
  const refresh = (): Promise<void> => explicitRefresh(false);
  const autoRefresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (liveUpdatesPaused) {
      if (!automaticRefreshPending) {
        automaticRefreshPending = true;
        emitControlState();
      }
      return Promise.resolve();
    }
    return requestRefresh(false);
  };
  const pauseLiveUpdates = (): void => {
    if (disposed || liveUpdatesPaused) return;
    liveUpdatesPaused = true;
    emitControlState();
  };
  const resumeLiveUpdates = (): Promise<void> => {
    if (disposed || !liveUpdatesPaused) return Promise.resolve();
    liveUpdatesPaused = false;
    const shouldRefresh = automaticRefreshPending;
    automaticRefreshPending = false;
    emitControlState();
    return shouldRefresh ? requestRefresh(false) : Promise.resolve();
  };
  const cancelBuild = async (): Promise<boolean> => {
    if (disposed || pendingBuild === null) return false;
    const selected = pendingBuild;
    const refreshSequence = sequence;
    const [cancelError, cancelled] = await args.api.cancel({
      previewId: selected.previewId,
      canvasId: args.canvasId,
      frameNodeId: args.frameNodeId,
      buildId: selected.buildId,
      expectedBuildSequence: selected.buildSequence,
    });
    if (disposed) return false;
    if (cancelError) {
      throw new Error(errorMessage(
        cancelError,
        'Could not cancel the current Preview build.',
      ));
    }
    if (cancelled !== true) return false;
    if (sequence === refreshSequence) sequence += 1;
    if (
      pendingBuild?.buildId === selected.buildId
      && pendingBuild.buildSequence === selected.buildSequence
    ) {
      pendingBuild = null;
      emitControlState();
    }
    setPublishSelectionValid(false);
    if (
      pendingBuild === null
      && latestBuildSequence <= selected.buildSequence
    ) {
      setStatus(
        'building',
        withDisplayedStatus(`Build ${shortRevision(selected.revision)} cancelled.`),
        {
          kind: 'build',
          phase: 'cancelled',
          revision: selected.revision,
          buildSequence: selected.buildSequence,
          displayed: logSelection(),
        },
      );
    }
    return true;
  };
  const reset = (): Promise<void> => explicitRefresh(true);
  const publicationSelection = (): TPreviewPublicationSelection | null => {
    const selected = current;
    if (
      disposed
      || selected === null
      || !publishSelectionValid
      || !currentMatchesDraftFence()
    ) return null;
    return Object.freeze({
      draftId: args.payload.draftId,
      expectedRevision: selected.revision,
      previewId: selected.previewId,
      previewRevisionId: selected.previewRevisionId,
      expectedBindingRevision: selected.bindingRevision,
      expectedBindingPlanDigestSha256: selected.bindingPlanDigestSha256,
      canvasId: args.canvasId,
      frameNodeId: args.frameNodeId,
      buildSequence: selected.buildSequence,
    });
  };
  const publish = async (
    expectedSelection?: TPreviewPublicationSelection,
    idempotencyKey = args.functions.createIdempotencyKey(),
  ): Promise<boolean> => {
    if (disposed) return false;
    const selected = current;
    if (
      selected === null
      || !publishSelectionValid
      || !currentMatchesDraftFence()
    ) {
      setStatus('error', 'Build the current draft successfully before publishing.');
      return false;
    }
    if (
      expectedSelection !== undefined
      && (
        expectedSelection.draftId !== args.payload.draftId
        || expectedSelection.expectedRevision !== selected.revision
        || expectedSelection.previewId !== selected.previewId
        || expectedSelection.previewRevisionId !== selected.previewRevisionId
        || expectedSelection.expectedBindingRevision !== selected.bindingRevision
        || expectedSelection.expectedBindingPlanDigestSha256
          !== selected.bindingPlanDigestSha256
        || expectedSelection.canvasId !== args.canvasId
        || expectedSelection.frameNodeId !== args.frameNodeId
        || expectedSelection.buildSequence !== selected.buildSequence
      )
    ) {
      setStatus(
        'error',
        'Preview changed before publication. Review the ready frame again.',
      );
      return false;
    }
    const publicationSequence = sequence;
    setPublishSelectionValid(false);
    setStatus(
      'building',
      `Publishing exact Preview ${selected.revision.slice(0, 8)}…`,
    );
    try {
      const [publishError, result] = await args.publishApi.publish({
        idempotencyKey,
        draftId: args.payload.draftId,
        expectedRevision: selected.revision,
        previewId: selected.previewId,
        previewRevisionId: selected.previewRevisionId,
        expectedBindingRevision: selected.bindingRevision,
        expectedBindingPlanDigestSha256: selected.bindingPlanDigestSha256,
        canvasId: args.canvasId,
        frameNodeId: args.frameNodeId,
      });
      if (disposed) return false;
      if (publishError || !result) {
        throw new Error(errorMessage(
          publishError,
          'Could not publish the active Preview revision.',
        ));
      }
      if (!result.published) {
        throw new Error(result.message || 'Preview publication failed.');
      }
      if (
        result.draftId !== args.payload.draftId
        || result.revision !== selected.revision
      ) {
        throw new Error('Publication returned a different Preview source revision.');
      }
      publishedSelection = Object.freeze({
        bindingPlanDigestSha256: selected.bindingPlanDigestSha256,
        bindingRevision: selected.bindingRevision,
        previewId: selected.previewId,
        previewRevisionId: selected.previewRevisionId,
      });
      setStatus('ready', `Published. ${displayedStatus(selected)}`);
      return true;
    } catch (error) {
      if (disposed) return false;
      if (
        current === selected
        && sequence === publicationSequence
        && pendingBuild === null
        && latestBuildSequence === selected.buildSequence
      ) {
        setPublishSelectionValid(true);
      }
      setStatus(
        'error',
        withDisplayedStatus(errorMessage(error, 'Could not publish Preview.')),
      );
      args.onError(error);
      return false;
    }
  };
  clearLogButton.addEventListener('click', () => {
    if (disposed || previewLogEntries.length === 0) return;
    previewLogEntries = [];
    renderPreviewLog();
    terminalViewport.focus({ preventScroll: true });
  });
  resolveDiagnosticButton.addEventListener('click', () => {
    const selected = runtimeDiagnostics.at(-1);
    if (
      disposed
      || resolveDiagnosticButton.disabled
      || selected?.diagnostic.previewRevisionId === null
      || selected === undefined
    ) return;
    resolveDiagnosticButton.disabled = true;
    void (async () => {
      const owner = await ensureOwner();
      const [resolveError, updated] = await args.api.diagnostics.resolve({
        previewId: owner.id,
        canvasId: owner.canvasId,
        frameNodeId: owner.frameNodeId,
        previewRevisionId: selected.diagnostic.previewRevisionId!,
        fingerprint: selected.diagnostic.fingerprint,
      });
      if (resolveError || !updated) {
        throw new Error(errorMessage(
          resolveError,
          'Could not resolve the Preview runtime diagnostic.',
        ));
      }
      applyOwnerState(updated);
    })().catch((error) => {
      resolveDiagnosticButton.disabled = runtimeDiagnostics.length === 0;
      args.onError(error);
    });
  });

  emitControlState();

  return Object.freeze({
    refresh,
    autoRefresh,
    pauseLiveUpdates,
    resumeLiveUpdates,
    cancelBuild,
    controlState,
    reset,
    publish,
    publicationSelection,
    reportOwnerState(owner): void {
      if (disposed) return;
      applyOwnerState(owner);
    },
    invalidateDraftFence(): void {
      if (disposed || draftFenceReconciliationRequired) return;
      draftFenceReconciliationRequired = true;
      emitControlState();
    },
    reportDraftFence(fence): void {
      if (disposed) return;
      acceptDraftFence(fence, true);
    },
    reportProgress(progress): void {
      if (
        disposed
        || progress.previewId !== args.payload.previewId
        || progress.revision.length === 0
        || progress.sourceDigestSha256 !== progress.revision
        || progress.committedMutationId.length === 0
        || progress.buildId.length === 0
        || !Number.isSafeInteger(progress.buildSequence)
        || progress.buildSequence < 1
        || progress.buildSequence < latestBuildSequence
        || (
          latestDraftFence !== null
          && (
            progress.revision !== latestDraftFence.revision
            || progress.committedMutationId !== latestDraftFence.committedMutationId
            || progress.buildSequence !== latestDraftFence.buildSequence
          )
        )
        || (
          pendingBuild !== null
          && pendingBuild.buildId === progress.buildId
          && pendingBuild.buildSequence === progress.buildSequence
          && (
            pendingBuild.sourceDigestSha256 !== progress.sourceDigestSha256
            || pendingBuild.committedMutationId !== progress.committedMutationId
          )
        )
      ) return;
      latestBuildSequence = progress.buildSequence;
      if (
        progress.phase === 'queued'
        || progress.phase === 'installing'
        || progress.phase === 'building'
        || progress.phase === 'validating'
      ) {
        setPublishSelectionValid(false);
        pendingBuild = Object.freeze({
          previewId: progress.previewId,
          revision: progress.revision,
          sourceDigestSha256: progress.sourceDigestSha256,
          committedMutationId: progress.committedMutationId,
          buildId: progress.buildId,
          buildSequence: progress.buildSequence,
        });
        emitControlState();
        const action = progress.phase === 'queued'
          ? 'Queued'
          : progress.phase === 'installing'
            ? 'Installing'
            : progress.phase === 'building'
              ? 'Building'
              : 'Validating';
        setStatus(
          'building',
          withDisplayedStatus(
            `${action} ${shortRevision(progress.revision)}…`,
          ),
          {
            kind: 'build',
            phase: progress.phase,
            revision: progress.revision,
            buildSequence: progress.buildSequence,
            displayed: logSelection(),
          },
        );
        return;
      }
      if (
        pendingBuild?.buildId === progress.buildId
        && pendingBuild.buildSequence === progress.buildSequence
      ) {
        pendingBuild = null;
        emitControlState();
      }
      if (progress.phase === 'ready') {
        setPublishSelectionValid(false);
        setStatus(
          'building',
          withDisplayedStatus(
            `Verifying ${shortRevision(progress.revision)}…`,
          ),
          {
            kind: 'build',
            phase: 'ready',
            revision: progress.revision,
            buildSequence: progress.buildSequence,
            displayed: logSelection(),
          },
        );
        return;
      }
      if (progress.phase === 'failed') {
        setPublishSelectionValid(false);
        setStatus(
          'error',
          withDisplayedStatus(
            `Build ${shortRevision(progress.revision)} failed.`,
          ),
          {
            kind: 'build',
            phase: 'failed',
            revision: progress.revision,
            buildSequence: progress.buildSequence,
            displayed: logSelection(),
          },
        );
        return;
      }
      setStatus(
        'building',
        withDisplayedStatus(
          `Build ${shortRevision(progress.revision)} superseded…`,
        ),
        {
          kind: 'build',
          phase: 'superseded',
          revision: progress.revision,
          buildSequence: progress.buildSequence,
          displayed: logSelection(),
        },
      );
    },
    currentRevision: () => current?.revision ?? null,
    setProps(value): void {
      if (disposed) return;
      props = value;
      current?.handle?.setProps(value);
      pending.forEach((mounted) => mounted.handle?.setProps(value));
    },
    setViewport(value): void {
      if (disposed) return;
      viewport = fnPreviewGuestViewport({
        viewport: value,
        contentSize: {
          width: layers.clientWidth,
          height: layers.clientHeight,
        },
      });
      current?.handle?.setViewport(viewport);
      pending.forEach((mounted) => mounted.handle?.setViewport(viewport!));
    },
    setFocused(value, options): void {
      if (disposed) return;
      focused = value;
      focusOptions = options;
      current?.handle?.setFocused(value, options);
      pending.forEach((mounted) => mounted.handle?.setFocused(value, options));
    },
    async freeze(reason): Promise<void> {
      if (disposed) return;
      frozen = true;
      await Promise.allSettled([
        ...(current?.handle === undefined ? [] : [current.handle.freeze(reason)]),
        ...[...pending].flatMap((mounted) => (
          mounted.handle === undefined ? [] : [mounted.handle.freeze(reason)]
        )),
      ]);
    },
    async resume(reason): Promise<void> {
      if (disposed) return;
      frozen = false;
      await Promise.allSettled([
        ...(current?.handle === undefined ? [] : [current.handle.resume(reason)]),
        ...[...pending].flatMap((mounted) => (
          mounted.handle === undefined ? [] : [mounted.handle.resume(reason)]
        )),
      ]);
    },
    diagnostics: () => current?.handle?.diagnostics() ?? null,
    destroy(reason = 'preview-unmounted'): Promise<void> {
      if (destroyOperation !== undefined) return destroyOperation;
      const operation = (async (): Promise<void> => {
        disposed = true;
        sequence += 1;
        cancelPendingFrames();
        const mounted = new Set([
          ...pending,
          ...(current === null ? [] : [current]),
        ]);
        current = null;
        pending.clear();
        await Promise.allSettled(
          [...mounted].map((entry) => destroyMounted(entry, reason)),
        );
        stateOwners.forEach((owner) => owner.dispose());
        stateOwners.clear();
        if (shell.parentNode === args.root) args.root.replaceChildren();
      })();
      destroyOperation = operation;
      return operation;
    },
  });
}
