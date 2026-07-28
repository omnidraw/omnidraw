/**
 * @file Tenant-qualified single-flight cache for immutable unsigned widget constructions.
 */

import { createHash } from 'node:crypto';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { fnWidgetPreviewConstructionKey } from '../core/fn.preview-build-key';
import type {
  IWidgetArtifactConstructionBuilder,
  TWidgetArtifactConstructionRequest,
  TWidgetArtifactConstructionResult,
  TWidgetArtifactConstructionSignRequest,
  TWidgetBuildRequest,
  TWidgetBuildResult,
} from '..';

export type TWidgetArtifactConstructionCacheConfig = Readonly<{
  builder: IWidgetArtifactConstructionBuilder;
  environmentIdentity: string;
  maxEntries?: number;
}>;

type TCacheEntry = {
  readonly controller: AbortController;
  readonly demands: Set<TCacheDemand>;
  latestProgress?: TConstructionProgress;
  promise: Promise<TWidgetArtifactConstructionResult>;
  settled: boolean;
};

type TConstructionProgress = Parameters<
  NonNullable<TWidgetArtifactConstructionRequest['reportProgress']>
>[0];

type TCacheDemand = Readonly<{
  reportProgress?: TWidgetArtifactConstructionRequest['reportProgress'];
}>;

function cancellationReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  return Object.assign(
    new Error('Widget artifact construction demand was cancelled.'),
    { name: 'AbortError' },
  );
}

