import type { CapsuleViewport } from '@vibecanvas/capsule-vibecanvas/host';
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetCapsuleProps,
} from '@vibecanvas/widget-contract';
import {
  WIDGET_UI_MAX_ACTIVE_RUNTIMES,
  WIDGET_UI_MAX_CONCURRENT_LOADS,
  WIDGET_UI_MAX_FROZEN_RUNTIMES,
  WIDGET_UI_MAX_GPU_RUNTIMES,
  WIDGET_UI_MAX_HEAVY_RUNTIMES,
  WIDGET_UI_MAX_LIVE_RUNTIMES,
  WIDGET_UI_MAX_OWNER_RECORDS,
  WIDGET_UI_MAX_QUEUED_LOADS,
  WIDGET_UI_MAX_REPRIORITIZATION_CANDIDATES,
  WIDGET_UI_MAX_THROTTLED_RUNTIMES,
  WIDGET_UI_RETENTION_RADIUS_PX,
} from './CONSTANTS';
import { createWidgetFunctionHostBridge } from './create-widget-function-host-bridge';
import { fnWidgetUiArtifactCacheKey } from './fn.artifact-cache-key';
import {
  fnPlanWidgetCapsulePopulation,
  fnWidgetCapsulePopulationResourceClass,
  type TWidgetCapsulePopulationCandidate,
  type TWidgetCapsulePopulationMode,
  type TWidgetCapsulePopulationResourceClass,
} from './fn.capsule-population';
import { fnWidgetCollaborativeStateIdentitiesMatch } from './fn.collaborative-state-json';
import {
  fnWidgetRuntimeIdentityMatches,
  fnWidgetRuntimeLocalTarget,
  fnWidgetRuntimeLoadRequest,
  fnWidgetRuntimeWidgetExtension,
} from './fn.runtime-identity';
import { fxDecodeAndVerifyUiArtifact } from './fx.decode-and-verify-ui-artifact';
import type {
  TWidgetArtifactCodecPort,
  TWidgetCollaborativeStatePort,
  TWidgetCollaborativeStateSession,
  TWidgetFunctionHostBridge,
  TWidgetRuntimeIdentity,
  TWidgetRuntimeLocalTarget,
  TWidgetRuntimeTransportPort,
  TWidgetUiArtifactMountPort,
  TWidgetUiRuntimeHandle,
  TWidgetUiRuntimeRenderArgs,
  TWidgetUiRuntimeRenderOwner,
  TVerifiedWidgetUiArtifact,
} from './interface';
import { WidgetUiArtifactCache } from './WidgetUiArtifactCache';

