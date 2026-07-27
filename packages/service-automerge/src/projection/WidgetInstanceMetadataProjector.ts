import { isValidAutomergeUrl } from '@automerge/automerge-repo';
import { fnFreezeTenantContext, fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import { DEFAULT_AUTOMERGE_MAX_ACTIVE_DOCUMENTS } from '../CONSTANTS';
import {
  fnWidgetInstanceProjectionContentIdentity,
  fnWidgetInstanceProjectionSnapshot,
} from './fn.widget-instance-projection';
import type {
  TWidgetInstanceMetadataProjectorDiagnostics,
  TWidgetInstanceMetadataProjectorPortal,
  TWidgetInstanceProjectionApplyResult,
  TWidgetInstanceProjectionEnqueueResult,
  TWidgetInstanceProjectionSnapshot,
  TWidgetInstanceProjectionSource,
} from './interface';

type TPendingProjection = Readonly<{
  key: string;
  contentIdentity: string;
  tenant: TTenantContext;
  snapshot: TWidgetInstanceProjectionSnapshot;
}>;

type TQuarantinedProjection = Readonly<{
  key: string;
  orgId: string;
  canvasId: string;
  sourceSequence: number | null;
  reason: string;
  retrySameSequence: boolean;
  contentIdentity: string | null;
}>;

export type TWidgetInstanceMetadataProjectorOptions = Readonly<{
  batchSize?: number;
  maxRetainedCanvases?: number;
}>;

/**
 * Coalesces durable-canvas snapshots behind the rendering path. Enqueue is
 * synchronous and never awaits metadata I/O; drain/stop are the loss barrier.
 */
export class WidgetInstanceMetadataProjector {
  readonly name = 'widgetInstanceProjection' as const;
  readonly #portal: TWidgetInstanceMetadataProjectorPortal;
  readonly #batchSize: number;
  readonly #maxRetainedCanvases: number;
  readonly #pending = new Map<string, TPendingProjection>();
  readonly #quarantined = new Map<string, TQuarantinedProjection>();
  readonly #settledSourceSequences = new Map<string, number>();
  readonly #retainedCanvasOrder = new Map<string, true>();
  readonly #inFlightCanvasKeys = new Set<string>();
  readonly #canvasIdleWaiters = new Map<string, Set<() => void>>();
  readonly #releasingCanvasKeys = new Set<string>();
  #pump: Promise<void> | null = null;
  #failure: unknown = null;
  #accepting = true;
  #inFlightSnapshotCount = 0;
  #appliedSnapshotCount = 0;
  #replayedSnapshotCount = 0;
  #staleSnapshotCount = 0;
  #coalescedSnapshotCount = 0;
  #batchCount = 0;
  #rejectedSnapshotCount = 0;
  #lastRejection: string | null = null;

  constructor(
    portal: TWidgetInstanceMetadataProjectorPortal,
    options: TWidgetInstanceMetadataProjectorOptions = {},
  ) {
    this.#portal = portal;
    this.#batchSize = options.batchSize ?? 16;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 100) {
      throw new RangeError('Widget instance projection batch size must be between 1 and 100.');
    }
    this.#maxRetainedCanvases = options.maxRetainedCanvases
      ?? DEFAULT_AUTOMERGE_MAX_ACTIVE_DOCUMENTS;
    if (
      !Number.isInteger(this.#maxRetainedCanvases)
      || this.#maxRetainedCanvases < 1
      || this.#maxRetainedCanvases > 10_000
    ) {
      throw new RangeError(
        'Widget instance projection retained canvas capacity must be between 1 and 10000.',
      );
    }
  }

  enqueue(
    tenant: TTenantContext,
    source: TWidgetInstanceProjectionSource,
  ): TWidgetInstanceProjectionEnqueueResult {
    if (!this.#accepting) throw new Error('Widget instance metadata projector is stopping.');
    if (this.#failure !== null) throw this.#failure;
    const observedNowMs = this.#portal.nowMs();
    if (!Number.isSafeInteger(observedNowMs) || observedNowMs < 0) {
      throw new RangeError('Widget instance projection clock returned an invalid timestamp.');
    }
    let snapshot: TWidgetInstanceProjectionSnapshot;
    try {
      snapshot = fnWidgetInstanceProjectionSnapshot(source, observedNowMs, isValidAutomergeUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Widget instance projection input is invalid.';
      this.#rejectedSnapshotCount += 1;
      this.#lastRejection = reason;
      const canvasId = typeof source.canvasId === 'string' ? source.canvasId : '';
      const sourceSequence = Number.isSafeInteger(source.sourceSequence) && source.sourceSequence >= 0
        ? source.sourceSequence
        : null;
      const key = fnScopedKey('widget-instance-projection', [tenant.orgId, canvasId]);
      if (this.#releasingCanvasKeys.has(key)) {
        const releaseReason = 'Widget instance projection canvas is being released.';
        this.#rejectedSnapshotCount += 1;
        this.#lastRejection = releaseReason;
        return Object.freeze({
          status: 'rejected' as const,
          canvasId,
          sourceSequence,
          reason: releaseReason,
        });
      }
      const settledSourceSequence = this.#settledSourceSequences.get(key);
      if (settledSourceSequence !== undefined || this.#quarantined.has(key)) {
        this.#touchRetainedCanvas(key);
      }
      const pendingSourceSequence = this.#pending.get(key)?.snapshot.sourceSequence;
      if (
        (sourceSequence === null || settledSourceSequence === undefined || sourceSequence > settledSourceSequence)
        && (sourceSequence === null || pendingSourceSequence === undefined || sourceSequence >= pendingSourceSequence)
      ) {
        this.#recordQuarantine({
          key,
          orgId: tenant.orgId,
          canvasId,
          sourceSequence,
          reason,
          retrySameSequence: false,
          contentIdentity: null,
        });
      }
      return Object.freeze({
        status: 'quarantined' as const,
        canvasId,
        sourceSequence,
        reason,
      });
    }
    const key = fnScopedKey('widget-instance-projection', [tenant.orgId, snapshot.canvasId]);
    if (this.#releasingCanvasKeys.has(key)) {
      const reason = 'Widget instance projection canvas is being released.';
      this.#rejectedSnapshotCount += 1;
      this.#lastRejection = reason;
      return Object.freeze({
        status: 'rejected' as const,
        canvasId: snapshot.canvasId,
        sourceSequence: snapshot.sourceSequence,
        reason,
      });
    }
    const contentIdentity = fnWidgetInstanceProjectionContentIdentity(snapshot);
    const pending = this.#pending.get(key);
    if (pending !== undefined) {
      if (pending.snapshot.sourceSequence > snapshot.sourceSequence) {
        this.#coalescedSnapshotCount += 1;
        return Object.freeze({
          status: 'queued' as const,
          canvasId: pending.snapshot.canvasId,
          sourceSequence: pending.snapshot.sourceSequence,
        });
      }
      if (pending.snapshot.sourceSequence === snapshot.sourceSequence) {
        if (pending.contentIdentity !== contentIdentity) {
          const reason = 'A different widget instance snapshot already owns this collaboration source sequence.';
          this.#rejectedSnapshotCount += 1;
          this.#lastRejection = reason;
          this.#pending.delete(key);
          this.#notifyCanvasIdle(key);
          this.#recordQuarantine({
            key,
            orgId: tenant.orgId,
            canvasId: snapshot.canvasId,
            sourceSequence: snapshot.sourceSequence,
            reason,
            retrySameSequence: false,
            contentIdentity: null,
          });
          return Object.freeze({
            status: 'quarantined' as const,
            canvasId: snapshot.canvasId,
            sourceSequence: snapshot.sourceSequence,
            reason,
          });
        }
        this.#coalescedSnapshotCount += 1;
        return Object.freeze({
          status: 'queued' as const,
          canvasId: pending.snapshot.canvasId,
          sourceSequence: pending.snapshot.sourceSequence,
        });
      }
      this.#coalescedSnapshotCount += 1;
    }
    const quarantine = this.#quarantined.get(key);
    if (quarantine !== undefined) this.#touchRetainedCanvas(key);
    if (
      quarantine !== undefined
      && quarantine.sourceSequence !== null
      && (
        snapshot.sourceSequence < quarantine.sourceSequence
        || (
          snapshot.sourceSequence === quarantine.sourceSequence
          && (!quarantine.retrySameSequence || quarantine.contentIdentity !== contentIdentity)
        )
      )
    ) {
      return Object.freeze({
        status: 'quarantined' as const,
        canvasId: quarantine.canvasId,
        sourceSequence: quarantine.sourceSequence,
        reason: quarantine.reason,
      });
    }
    if (pending === undefined && this.#pending.size >= this.#maxRetainedCanvases) {
      const reason = 'Widget instance projection pending canvas capacity is exhausted.';
      this.#rejectedSnapshotCount += 1;
      this.#lastRejection = reason;
      return Object.freeze({
        status: 'rejected' as const,
        canvasId: snapshot.canvasId,
        sourceSequence: snapshot.sourceSequence,
        reason,
      });
    }
    this.#pending.set(key, Object.freeze({
      key,
      contentIdentity,
      tenant: fnFreezeTenantContext(tenant),
      snapshot,
    }));
    this.#ensurePump();
    return Object.freeze({
      status: 'queued' as const,
      canvasId: snapshot.canvasId,
      sourceSequence: snapshot.sourceSequence,
    });
  }

  async drain(): Promise<void> {
    for (;;) {
      if (this.#failure !== null) throw this.#failure;
      this.#ensurePump();
      const pump = this.#pump;
      if (pump === null) {
        if (this.#quarantined.size > 0) throw this.#quarantineError();
        return;
      }
      await pump;
    }
  }

  async stop(): Promise<void> {
    this.#accepting = false;
    await this.drain();
  }

  async release(
    tenant: Pick<TTenantContext, 'orgId'>,
    canvasId: string,
  ): Promise<void> {
    const key = fnScopedKey('widget-instance-projection', [tenant.orgId, canvasId]);
    this.#releasingCanvasKeys.add(key);
    let released = false;
    try {
      for (;;) {
        if (this.#failure !== null) throw this.#failure;
        if (!this.#pending.has(key) && !this.#inFlightCanvasKeys.has(key)) break;
        this.#ensurePump();
        await this.#waitForCanvasIdle(key);
      }
      const quarantine = this.#quarantined.get(key);
      if (quarantine !== undefined) {
        throw Object.assign(
          new Error('Widget instance projection canvas cannot be released while quarantined.'),
          {
            code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
            quarantines: Object.freeze([this.#quarantineDetail(quarantine)]),
          },
        );
      }
      this.#pending.delete(key);
      this.#forgetRetainedCanvas(key);
      released = true;
    } finally {
      if (released) this.#notifyCanvasIdle(key);
      this.#releasingCanvasKeys.delete(key);
    }
  }

  diagnostics(): TWidgetInstanceMetadataProjectorDiagnostics {
    return Object.freeze({
      accepting: this.#accepting,
      pendingCanvasCount: this.#pending.size,
      retainedCanvasCount: this.#retainedCanvasOrder.size,
      retainedCanvasCapacity: this.#maxRetainedCanvases,
      inFlightSnapshotCount: this.#inFlightSnapshotCount,
      appliedSnapshotCount: this.#appliedSnapshotCount,
      replayedSnapshotCount: this.#replayedSnapshotCount,
      staleSnapshotCount: this.#staleSnapshotCount,
      coalescedSnapshotCount: this.#coalescedSnapshotCount,
      batchCount: this.#batchCount,
      rejectedSnapshotCount: this.#rejectedSnapshotCount,
      quarantinedCanvasCount: this.#quarantined.size,
      quarantinedCanvases: this.#quarantineDetails(),
      lastRejection: this.#lastRejection,
      lastFailure: this.#failure === null
        ? null
        : this.#failure instanceof Error
          ? this.#failure.message
          : 'Widget instance projection failed.',
    });
  }

  #ensurePump(): void {
    if (this.#pump !== null || this.#pending.size === 0 || this.#failure !== null) return;
    const pump = Promise.resolve().then(async () => this.#pumpPending());
    this.#pump = pump;
    void pump.then(
      () => {
        if (this.#pump === pump) this.#pump = null;
        this.#ensurePump();
      },
      (error: unknown) => {
        this.#failure = error;
        if (this.#pump === pump) this.#pump = null;
        this.#notifyAllCanvasWaiters();
      },
    );
  }

  async #pumpPending(): Promise<void> {
    while (this.#pending.size > 0) {
      const first = this.#pending.values().next().value as TPendingProjection | undefined;
      if (first === undefined) return;
      const batch: TPendingProjection[] = [];
      for (const pending of this.#pending.values()) {
        if (pending.tenant.orgId !== first.tenant.orgId) continue;
        batch.push(pending);
        if (batch.length >= this.#batchSize) break;
      }
      for (const pending of batch) this.#pending.delete(pending.key);
      for (const pending of batch) this.#inFlightCanvasKeys.add(pending.key);
      this.#inFlightSnapshotCount = batch.length;
      try {
        await this.#applyBatchWithIsolation(first.tenant, batch);
      } finally {
        for (const pending of batch) {
          this.#inFlightCanvasKeys.delete(pending.key);
          this.#notifyCanvasIdle(pending.key);
        }
        this.#inFlightSnapshotCount = 0;
      }
    }
  }

  async #applyBatchWithIsolation(
    tenant: TTenantContext,
    batch: readonly TPendingProjection[],
  ): Promise<void> {
    try {
      const results = await this.#portal.store.applyProjectionBatch(tenant, {
        snapshots: batch.map((pending) => pending.snapshot),
      });
      this.#recordBatchResults(batch, results);
      return;
    } catch (error) {
      if (batch.length === 1) {
        this.#recordStoreQuarantine(batch[0]!, error);
        return;
      }
    }

    for (const pending of batch) {
      try {
        const results = await this.#portal.store.applyProjectionBatch(tenant, {
          snapshots: [pending.snapshot],
        });
        this.#recordBatchResults([pending], results);
      } catch (error) {
        this.#recordStoreQuarantine(pending, error);
      }
    }
  }

  #recordBatchResults(
    batch: readonly TPendingProjection[],
    results: readonly TWidgetInstanceProjectionApplyResult[],
  ): void {
    if (results.length !== batch.length) {
      throw new Error('Widget instance projection store returned an incomplete batch result.');
    }
    for (const [index, result] of results.entries()) {
      const submitted = batch[index];
      if (
        submitted === undefined
        || result.canvasId !== submitted.snapshot.canvasId
        || result.sourceSequence !== submitted.snapshot.sourceSequence
      ) {
        throw new Error('Widget instance projection store returned a mismatched batch result.');
      }
    }
    for (const [index, result] of results.entries()) {
      const submitted = batch[index]!;
      if (result.status === 'applied') this.#appliedSnapshotCount += 1;
      else if (result.status === 'replayed') this.#replayedSnapshotCount += 1;
      else this.#staleSnapshotCount += 1;
      this.#settledSourceSequences.set(submitted.key, result.sourceSequence);
      this.#touchRetainedCanvas(submitted.key);
      const quarantine = this.#quarantined.get(submitted.key);
      if (
        quarantine !== undefined
        && (
          quarantine.sourceSequence === null
          || result.sourceSequence > quarantine.sourceSequence
          || (
            result.sourceSequence === quarantine.sourceSequence
            && quarantine.retrySameSequence
            && quarantine.contentIdentity === submitted.contentIdentity
          )
        )
      ) {
        this.#quarantined.delete(submitted.key);
      }
    }
    this.#batchCount += 1;
  }

  #recordStoreQuarantine(pending: TPendingProjection, error: unknown): void {
    const reason = error instanceof Error ? error.message : 'Widget instance projection store failed.';
    this.#rejectedSnapshotCount += 1;
    this.#lastRejection = reason;
    this.#recordQuarantine({
      key: pending.key,
      orgId: pending.tenant.orgId,
      canvasId: pending.snapshot.canvasId,
      sourceSequence: pending.snapshot.sourceSequence,
      reason,
      retrySameSequence: true,
      contentIdentity: pending.contentIdentity,
    });
  }

  #recordQuarantine(quarantine: TQuarantinedProjection): void {
    const existing = this.#quarantined.get(quarantine.key);
    if (
      existing !== undefined
      && existing.sourceSequence !== null
      && quarantine.sourceSequence !== null
      && existing.sourceSequence > quarantine.sourceSequence
    ) return;
    if (
      existing !== undefined
      && existing.sourceSequence === quarantine.sourceSequence
      && !existing.retrySameSequence
    ) return;
    const previous = this.#quarantined.get(quarantine.key);
    this.#quarantined.set(quarantine.key, Object.freeze(quarantine));
    try {
      this.#touchRetainedCanvas(quarantine.key);
    } catch (error) {
      if (previous === undefined) this.#quarantined.delete(quarantine.key);
      else this.#quarantined.set(quarantine.key, previous);
      this.#retainedCanvasOrder.delete(quarantine.key);
      if (previous !== undefined) this.#retainedCanvasOrder.set(quarantine.key, true);
      throw error;
    }
  }

  #touchRetainedCanvas(key: string): void {
    this.#retainedCanvasOrder.delete(key);
    this.#retainedCanvasOrder.set(key, true);
    while (this.#retainedCanvasOrder.size > this.#maxRetainedCanvases) {
      const oldestKey = [...this.#retainedCanvasOrder.keys()].find((candidate) => (
        !this.#quarantined.has(candidate)
      ));
      if (oldestKey === undefined) {
        throw new Error('Widget instance projection quarantine capacity is exhausted.');
      }
      this.#forgetRetainedCanvas(oldestKey);
    }
  }

  #forgetRetainedCanvas(key: string): void {
    this.#retainedCanvasOrder.delete(key);
    this.#settledSourceSequences.delete(key);
    this.#quarantined.delete(key);
  }

  #waitForCanvasIdle(key: string): Promise<void> {
    if (!this.#pending.has(key) && !this.#inFlightCanvasKeys.has(key)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiters = this.#canvasIdleWaiters.get(key) ?? new Set<() => void>();
      waiters.add(resolve);
      this.#canvasIdleWaiters.set(key, waiters);
    });
  }

  #notifyCanvasIdle(key: string): void {
    if (this.#pending.has(key) || this.#inFlightCanvasKeys.has(key)) return;
    const waiters = this.#canvasIdleWaiters.get(key);
    if (waiters === undefined) return;
    this.#canvasIdleWaiters.delete(key);
    for (const resolve of waiters) resolve();
  }

  #notifyAllCanvasWaiters(): void {
    const waiters = [...this.#canvasIdleWaiters.values()].flatMap((entries) => [...entries]);
    this.#canvasIdleWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  #quarantineError(): Error {
    const quarantines = this.#quarantineDetails();
    return Object.assign(
      new Error(`${quarantines.length} widget instance projection canvas snapshot(s) remain quarantined.`),
      {
        code: 'WIDGET_INSTANCE_PROJECTION_QUARANTINED',
        quarantines: Object.freeze(quarantines),
      },
    );
  }

  #quarantineDetails(): readonly Readonly<{
    orgId: string;
    canvasId: string;
    sourceSequence: number | null;
    reason: string;
  }>[] {
    return Object.freeze([...this.#quarantined.values()]
      .sort((left, right) => (
        left.orgId.localeCompare(right.orgId)
        || left.canvasId.localeCompare(right.canvasId)
      ))
      .map((entry) => this.#quarantineDetail(entry)));
  }

  #quarantineDetail(entry: TQuarantinedProjection): Readonly<{
    orgId: string;
    canvasId: string;
    sourceSequence: number | null;
    reason: string;
  }> {
    return Object.freeze({
      orgId: entry.orgId,
      canvasId: entry.canvasId,
      sourceSequence: entry.sourceSequence,
      reason: entry.reason,
    });
  }
}