function lifecycleAbortReason(message: string): Error {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

function reportProgress(
  demand: TCacheDemand,
  phase: TConstructionProgress,
): void {
  try {
    demand.reportProgress?.(phase);
  } catch {
    // Progress observers cannot take down a construction shared by other owners.
  }
}

function cacheKey(
  tenant: TTenantContext,
  request: TWidgetArtifactConstructionRequest,
  environmentIdentity: string,
): string {
  return fnWidgetPreviewConstructionKey({
    input: {
      tenant: {
        orgId: tenant.orgId,
        accountId: tenant.accountId,
        cellId: tenant.cellId,
        placementEpoch: tenant.placementEpoch,
      },
      sourceDigestSha256: request.snapshot.digestSha256,
      canonicalManifestJson: request.canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      environmentIdentity,
    },
    digestSha256: (value) => createHash('sha256').update(value).digest('hex'),
  });
}

/**
 * Reuses construction only. Preview and release signing always remain separate
 * trusted operations over the cached unsigned result.
 */
export class WidgetArtifactConstructionCache
implements IWidgetArtifactConstructionBuilder {
  readonly #maxEntries: number;
  readonly #environmentIdentity: string;
  readonly #entries = new Map<string, TCacheEntry>();

  constructor(readonly config: TWidgetArtifactConstructionCacheConfig) {
    const environmentIdentity = config.environmentIdentity.trim();
    if (environmentIdentity.length === 0 || environmentIdentity.length > 1_000) {
      throw new TypeError('Widget build environment identity is invalid.');
    }
    this.#environmentIdentity = environmentIdentity;
    const maxEntries = config.maxEntries ?? 64;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1_024) {
      throw new TypeError('Widget construction cache entry limit is invalid.');
    }
    this.#maxEntries = maxEntries;
  }

  async build(
    tenant: TTenantContext,
    request: TWidgetBuildRequest,
  ): Promise<TWidgetBuildResult> {
    const construction = await this.construct(tenant, {
      snapshot: request.snapshot,
      manifest: request.manifest,
      canonicalManifestJson: request.canonicalManifestJson,
      builderIdentity: request.builderIdentity,
      capsuleBuildIdentity: request.capsuleBuildIdentity,
      buildPolicyId: request.buildPolicyId,
      ...(request.workspaceKey === undefined ? {} : { workspaceKey: request.workspaceKey }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.reportProgress === undefined
        ? {}
        : { reportProgress: request.reportProgress }),
    });
    return this.signConstruction(tenant, {
      construction,
      signingPurpose: request.signingPurpose,
    });
  }

  construct(
    tenant: TTenantContext,
    request: TWidgetArtifactConstructionRequest,
  ): Promise<TWidgetArtifactConstructionResult> {
    if (request.signal?.aborted) {
      return Promise.reject(cancellationReason(request.signal));
    }
    const key = cacheKey(tenant, request, this.#environmentIdentity);
    const cached = this.#entries.get(key);
    if (cached) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return this.#join(key, cached, request);
    }

    const controller = new AbortController();
    const demands = new Set<TCacheDemand>();
    let entry: TCacheEntry;
    const {
      signal: _callerSignal,
      reportProgress: _callerProgress,
      ...sharedRequest
    } = request;
    const construction = Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        throw cancellationReason(controller.signal);
      }
      return this.config.builder.construct(tenant, {
        ...sharedRequest,
        signal: controller.signal,
        reportProgress: (phase) => {
          entry.latestProgress = phase;
          for (const demand of entry.demands) reportProgress(demand, phase);
        },
      });
    });
    entry = {
      controller,
      demands,
      promise: construction,
      settled: false,
    };
    entry.promise = construction.then(
      (result) => {
        entry.settled = true;
        this.#evictSettledEntries();
        return result;
      },
      (error) => {
        entry.settled = true;
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
        this.#evictSettledEntries();
        throw error;
      },
    );
    this.#entries.set(key, entry);
    this.#evictSettledEntries();
    return this.#join(key, entry, request);
  }

  #evictSettledEntries(): void {
    while (this.#entries.size > this.#maxEntries) {
      let evicted = false;
      for (const [key, entry] of this.#entries) {
        if (!entry.settled) continue;
        this.#entries.delete(key);
        evicted = true;
        break;
      }
      if (!evicted) return;
    }
  }

  #abortAndClear(reason: unknown): Promise<TWidgetArtifactConstructionResult>[] {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    const pending: Promise<TWidgetArtifactConstructionResult>[] = [];
    for (const entry of entries) {
      if (entry.settled) continue;
      pending.push(entry.promise);
      if (!entry.controller.signal.aborted) entry.controller.abort(reason);
    }
    return pending;
  }

  #join(
    key: string,
    entry: TCacheEntry,
    request: TWidgetArtifactConstructionRequest,
  ): Promise<TWidgetArtifactConstructionResult> {
    const signal = request.signal;
    if (signal?.aborted) {
      return Promise.reject(cancellationReason(signal));
    }
    const demand: TCacheDemand = {
      ...(request.reportProgress === undefined
        ? {}
        : { reportProgress: request.reportProgress }),
    };
    entry.demands.add(demand);
    if (entry.latestProgress !== undefined) {
      reportProgress(demand, entry.latestProgress);
    }

    return new Promise((resolve, reject) => {
      let released = false;
      const release = (reason?: unknown): void => {
        if (released) return;
        released = true;
        signal?.removeEventListener('abort', onAbort);
        entry.demands.delete(demand);
        if (entry.settled || entry.demands.size > 0) return;
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
        if (!entry.controller.signal.aborted) entry.controller.abort(reason);
      };
      const onAbort = (): void => {
        const reason = cancellationReason(signal!);
        release(reason);
        reject(reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (result) => {
          if (released) return;
          release();
          resolve(result);
        },
        (error) => {
          if (released) return;
          release();
          reject(error);
        },
      );
    });
  }

  signConstruction(
    tenant: TTenantContext,
    request: TWidgetArtifactConstructionSignRequest,
  ): Promise<TWidgetBuildResult> {
    return this.config.builder.signConstruction(tenant, request);
  }

  closeWorkspace(
    tenant: TTenantContext,
    request: Readonly<{ workspaceKey: string }>,
  ): Promise<void> {
    return this.config.builder.closeWorkspace?.(tenant, request) ?? Promise.resolve();
  }

  clear(): void {
    const pending = this.#abortAndClear(lifecycleAbortReason(
      'Widget artifact construction cache was cleared.',
    ));
    void Promise.allSettled(pending);
  }

  async close(): Promise<void> {
    const pending = this.#abortAndClear(lifecycleAbortReason(
      'Widget artifact construction cache was closed.',
    ));
    const closeBuilder = this.config.builder.close?.bind(this.config.builder);
    if (closeBuilder === undefined) {
      void Promise.allSettled(pending);
      return;
    }
    const builderClose = Promise.resolve().then(closeBuilder);
    const settlements = await Promise.allSettled([...pending, builderClose]);
    const closeSettlement = settlements[settlements.length - 1];
    if (closeSettlement?.status === 'rejected') throw closeSettlement.reason;
  }
}
