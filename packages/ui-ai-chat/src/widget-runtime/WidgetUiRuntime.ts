import { createWidgetFunctionHostBridge } from './create-widget-function-host-bridge';
import { fxDecodeAndVerifyUiArtifact } from './fx.decode-and-verify-ui-artifact';
import { fnWidgetCollaborativeStateIdentitiesMatch } from './fn.collaborative-state-json';
import { fnWidgetUiArtifactCacheKey } from './fn.artifact-cache-key';
import {
  fnWidgetRuntimeIdentityMatches,
  fnWidgetRuntimeLocalTarget,
  fnWidgetRuntimeLoadRequest,
} from './fn.runtime-identity';
import type {
  TWidgetArtifactCodecPort,
  TWidgetCollaborativeStatePort,
  TWidgetCollaborativeStateSession,
  TWidgetRuntimeTransportPort,
  TWidgetRuntimeLocalTarget,
  TWidgetUiArtifactMountPort,
  TWidgetUiRuntimeRenderArgs,
  TVerifiedWidgetUiArtifact,
} from './interface';
import { WidgetUiArtifactCache } from './WidgetUiArtifactCache';
import {
  WIDGET_UI_MAX_ACTIVE_RENDERS,
  WIDGET_UI_MAX_QUEUED_RENDERS,
} from './CONSTANTS';

type TWidgetUiRuntimeConfig = Readonly<{
  transport: TWidgetRuntimeTransportPort;
  codec: TWidgetArtifactCodecPort;
  mount: TWidgetUiArtifactMountPort;
  createIdempotencyKey(): string;
  organizationId(): string;
  tenantAuthorityKey(): string;
  nowMs(): number;
  wait(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  collaborativeState?: TWidgetCollaborativeStatePort;
  isTargetCurrent?(target: TWidgetRuntimeLocalTarget): boolean;
  loadRetry?: Readonly<{
    initialBackoffMs?: number;
    maxBackoffMs?: number;
  }>;
  cache?: WidgetUiArtifactCache;
  maxActiveRenders?: number;
  maxQueuedRenders?: number;
  recoveryPaceMs?: number;
}>;

type TLoadRetry = Readonly<{
  initialBackoffMs: number;
  maxBackoffMs: number;
}>;

type TQueuedRender = {
  cancelled: boolean;
  start(): void;
};

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Widget UI artifact could not be loaded.';
}