type TWidgetUiRuntimeConfig = Readonly<{
  transport: TWidgetRuntimeTransportPort;
  codec: TWidgetArtifactCodecPort;
  mount: TWidgetUiArtifactMountPort;
  createIdempotencyKey(): string;
  organizationId(): string;
  tenantAuthorityKey(): string;
  nowMs(): number;
  wait(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  scheduleTimeout(callback: () => void, timeoutMs: number): unknown;
  cancelTimeout(timer: unknown): void;
  collaborativeState?: TWidgetCollaborativeStatePort;
  isTargetCurrent?(target: TWidgetRuntimeLocalTarget): boolean;
  loadRetry?: Readonly<{
    initialBackoffMs?: number;
    maxBackoffMs?: number;
  }>;
  cache?: WidgetUiArtifactCache;
  maxConcurrentLoads?: number;
  maxQueuedLoads?: number;
}>;

type TLoadRetry = Readonly<{
  initialBackoffMs: number;
  maxBackoffMs: number;
}>;

type TWidgetUiRuntimeRenderAdmissionArgs = TWidgetUiRuntimeRenderArgs & Readonly<{
  initialViewport?: Parameters<TWidgetUiRuntimeHandle['setViewport']>[0];
  initiallyFrozen?: boolean;
}>;

type TLoadedWidget = Readonly<{
  artifact: TVerifiedWidgetUiArtifact;
  collaborativeState: boolean;
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
  browserFunctionDescriptorsDigestSha256: string;
  identity: TWidgetRuntimeIdentity;
}>;

type TQueuedLoad = {
  id: string;
  cancelled: boolean;
  started: boolean;
  wanted: boolean;
  start(): void;
};

const WIDGET_UI_POPULATION_SNAPSHOT = Symbol('widget-ui-population-snapshot');
const WIDGET_UI_APPLY_POPULATION = Symbol('widget-ui-apply-population');
const WIDGET_UI_SET_REPRIORITIZATION_RANK = Symbol('widget-ui-set-reprioritization-rank');
const WIDGET_UI_DROP_LOADED_ARTIFACT = Symbol('widget-ui-drop-loaded-artifact');
const WIDGET_UI_LOAD_ENTRY = Symbol('widget-ui-load-entry');

type TWidgetUiRuntimeOwnedRender = TWidgetUiRuntimeRenderOwner & Readonly<{
  [WIDGET_UI_POPULATION_SNAPSHOT](): TWidgetCapsulePopulationCandidate;
  [WIDGET_UI_APPLY_POPULATION](mode: TWidgetCapsulePopulationMode): Promise<boolean>;
  [WIDGET_UI_SET_REPRIORITIZATION_RANK](rank: number | null): void;
  [WIDGET_UI_DROP_LOADED_ARTIFACT](): void;
  [WIDGET_UI_LOAD_ENTRY]: TQueuedLoad;
}>;

const DEFAULT_VIEWPORT: CapsuleViewport = Object.freeze({
  width: 0,
  height: 0,
  scale: 1,
  visibility: 'visible',
  distance: 0,
  priority: 0,
  occlusion: 0,
});

const UNKNOWN_RESOURCE_CLASS = fnWidgetCapsulePopulationResourceClass(null);

class RecoverableWidgetRuntimeLoadError extends Error {}

function loadErrorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function isRecoverableLoadError(error: unknown): boolean {
  const code = loadErrorCode(error);
  if (code !== null) {
    return code === 'NOT_FOUND'
      || code === 'SERVICE_UNAVAILABLE'
      || code === 'TIMEOUT'
      || code === 'TOO_MANY_REQUESTS';
  }
  return error instanceof Error;
}

function isCatalogInvalidation(error: unknown): boolean {
  return loadErrorCode(error) === 'WIDGET_CAPSULE_CATALOG_INVALIDATED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Widget UI artifact could not be loaded.';
}

function cloneViewport(value: CapsuleViewport): CapsuleViewport {
  return Object.freeze({ ...value });
}

export class WidgetUiRuntime {
  readonly #cache: WidgetUiArtifactCache;
  readonly #inFlightArtifacts = new Map<string, Promise<TVerifiedWidgetUiArtifact>>();
  readonly #loadRetry: TLoadRetry;
  readonly #maxConcurrentLoads: number;
  readonly #maxQueuedLoads: number;
  readonly #loadQueue = new Set<TQueuedLoad>();
  readonly #owners = new Set<TWidgetUiRuntimeOwnedRender>();
  #activeLoadCount = 0;
  #destroyed = false;
  #nextOwnerOrder = 0;
  #populationRequested = false;
  #populationOperation: Promise<void> | undefined;
  #populationTimer: unknown;
  #populationTimerAtMs: number | null = null;
  #reprioritizationCandidateCount = 0;

  constructor(readonly config: TWidgetUiRuntimeConfig) {
    this.#cache = config.cache ?? new WidgetUiArtifactCache();
    const initialBackoffMs = config.loadRetry?.initialBackoffMs ?? 1_000;
    const maxBackoffMs = config.loadRetry?.maxBackoffMs ?? 5_000;
    if (!Number.isInteger(initialBackoffMs) || initialBackoffMs < 0 || initialBackoffMs > 5_000) {
      throw new TypeError('Widget runtime initial load retry delay is invalid.');
    }
    if (
      !Number.isInteger(maxBackoffMs)
      || maxBackoffMs < initialBackoffMs
      || maxBackoffMs > 5_000
    ) {
      throw new TypeError('Widget runtime maximum load retry delay is invalid.');
    }
    const maxConcurrentLoads = config.maxConcurrentLoads ?? WIDGET_UI_MAX_CONCURRENT_LOADS;
    const maxQueuedLoads = config.maxQueuedLoads ?? WIDGET_UI_MAX_QUEUED_LOADS;
    if (
      !Number.isInteger(maxConcurrentLoads)
      || maxConcurrentLoads < 1
      || maxConcurrentLoads > 64
    ) {
      throw new TypeError('Widget runtime concurrent load limit is invalid.');
    }
    if (
      !Number.isInteger(maxQueuedLoads)
      || maxQueuedLoads < 0
      || maxQueuedLoads > WIDGET_UI_MAX_QUEUED_LOADS
    ) {
      throw new TypeError('Widget runtime load queue limit is invalid.');
    }
    this.#loadRetry = Object.freeze({ initialBackoffMs, maxBackoffMs });
    this.#maxConcurrentLoads = maxConcurrentLoads;
    this.#maxQueuedLoads = maxQueuedLoads;
  }

  render(args: TWidgetUiRuntimeRenderAdmissionArgs): () => void {
    const owner = this.renderOwned(args);
    return () => {
      void owner.destroy();
    };
  }

  renderOwned(args: TWidgetUiRuntimeRenderAdmissionArgs): TWidgetUiRuntimeRenderOwner {
    if (this.#destroyed) throw new Error('Widget UI runtime is destroyed.');
    if (this.#owners.size >= WIDGET_UI_MAX_OWNER_RECORDS) {
      throw new Error('Widget UI runtime inert-owner capacity is exhausted.');
    }

    const target = fnWidgetRuntimeLocalTarget({ canvasId: args.canvasId, element: args.element });
    const request = fnWidgetRuntimeLoadRequest({
      canvasId: target.canvasId,
      elementId: target.elementId,
      definitionId: target.definitionId,
      revisionId: target.revisionId,
      widgetInstanceId: target.widgetInstanceId,
    });
    const organizationId = this.#readOrganizationId();
    const tenantAuthorityKey = this.#readTenantAuthorityKey();
    const abortController = new AbortController();
    const order = this.#nextOwnerOrder;
    const populationId = String(order);
    this.#nextOwnerOrder += 1;

    let disposed = false;
    let blocked = false;
    let handle: TWidgetUiRuntimeHandle | undefined;
    let functionBridge: TWidgetFunctionHostBridge | undefined;
    let collaborativeStateBridge: TWidgetCollaborativeStateSession | undefined;
    let disposeOperation: Promise<void> | undefined;
    let loadOperation: Promise<void> | undefined;
    let ownerOperation: Promise<unknown> = Promise.resolve();
    let loaded: TLoadedWidget | undefined;
    let resourceClass: TWidgetCapsulePopulationResourceClass = UNKNOWN_RESOURCE_CLASS;
    let currentMode: TWidgetCapsulePopulationMode = 'inert';
    let assignedMode: TWidgetCapsulePopulationMode = 'inert';
    let pendingViewport = cloneViewport(args.initialViewport ?? DEFAULT_VIEWPORT);
    const widgetExtension = fnWidgetRuntimeWidgetExtension(args.element);
    let pendingProps = (
      widgetExtension?.type === 'widget-instance'
        ? widgetExtension.uiProps ?? {}
        : {}
    ) as TWidgetCapsuleProps;
    let pendingFocus: FocusOptions | undefined;
    let focused = false;
    let hardFrozen = args.initiallyFrozen === true;
    const initialNowMs = this.#nowMs();
    let hiddenSinceMs = pendingViewport.visibility === 'hidden' ? initialNowMs : null;
    let farSinceMs = (
      pendingViewport.visibility === 'hidden'
      && pendingViewport.distance > WIDGET_UI_RETENTION_RADIUS_PX
    ) ? initialNowMs : null;

    args.root.dataset.widgetRuntimeStatus = 'deferred';
    args.root.textContent = pendingViewport.visibility === 'hidden'
      ? 'Widget loading is deferred until it re-enters the visible canvas.'
      : 'Widget is waiting for Capsule runtime capacity.';

    const isCurrent = () => !disposed
      && !abortController.signal.aborted
      && this.isTenantAuthorityCurrent(organizationId, tenantAuthorityKey)
      && (this.config.isTargetCurrent?.(target) ?? true);
    const fail = (error: unknown): void => {
      if (disposed) return;
      blocked = true;
      args.root.dataset.widgetRuntimeStatus = 'error';
      args.root.textContent = errorMessage(error);
    };
    const markDeferred = (message?: string): void => {
      if (disposed || handle !== undefined) return;
      args.root.dataset.widgetRuntimeStatus = 'deferred';
      args.root.textContent = message ?? (
        pendingViewport.visibility === 'hidden'
          ? 'Widget loading is deferred until it re-enters the visible canvas.'
          : 'Widget is waiting for Capsule runtime capacity.'
      );
    };
    const releaseLive = async (reason: string): Promise<boolean> => {
      const mounted = handle;
      const changed = mounted !== undefined || currentMode !== 'inert';
      handle = undefined;
      currentMode = 'inert';
      try {
        functionBridge?.dispose();
      } catch {
        // Handle destruction still has to run after a provider cleanup failure.
      }
      try {
        collaborativeStateBridge?.dispose();
      } catch {
        // Collaborative cleanup is best-effort once this runtime is detached.
      }
      functionBridge = undefined;
      collaborativeStateBridge = undefined;
      await mounted?.destroy(reason).catch(() => undefined);
      return changed;
    };
    const mountLoaded = async (
      mode: Exclude<TWidgetCapsulePopulationMode, 'inert'>,
    ): Promise<boolean> => {
      const selected = loaded;
      if (selected === undefined || disposed) return false;
      try {
        this.assertLoadActive(
          target,
          organizationId,
          tenantAuthorityKey,
          () => disposed,
          abortController.signal,
        );
        if (selected.collaborativeState) {
          if (!this.config.collaborativeState) {
            throw new Error('Widget collaborative state capability is unavailable.');
          }
          const collaborativeIdentity = selected.identity;
          collaborativeStateBridge = await this.config.collaborativeState.open({
            identity: collaborativeIdentity,
            signal: abortController.signal,
            isCurrent,
          });
          if (!fnWidgetCollaborativeStateIdentitiesMatch(
            collaborativeStateBridge.identity,
            collaborativeIdentity,
          )) {
            throw new Error('Widget collaborative state identity mismatch.');
          }
        }

        functionBridge = createWidgetFunctionHostBridge({
          identity: selected.identity,
          transport: this.config.transport,
          functionDescriptors: selected.functionDescriptors,
          createIdempotencyKey: this.config.createIdempotencyKey,
          nowMs: this.config.nowMs,
          wait: this.config.wait,
          isTargetCurrent: isCurrent,
        });
        args.root.replaceChildren();
        args.root.dataset.widgetRuntimeStatus = 'loading';
        args.root.textContent = 'Starting widget runtime…';
        handle = await this.config.mount.mount({
          mode: 'published',
          root: args.root,
          identity: selected.identity,
          artifact: selected.artifact,
          functionDescriptors: selected.functionDescriptors,
          browserFunctionDescriptorsDigestSha256:
            selected.browserFunctionDescriptorsDigestSha256,
          functionBridge,
          collaborativeStateBridge: collaborativeStateBridge ?? null,
          props: pendingProps,
          onFatal: (error) => {
            if (isCatalogInvalidation(error)) {
              const recover = async (): Promise<void> => {
                if (disposed) return;
                await releaseLive('catalog-generation-changed');
                if (disposed) return;
                blocked = false;
                markDeferred('Widget is restarting with updated Capsule policy.');
              };
              const recovery = ownerOperation.then(recover, recover);
              ownerOperation = recovery;
              void recovery.finally(() => {
                void this.#requestPopulationReconcile();
              });
              return;
            }
            fail(error);
            void this.#requestPopulationReconcile();
          },
        });
        if (disposed) {
          await releaseLive('mount-cancelled');
          return false;
        }
        handle.setProps(pendingProps);
        handle.setViewport(pendingViewport);
        if (focused) handle.focus(pendingFocus);
        await handle.ready();
        if (mode === 'frozen') {
          await handle.freeze('population-frozen');
        } else {
          await handle.setSchedulingMode(mode);
        }
        this.assertLoadActive(
          target,
          organizationId,
          tenantAuthorityKey,
          () => disposed,
          abortController.signal,
        );
        currentMode = mode;
        blocked = false;
        args.root.dataset.widgetRuntimeStatus = 'ready';
        return true;
      } catch (error) {
        await releaseLive('mount-failed');
        fail(error);
        return false;
      }
    };
    const applyPopulation = async (
      mode: TWidgetCapsulePopulationMode,
    ): Promise<boolean> => {
      if (disposed) return false;
      const assignmentChanged = assignedMode !== mode;
      assignedMode = mode;
      if (mode === 'inert') {
        const released = await releaseLive(
          pendingViewport.visibility === 'hidden'
            ? 'population-offscreen-release'
            : 'population-capacity-release',
        );
        if (!blocked) markDeferred();
        return assignmentChanged || released;
      }
      if (handle === undefined) {
        if (loaded === undefined) {
          if (!blocked) markDeferred('Widget is waiting to start its Capsule runtime.');
          return assignmentChanged;
        }
        return await mountLoaded(mode) || assignmentChanged;
      }
      if (currentMode === mode) return assignmentChanged;
      try {
        if (mode === 'frozen') {
          await handle.freeze('population-offscreen');
        } else if (currentMode === 'frozen') {
          await handle.resume('population-runnable');
          await handle.setSchedulingMode(mode);
        } else {
          await handle.setSchedulingMode(mode);
        }
        currentMode = mode;
        return true;
      } catch (error) {
        await releaseLive('population-transition-failed');
        fail(error);
        return true;
      }
    };
    const updateViewportTimes = (value: CapsuleViewport): void => {
      const nowMs = this.#nowMs();
      if (value.visibility === 'visible') {
        hiddenSinceMs = null;
        farSinceMs = null;
        return;
      }
      hiddenSinceMs ??= nowMs;
      if (value.distance > WIDGET_UI_RETENTION_RADIUS_PX) {
        farSinceMs ??= nowMs;
      } else {
        farSinceMs = null;
      }
    };

    let queued!: TQueuedLoad;
    const loadArtifact = async (): Promise<void> => {
      let retryDelayMs = this.#loadRetry.initialBackoffMs;
      try {
        args.root.dataset.widgetRuntimeStatus = 'loading';
        args.root.textContent = 'Loading widget…';
        while (true) {
          try {
            loaded = await this.load(
              request,
              target,
              organizationId,
              tenantAuthorityKey,
              () => disposed,
              abortController.signal,
            );
            resourceClass = fnWidgetCapsulePopulationResourceClass(
              loaded.artifact.runtimeDescriptor.target.featureProfiles,
            );
            blocked = false;
            break;
          } catch (error) {
            if (!(error instanceof RecoverableWidgetRuntimeLoadError) || !isCurrent()) throw error;
            if (!queued.wanted) return;
            args.root.textContent = 'Waiting for widget sync…';
            await this.config.wait(retryDelayMs, abortController.signal);
            if (!queued.wanted) return;
            retryDelayMs = Math.min(
              this.#loadRetry.maxBackoffMs,
              Math.max(1, retryDelayMs * 2),
            );
          }
        }
      } catch (error) {
        if (!disposed && !abortController.signal.aborted) fail(error);
      } finally {
        queued.started = false;
        this.#activeLoadCount = Math.max(0, this.#activeLoadCount - 1);
        void this.#requestPopulationReconcile();
      }
    };
    queued = {
      id: populationId,
      cancelled: false,
      started: false,
      wanted: false,
      start: () => {
        if (
          disposed
          || queued.cancelled
          || queued.started
          || loaded !== undefined
          || !queued.wanted
        ) return;
        queued.started = true;
        this.#activeLoadCount += 1;
        loadOperation = loadArtifact();
      },
    };

    const runtime = this;
    const owner: TWidgetUiRuntimeOwnedRender = Object.freeze({
      [WIDGET_UI_POPULATION_SNAPSHOT](): TWidgetCapsulePopulationCandidate {
        return Object.freeze({
          id: populationId,
          order,
          viewport: pendingViewport,
          hardFrozen,
          currentMode,
          resourceClass,
          artifactReady: loaded !== undefined,
          artifactLoading: queued.started,
          blocked,
          hiddenSinceMs,
          farSinceMs,
        });
      },
      [WIDGET_UI_APPLY_POPULATION](mode): Promise<boolean> {
        const operation = ownerOperation.then(
          () => applyPopulation(mode),
          () => applyPopulation(mode),
        );
        ownerOperation = operation;
        return operation;
      },
      [WIDGET_UI_SET_REPRIORITIZATION_RANK](rank): void {
        if (rank === null && !queued.started) {
          queued.wanted = false;
          runtime.#loadQueue.delete(queued);
        }
        if (rank === null && currentMode === 'inert' && !blocked) markDeferred();
      },
      [WIDGET_UI_DROP_LOADED_ARTIFACT](): void {
        if (handle === undefined && !queued.started && assignedMode === 'inert') {
          loaded = undefined;
        }
      },
      [WIDGET_UI_LOAD_ENTRY]: queued,
      setProps(value): void {
        if (disposed) return;
        pendingProps = value;
        handle?.setProps(value);
      },
      setViewport(value): void {
        if (disposed) return;
        pendingViewport = cloneViewport(value);
        updateViewportTimes(pendingViewport);
        handle?.setViewport(pendingViewport);
        void runtime.#requestPopulationReconcile();
      },
      setFocused(value: boolean, options?: FocusOptions): void {
        if (disposed) return;
        focused = value;
        pendingFocus = options;
        if (focused) {
          handle?.focus(options);
          void runtime.#requestPopulationReconcile();
        }
      },
      freeze(): Promise<void> {
        if (disposed) return Promise.resolve();
        hardFrozen = true;
        blocked = false;
        return runtime.#requestPopulationReconcile();
      },
      resume(): Promise<void> {
        if (disposed) return Promise.resolve();
        hardFrozen = false;
        blocked = false;
        return runtime.#requestPopulationReconcile();
      },
      diagnostics: () => handle?.diagnostics() ?? null,
      destroy: (reason = 'widget-unmounted'): Promise<void> => {
        if (disposeOperation !== undefined) return disposeOperation;
        disposed = true;
        queued.cancelled = true;
        queued.wanted = false;
        runtime.#loadQueue.delete(queued);
        runtime.#owners.delete(owner);
        abortController.abort();
        disposeOperation = Promise.allSettled([
          ownerOperation,
          ...(loadOperation === undefined ? [] : [loadOperation]),
        ]).then(async () => {
          await releaseLive(reason);
          loaded = undefined;
          args.root.replaceChildren();
          delete args.root.dataset.widgetRuntimeStatus;
          void runtime.#requestPopulationReconcile();
        });
        return disposeOperation;
      },
    });
    this.#owners.add(owner);
    void this.#requestPopulationReconcile();
    return owner;
  }

  async destroy(reason = 'widget-runtime-stopped'): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#populationRequested = false;
    this.#clearPopulationTimer();
    for (const queued of this.#loadQueue) {
      queued.cancelled = true;
      queued.wanted = false;
    }
    this.#loadQueue.clear();
    await Promise.allSettled([...this.#owners].map((owner) => owner.destroy(reason)));
    await this.#populationOperation?.catch(() => undefined);
    this.#cache.clear();
    this.#reprioritizationCandidateCount = 0;
    await this.config.mount.destroy(reason);
  }

  clearCache(): void {
    this.#cache.clear();
  }

  diagnostics(): Readonly<{
    activeLoadCount: number;
    queuedLoadCount: number;
    mountedOwnerCount: number;
    reprioritizationCandidateCount: number;
    activeRuntimeCount: number;
    throttledRuntimeCount: number;
    frozenRuntimeCount: number;
    liveRuntimeCount: number;
    heavyRuntimeCount: number;
    gpuRuntimeCount: number;
    inFlightArtifactVerificationCount: number;
    maxConcurrentLoads: number;
    maxQueuedLoads: number;
    maxOwnerRecords: number;
    maxReprioritizationCandidates: number;
    maxActiveRuntimes: number;
    maxThrottledRuntimes: number;
    maxFrozenRuntimes: number;
    maxLiveRuntimes: number;
    maxHeavyRuntimes: number;
    maxGpuRuntimes: number;
  }> {
    const snapshots = [...this.#owners].map((owner) => (
      owner[WIDGET_UI_POPULATION_SNAPSHOT]()
    ));
    const live = snapshots.filter(({ currentMode }) => currentMode !== 'inert');
    return Object.freeze({
      activeLoadCount: this.#activeLoadCount,
      queuedLoadCount: this.#loadQueue.size,
      mountedOwnerCount: this.#owners.size,
      reprioritizationCandidateCount: this.#reprioritizationCandidateCount,
      activeRuntimeCount: live.filter(({ currentMode }) => currentMode === 'active').length,
      throttledRuntimeCount: live.filter(({ currentMode }) => (
        currentMode === 'throttled'
      )).length,
      frozenRuntimeCount: live.filter(({ currentMode }) => currentMode === 'frozen').length,
      liveRuntimeCount: live.length,
      heavyRuntimeCount: live.filter(({ resourceClass }) => resourceClass.heavy).length,
      gpuRuntimeCount: live.filter(({ resourceClass }) => resourceClass.gpu).length,
      inFlightArtifactVerificationCount: this.#inFlightArtifacts.size,
      maxConcurrentLoads: this.#maxConcurrentLoads,
      maxQueuedLoads: this.#maxQueuedLoads,
      maxOwnerRecords: WIDGET_UI_MAX_OWNER_RECORDS,
      maxReprioritizationCandidates: WIDGET_UI_MAX_REPRIORITIZATION_CANDIDATES,
      maxActiveRuntimes: WIDGET_UI_MAX_ACTIVE_RUNTIMES,
      maxThrottledRuntimes: WIDGET_UI_MAX_THROTTLED_RUNTIMES,
      maxFrozenRuntimes: WIDGET_UI_MAX_FROZEN_RUNTIMES,
      maxLiveRuntimes: WIDGET_UI_MAX_LIVE_RUNTIMES,
      maxHeavyRuntimes: WIDGET_UI_MAX_HEAVY_RUNTIMES,
      maxGpuRuntimes: WIDGET_UI_MAX_GPU_RUNTIMES,
    });
  }

  #requestPopulationReconcile(): Promise<void> {
    if (this.#destroyed) return Promise.resolve();
    this.#populationRequested = true;
    if (this.#populationOperation !== undefined) return this.#populationOperation;
    const operation = Promise.resolve().then(async () => {
      while (this.#populationRequested && !this.#destroyed) {
        this.#populationRequested = false;
        await this.#reconcilePopulation();
      }
    });
    this.#populationOperation = operation;
    const finalize = () => {
      if (this.#populationOperation === operation) {
        this.#populationOperation = undefined;
      }
      if (this.#populationRequested && !this.#destroyed) {
        void this.#requestPopulationReconcile();
      }
    };
    void operation.then(finalize, finalize);
    return operation;
  }

  async #reconcilePopulation(): Promise<void> {
    const owners = [...this.#owners];
    const ownerSnapshots = owners.map((owner) => Object.freeze({
      owner,
      snapshot: owner[WIDGET_UI_POPULATION_SNAPSHOT](),
    }));
    const snapshots = ownerSnapshots.map(({ snapshot }) => snapshot);
    const plan = fnPlanWidgetCapsulePopulation(snapshots, this.#nowMs());
    this.#reprioritizationCandidateCount = plan.reprioritizationCandidateIds.length;
    const ownerById = new Map(ownerSnapshots.map(({ owner, snapshot }) => [
      snapshot.id,
      owner,
    ]));
    const assignments = new Map(plan.assignments.map(({ id, mode }) => [id, mode]));
    const candidateRanks = new Map(plan.reprioritizationCandidateIds.map((id, rank) => [
      id,
      rank,
    ]));

    for (const { owner, snapshot } of ownerSnapshots) {
      owner[WIDGET_UI_SET_REPRIORITIZATION_RANK](
        candidateRanks.get(snapshot.id) ?? null,
      );
    }

    const released = await Promise.all(ownerSnapshots.map(async ({ owner, snapshot }) => {
      if (assignments.has(snapshot.id)) return false;
      const changed = await owner[WIDGET_UI_APPLY_POPULATION]('inert');
      if (snapshot.artifactReady) owner[WIDGET_UI_DROP_LOADED_ARTIFACT]();
      return changed;
    }));
    for (const { id, mode } of plan.assignments) {
      const owner = ownerById.get(id);
      if (owner === undefined) continue;
      if (await owner[WIDGET_UI_APPLY_POPULATION](mode)) {
        this.#populationRequested = true;
      }
    }
    if (released.some(Boolean)) this.#populationRequested = true;

    this.#syncLoadQueue(plan.loadIds, ownerById);
    this.#schedulePopulationTimer(plan.nextWakeAtMs);
  }

  #syncLoadQueue(
    loadIds: readonly string[],
    ownerById: ReadonlyMap<string, TWidgetUiRuntimeOwnedRender>,
  ): void {
    for (const queued of this.#loadQueue) queued.wanted = false;
    this.#loadQueue.clear();
    const desired = new Set(loadIds);
    for (const owner of this.#owners) {
      const queued = owner[WIDGET_UI_LOAD_ENTRY];
      if (!desired.has(queued.id)) queued.wanted = false;
    }
    for (const id of loadIds) {
      const owner = ownerById.get(id);
      if (owner === undefined) continue;
      const queued = owner[WIDGET_UI_LOAD_ENTRY];
      if (queued.cancelled) continue;
      queued.wanted = true;
      if (queued.started) continue;
      if (this.#activeLoadCount < this.#maxConcurrentLoads) {
        queued.start();
      } else if (this.#loadQueue.size < this.#maxQueuedLoads) {
        this.#loadQueue.add(queued);
      }
    }
  }

  #schedulePopulationTimer(atMs: number | null): void {
    if (this.#destroyed || atMs === this.#populationTimerAtMs) return;
    this.#clearPopulationTimer();
    if (atMs === null) return;
    const delayMs = Math.max(0, atMs - this.#nowMs());
    this.#populationTimerAtMs = atMs;
    this.#populationTimer = this.config.scheduleTimeout(() => {
      this.#populationTimer = undefined;
      this.#populationTimerAtMs = null;
      void this.#requestPopulationReconcile();
    }, delayMs);
  }

  #clearPopulationTimer(): void {
    if (this.#populationTimer !== undefined) {
      this.config.cancelTimeout(this.#populationTimer);
    }
    this.#populationTimer = undefined;
    this.#populationTimerAtMs = null;
  }

  private async load(
    request: ReturnType<typeof fnWidgetRuntimeLoadRequest>,
    target: TWidgetRuntimeLocalTarget,
    organizationId: string,
    tenantAuthorityKey: string,
    isCancelled: () => boolean,
    signal: AbortSignal,
  ): Promise<TLoadedWidget> {
    this.assertLoadActive(
      target,
      organizationId,
      tenantAuthorityKey,
      isCancelled,
      signal,
    );
    let error: unknown;
    let response: Awaited<ReturnType<
      TWidgetRuntimeTransportPort['api']['widget']['runtime']['load']
    >>[1];
    try {
      [error, response] = await this.config.transport.api.widget.runtime.load(request, {
        signal,
      });
    } catch (transportError) {
      error = transportError;
      response = undefined;
    }
    this.assertLoadActive(
      target,
      organizationId,
      tenantAuthorityKey,
      isCancelled,
      signal,
    );
    if (error || !response) {
      if (isRecoverableLoadError(error) && this.config.isTargetCurrent !== undefined) {
        throw new RecoverableWidgetRuntimeLoadError(
          'Widget runtime target is temporarily unavailable.',
        );
      }
      throw new Error('Widget runtime target is unavailable.');
    }
    const identity = Object.freeze({
      ...response.identity,
      orgId: organizationId,
    });
    if (!fnWidgetRuntimeIdentityMatches(identity, request)) {
      throw new Error('Widget runtime returned a different pinned identity.');
    }

    const cacheKey = fnWidgetUiArtifactCacheKey({
      identity,
      tenantAuthorityKey,
      digestSha256: response.artifact.digestSha256,
      capsuleArtifactHash: response.runtimeDescriptor.capsuleArtifactHash,
    });
    let artifact = this.#cache.get(cacheKey);
    if (!artifact) {
      let pending = this.#inFlightArtifacts.get(cacheKey);
      if (!pending) {
        pending = fxDecodeAndVerifyUiArtifact({ codec: this.config.codec }, {
          expectedDigestSha256: response.artifact.digestSha256,
          expectedCapsuleArtifactHash: response.runtimeDescriptor.capsuleArtifactHash,
          bytesBase64: response.artifact.bytesBase64,
          runtimeDescriptor: response.runtimeDescriptor,
        }).then((verified) => {
          this.#cache.set(cacheKey, verified);
          return verified;
        }).finally(() => {
          this.#inFlightArtifacts.delete(cacheKey);
        });
        this.#inFlightArtifacts.set(cacheKey, pending);
      }
      artifact = await pending;
    }
    this.assertLoadActive(
      target,
      organizationId,
      tenantAuthorityKey,
      isCancelled,
      signal,
    );
    return Object.freeze({
      artifact,
      collaborativeState:
        response.manifest.ui.state?.collaborative === true,
      functionDescriptors: response.functionDescriptors,
      browserFunctionDescriptorsDigestSha256:
        response.browserFunctionDescriptorsDigestSha256,
      identity,
    });
  }

  private assertTargetCurrent(target: TWidgetRuntimeLocalTarget): void {
    if (this.config.isTargetCurrent && !this.config.isTargetCurrent(target)) {
      throw new Error('Widget runtime target is no longer current.');
    }
  }

  private isTenantAuthorityCurrent(
    organizationId: string,
    tenantAuthorityKey: string,
  ): boolean {
    return this.#readOrganizationId() === organizationId
      && this.#readTenantAuthorityKey() === tenantAuthorityKey;
  }

  private assertLoadActive(
    target: TWidgetRuntimeLocalTarget,
    organizationId: string,
    tenantAuthorityKey: string,
    isCancelled: () => boolean,
    signal: AbortSignal,
  ): void {
    if (isCancelled() || signal.aborted) {
      throw new Error('Widget runtime load was cancelled.');
    }
    if (!this.isTenantAuthorityCurrent(organizationId, tenantAuthorityKey)) {
      throw new Error('Widget runtime tenant scope changed.');
    }
    this.assertTargetCurrent(target);
  }

  #nowMs(): number {
    const value = this.config.nowMs();
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Widget runtime clock is invalid.');
    }
    return value;
  }

  #readOrganizationId(): string {
    const organizationId = this.config.organizationId();
    if (
      typeof organizationId !== 'string'
      || organizationId.length < 1
      || organizationId.length > 200
    ) {
      throw new Error('Widget runtime tenant scope is invalid.');
    }
    return organizationId;
  }

  #readTenantAuthorityKey(): string {
    const tenantAuthorityKey = this.config.tenantAuthorityKey();
    if (
      typeof tenantAuthorityKey !== 'string'
      || tenantAuthorityKey.length < 1
      || tenantAuthorityKey.length > 1_000
    ) {
      throw new Error('Widget runtime tenant authority is invalid.');
    }
    return tenantAuthorityKey;
  }
}