export class WidgetUiRuntime {
  readonly #cache: WidgetUiArtifactCache;
  readonly #inFlightArtifacts = new Map<string, Promise<TVerifiedWidgetUiArtifact>>();
  readonly #loadRetry: TLoadRetry;
  readonly #maxActiveRenders: number;
  readonly #maxQueuedRenders: number;
  readonly #recoveryPaceMs: number;
  readonly #renderQueue = new Set<TQueuedRender>();
  readonly #recoveringRenders = new Set<TQueuedRender>();
  #recoveryPaceTail: Promise<void> = Promise.resolve();
  #activeRenderCount = 0;
  #loadOutage = false;

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
    const maxActiveRenders = config.maxActiveRenders ?? WIDGET_UI_MAX_ACTIVE_RENDERS;
    if (
      !Number.isInteger(maxActiveRenders)
      || maxActiveRenders < 1
      || maxActiveRenders > 256
    ) {
      throw new TypeError('Widget runtime active render limit is invalid.');
    }
    const maxQueuedRenders = config.maxQueuedRenders ?? WIDGET_UI_MAX_QUEUED_RENDERS;
    if (
      !Number.isInteger(maxQueuedRenders)
      || maxQueuedRenders < 0
      || maxQueuedRenders > 10_000
    ) {
      throw new TypeError('Widget runtime render queue limit is invalid.');
    }
    const recoveryPaceMs = config.recoveryPaceMs ?? 100;
    if (!Number.isInteger(recoveryPaceMs) || recoveryPaceMs < 1 || recoveryPaceMs > 5_000) {
      throw new TypeError('Widget runtime recovery pace is invalid.');
    }
    this.#loadRetry = Object.freeze({ initialBackoffMs, maxBackoffMs });
    this.#maxActiveRenders = maxActiveRenders;
    this.#maxQueuedRenders = maxQueuedRenders;
    this.#recoveryPaceMs = recoveryPaceMs;
  }

  render(args: TWidgetUiRuntimeRenderArgs): () => void {
    if (this.#admittedRenderCount() >= this.#maxActiveRenders + this.#maxQueuedRenders) {
      let disposed = false;
      args.root.dataset.widgetRuntimeStatus = 'deferred';
      args.root.textContent = 'Widget rendering is deferred until it re-enters the visible canvas.';
      return () => {
        if (disposed) return;
        disposed = true;
        args.root.replaceChildren();
        delete args.root.dataset.widgetRuntimeStatus;
      };
    }
    const target = fnWidgetRuntimeLocalTarget({ canvasId: args.canvasId, element: args.element });
    let disposed = false;
    let cleanupMount: (() => void) | undefined;
    let functionBridge: ReturnType<typeof createWidgetFunctionHostBridge> | undefined;
    let collaborativeStateBridge: TWidgetCollaborativeStateSession | undefined;
    let active = false;
    let fatal = false;
    let loadsInProgress = 0;
    let recoveryWaitInProgress = false;
    let recoveryDelayMs = this.#loadRetry.initialBackoffMs;
    const abortController = new AbortController();
    args.root.dataset.widgetRuntimeStatus = 'loading';
    args.root.textContent = 'Waiting to render widget…';

    const request = fnWidgetRuntimeLoadRequest({
      canvasId: target.canvasId,
      elementId: target.elementId,
      definitionId: target.definitionId,
      revisionId: target.revisionId,
      widgetInstanceId: target.widgetInstanceId,
    });
    const organizationId = this.#readOrganizationId();
    const tenantAuthorityKey = this.#readTenantAuthorityKey();

    const releaseRenderSlot = () => {
      if (!active) return;
      active = false;
      this.#activeRenderCount -= 1;
      this.#drainRenderQueue();
    };
    const failRender = (error: unknown) => {
      this.#recoveringRenders.delete(queuedRender);
      args.root.dataset.widgetRuntimeStatus = 'error';
      args.root.textContent = errorMessage(error);
      releaseRenderSlot();
    };
    const canRecover = () => !disposed
      && !abortController.signal.aborted
      && this.config.isTargetCurrent !== undefined
      && this.#isTenantAuthorityCurrent(organizationId, tenantAuthorityKey)
      && this.config.isTargetCurrent(target);
    const scheduleRecovery = () => {
      if (disposed || recoveryWaitInProgress || queuedRender.cancelled) return;
      if (!canRecover()) {
        failRender(new Error('Widget runtime target is no longer current.'));
        return;
      }
      recoveryWaitInProgress = true;
      this.#recoveringRenders.add(queuedRender);
      args.root.dataset.widgetRuntimeStatus = 'loading';
      args.root.textContent = 'Waiting for widget sync…';
      const delayMs = recoveryDelayMs;
      recoveryDelayMs = Math.min(
        this.#loadRetry.maxBackoffMs,
        Math.max(1, recoveryDelayMs * 2),
      );
      void this.config.wait(delayMs, abortController.signal).then(() => {
        recoveryWaitInProgress = false;
        if (disposed || queuedRender.cancelled) return;
        if (!canRecover()) {
          failRender(new Error('Widget runtime target is no longer current.'));
          return;
        }
        this.#recoveringRenders.delete(queuedRender);
        this.#renderQueue.add(queuedRender);
        this.#drainRenderQueue();
      }).catch((error) => {
        recoveryWaitInProgress = false;
        if (disposed || abortController.signal.aborted) return;
        failRender(error);
      });
    };
    const queuedRender: TQueuedRender = {
      cancelled: false,
      start: () => {
        if (disposed || queuedRender.cancelled) return;
        active = true;
        loadsInProgress += 1;
        this.#activeRenderCount += 1;
        args.root.textContent = this.#loadOutage
          ? 'Waiting for widget recovery admission…'
          : 'Loading widget…';
        const load = this.#loadOutage
          ? this.#waitForRecoveryPace(abortController.signal).then(() => this.#load(
              request,
              target,
              organizationId,
              tenantAuthorityKey,
              () => disposed,
              abortController.signal,
            ))
          : this.#load(
              request,
              target,
              organizationId,
              tenantAuthorityKey,
              () => disposed,
              abortController.signal,
            );
        void load.then(async ({
          artifact,
          functionDescriptors,
          identity,
        }) => {
          this.#loadOutage = false;
          if (disposed) return;
          this.#assertLoadActive(
            target,
            organizationId,
            tenantAuthorityKey,
            () => disposed,
            abortController.signal,
          );
          if (target.stateDocumentId !== null) {
            if (!this.config.collaborativeState) {
              throw new Error('Widget collaborative state capability is unavailable.');
            }
            const collaborativeIdentity = Object.freeze({
              ...identity,
              stateDocumentId: target.stateDocumentId,
            });
            collaborativeStateBridge = await this.config.collaborativeState.open({
              identity: collaborativeIdentity,
              signal: abortController.signal,
              isCurrent: () => !disposed
                && !abortController.signal.aborted
                && this.#isTenantAuthorityCurrent(organizationId, tenantAuthorityKey)
                && (this.config.isTargetCurrent?.(target) ?? true),
            });
            if (!fnWidgetCollaborativeStateIdentitiesMatch(
              collaborativeStateBridge.identity,
              collaborativeIdentity,
            )) {
              collaborativeStateBridge.dispose();
              collaborativeStateBridge = undefined;
              throw new Error('Widget collaborative state identity mismatch.');
            }
            if (disposed || abortController.signal.aborted) {
              collaborativeStateBridge.dispose();
              collaborativeStateBridge = undefined;
              return;
            }
          }
          this.#assertLoadActive(
            target,
            organizationId,
            tenantAuthorityKey,
            () => disposed,
            abortController.signal,
          );
          args.root.replaceChildren();
          functionBridge = createWidgetFunctionHostBridge({
            identity,
            transport: this.config.transport,
            functionDescriptors,
            createIdempotencyKey: this.config.createIdempotencyKey,
            nowMs: this.config.nowMs,
            wait: this.config.wait,
            isTargetCurrent: () => !disposed
              && !abortController.signal.aborted
              && this.#isTenantAuthorityCurrent(organizationId, tenantAuthorityKey)
              && (this.config.isTargetCurrent?.(target) ?? true),
          });
          cleanupMount = this.config.mount.mount({
            root: args.root,
            identity,
            artifact,
            functionBridge,
            collaborativeStateBridge: collaborativeStateBridge ?? null,
            onFatal: (error) => {
              if (disposed || fatal) return;
              fatal = true;
              functionBridge?.dispose();
              functionBridge = undefined;
              collaborativeStateBridge?.dispose();
              collaborativeStateBridge = undefined;
              args.root.dataset.widgetRuntimeStatus = 'error';
              args.root.textContent = errorMessage(error);
              releaseRenderSlot();
            },
          });
          if (!fatal) args.root.dataset.widgetRuntimeStatus = 'ready';
        }).catch((error) => {
          if (disposed) return;
          functionBridge?.dispose();
          functionBridge = undefined;
          collaborativeStateBridge?.dispose();
          collaborativeStateBridge = undefined;
          if (error instanceof RecoverableWidgetRuntimeLoadError && canRecover()) {
            this.#loadOutage = true;
            releaseRenderSlot();
            scheduleRecovery();
            return;
          }
          failRender(error);
        }).finally(() => {
          loadsInProgress -= 1;
          if (disposed) releaseRenderSlot();
        });
      },
    };
    this.#renderQueue.add(queuedRender);
    this.#drainRenderQueue();

    return () => {
      if (disposed) return;
      disposed = true;
      queuedRender.cancelled = true;
      this.#renderQueue.delete(queuedRender);
      this.#recoveringRenders.delete(queuedRender);
      abortController.abort();
      functionBridge?.dispose();
      functionBridge = undefined;
      collaborativeStateBridge?.dispose();
      collaborativeStateBridge = undefined;
      cleanupMount?.();
      cleanupMount = undefined;
      if (loadsInProgress === 0) releaseRenderSlot();
      args.root.replaceChildren();
      delete args.root.dataset.widgetRuntimeStatus;
    };
  }

  clearCache(): void {
    this.#cache.clear();
  }

  diagnostics(): Readonly<{
    activeRenderCount: number;
    queuedRenderCount: number;
    recoveringRenderCount: number;
    inFlightArtifactVerificationCount: number;
    maxActiveRenders: number;
    maxQueuedRenders: number;
  }> {
    return Object.freeze({
      activeRenderCount: this.#activeRenderCount,
      queuedRenderCount: this.#renderQueue.size,
      recoveringRenderCount: this.#recoveringRenders.size,
      inFlightArtifactVerificationCount: this.#inFlightArtifacts.size,
      maxActiveRenders: this.#maxActiveRenders,
      maxQueuedRenders: this.#maxQueuedRenders,
    });
  }

  #drainRenderQueue(): void {
    while (
      this.#activeRenderCount < this.#maxActiveRenders
      && this.#renderQueue.size > 0
    ) {
      const queued = this.#renderQueue.values().next().value as TQueuedRender;
      this.#renderQueue.delete(queued);
      if (queued.cancelled) continue;
      queued.start();
    }
  }

  #admittedRenderCount(): number {
    return this.#activeRenderCount + this.#renderQueue.size + this.#recoveringRenders.size;
  }

  #waitForRecoveryPace(signal: AbortSignal): Promise<void> {
    const previous = this.#recoveryPaceTail;
    let release!: () => void;
    this.#recoveryPaceTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        if (signal.aborted) throw new Error('Widget runtime recovery was cancelled.');
        await this.config.wait(this.#recoveryPaceMs, signal);
        if (signal.aborted) throw new Error('Widget runtime recovery was cancelled.');
      } finally {
        release();
      }
    });
  }

  async #load(
    request: ReturnType<typeof fnWidgetRuntimeLoadRequest>,
    target: TWidgetRuntimeLocalTarget,
    organizationId: string,
    tenantAuthorityKey: string,
    isCancelled: () => boolean,
    signal: AbortSignal,
  ) {
    this.#assertLoadActive(
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
    this.#assertLoadActive(
      target,
      organizationId,
      tenantAuthorityKey,
      isCancelled,
      signal,
    );
    if (error || !response) {
      if (isRecoverableLoadError(error) && this.config.isTargetCurrent !== undefined) {
        throw new RecoverableWidgetRuntimeLoadError('Widget runtime target is temporarily unavailable.');
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
      digestSha256: response.artifact.digestSha256,
    });
    let artifact = this.#cache.get(cacheKey);
    if (!artifact) {
      let pending = this.#inFlightArtifacts.get(cacheKey);
      if (!pending) {
        pending = fxDecodeAndVerifyUiArtifact({ codec: this.config.codec }, {
          expectedDigestSha256: response.artifact.digestSha256,
          bytesBase64: response.artifact.bytesBase64,
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
    this.#assertLoadActive(
      target,
      organizationId,
      tenantAuthorityKey,
      isCancelled,
      signal,
    );
    return {
      artifact,
      functionDescriptors: response.functionDescriptors,
      identity,
    };
  }

  #assertTargetCurrent(target: TWidgetRuntimeLocalTarget): void {
    if (this.config.isTargetCurrent && !this.config.isTargetCurrent(target)) {
      throw new Error('Widget runtime target is no longer current.');
    }
  }

  #isTenantAuthorityCurrent(organizationId: string, tenantAuthorityKey: string): boolean {
    return this.#readOrganizationId() === organizationId
      && this.#readTenantAuthorityKey() === tenantAuthorityKey;
  }

  #assertLoadActive(
    target: TWidgetRuntimeLocalTarget,
    organizationId: string,
    tenantAuthorityKey: string,
    isCancelled: () => boolean,
    signal: AbortSignal,
  ): void {
    if (isCancelled() || signal.aborted) {
      throw new Error('Widget runtime load was cancelled.');
    }
    if (!this.#isTenantAuthorityCurrent(organizationId, tenantAuthorityKey)) {
      throw new Error('Widget runtime tenant scope changed.');
    }
    this.#assertTargetCurrent(target);
  }

  #readOrganizationId(): string {
    const organizationId = this.config.organizationId();
    if (typeof organizationId !== 'string' || organizationId.length < 1 || organizationId.length > 200) {
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
