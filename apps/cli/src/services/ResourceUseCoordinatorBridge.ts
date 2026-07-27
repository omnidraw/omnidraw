import {
  ResourceError,
  type IResourceUseCoordinator,
  type TResourceDrainLease,
  type TResourceDrainRequest,
  type TResourceDrainResult,
  type TResourceReleaseMode,
  type TResourceReleaseResult,
  type TResourceUse,
  type TResourceUseInspection,
} from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';

const DEFAULT_INSPECTION_TIMEOUT_MS = 5_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type TResourceUseConsumer = Readonly<{
  inspectResourceUses(resourceId: string): Promise<TResourceUseInspection>;
  drainResourceUses(request: TResourceDrainRequest): Promise<TResourceDrainResult>;
  releaseResourceUses(
    lease: TResourceDrainLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult>;
}>;

type TChildLease = Readonly<{
  consumer: TResourceUseConsumer;
  lease: TResourceDrainLease;
}>;

type TBridgeLease = Readonly<{
  lease: TResourceDrainLease;
  children: readonly TChildLease[];
  releaseMode?: TResourceReleaseMode;
  resumedUseIds: readonly string[];
}>;

type TDeadlineResult<T> =
  | Readonly<{ status: 'fulfilled'; value: T }>
  | Readonly<{ status: 'rejected'; error: unknown }>
  | Readonly<{ status: 'timeout' }>;

type TResourceUseCoordinatorBridgeConfig = Readonly<{
  inspectionTimeoutMs?: number;
  nowMs?: () => number;
}>;

/**
 * Connects the neutral resource lifecycle to any active legacy consumers.
 * During cold-start reconciliation there are no active consumers, so the
 * bridge deliberately reports an empty use set when no consumers are attached.
 */
class ResourceUseCoordinatorBridge implements IResourceUseCoordinator {
  readonly #consumers = new Set<TResourceUseConsumer>();
  readonly #leases = new Map<string, TBridgeLease>();
  readonly #activeLeaseByResource = new Map<string, string>();
  readonly #drainingResources = new Set<string>();
  readonly #releasingLeases = new Set<string>();
  readonly #inspectionTimeoutMs: number;
  readonly #nowMs: () => number;
  #leaseEpoch = 0;

  constructor(config: TResourceUseCoordinatorBridgeConfig = {}) {
    this.#inspectionTimeoutMs = Number.isFinite(config.inspectionTimeoutMs)
      ? Math.max(0, config.inspectionTimeoutMs ?? DEFAULT_INSPECTION_TIMEOUT_MS)
      : DEFAULT_INSPECTION_TIMEOUT_MS;
    this.#nowMs = config.nowMs ?? Date.now;
  }

  attach(consumer: TResourceUseConsumer): () => void {
    this.#consumers.add(consumer);
    return () => this.#consumers.delete(consumer);
  }

  inspect(_tenant: TTenantContext, resourceId: string): Promise<TResourceUseInspection> {
    return this.#inspectConsumers(
      [...this.#consumers],
      resourceId,
      this.#deadline(this.#inspectionTimeoutMs),
      true,
    );
  }

  async drain(
    _tenant: TTenantContext,
    request: TResourceDrainRequest,
  ): Promise<TResourceDrainResult> {
    this.#discardExpiredLease(request.resourceId);
    if (
      this.#drainingResources.has(request.resourceId)
      || this.#activeLeaseByResource.has(request.resourceId)
    ) {
      throw new ResourceError(
        'RESOURCE_LIFECYCLE_CONFLICT',
        'A resource-use drain is already active for this resource.',
      );
    }

    const consumers = [...this.#consumers];
    const deadlineAtMs = this.#deadline(request.timeoutMs);
    const childLeases: TChildLease[] = [];
    this.#drainingResources.add(request.resourceId);
    try {
      for (const consumer of consumers) {
        if (this.#nowMs() >= deadlineAtMs) {
          return this.#failedDrain(consumers, request.resourceId, deadlineAtMs, childLeases);
        }

        const pending = Promise.resolve().then(() => consumer.drainResourceUses(request));
        const settled = await this.#settleBeforeDeadline(pending, deadlineAtMs);
        if (settled.status === 'timeout') {
          this.#releaseLateDrain(consumer, pending);
          return this.#failedDrain(consumers, request.resourceId, deadlineAtMs, childLeases);
        }
        if (settled.status === 'rejected') {
          return this.#failedDrain(consumers, request.resourceId, deadlineAtMs, childLeases);
        }
        if (!settled.value.ok) {
          return this.#failedDrain(
            consumers,
            request.resourceId,
            deadlineAtMs,
            childLeases,
            [settled.value.inspection],
          );
        }

        const child = { consumer, lease: settled.value.lease };
        if (!this.#validChildLease(child.lease, request.resourceId)) {
          return this.#failedDrain(
            consumers,
            request.resourceId,
            deadlineAtMs,
            [...childLeases, child],
          );
        }
        childLeases.push(child);
      }

      const completedAtMs = this.#nowMs();
      const expiresAtMs = childLeases.reduce(
        (expiresAt, child) => Math.min(expiresAt, child.lease.expiresAtMs),
        Number.MAX_SAFE_INTEGER,
      );
      if (completedAtMs >= deadlineAtMs || expiresAtMs <= completedAtMs) {
        return this.#failedDrain(consumers, request.resourceId, deadlineAtMs, childLeases);
      }

      this.#leaseEpoch += 1;
      const leaseId = `resource-use-bridge:${this.#leaseEpoch}`;
      const lease: TResourceDrainLease = {
        resourceId: request.resourceId,
        leaseId,
        leaseEpoch: this.#leaseEpoch,
        expiresAtMs,
        drainedUses: this.#mergeUses(childLeases.flatMap((child) => child.lease.drainedUses)),
      };
      this.#leases.set(leaseId, { lease, children: childLeases, resumedUseIds: [] });
      this.#activeLeaseByResource.set(request.resourceId, leaseId);
      return { ok: true, lease };
    } finally {
      this.#drainingResources.delete(request.resourceId);
    }
  }

  async release(
    _tenant: TTenantContext,
    lease: TResourceDrainLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult> {
    const active = this.#requireActiveLease(lease);
    if (this.#releasingLeases.has(lease.leaseId)) {
      throw new ResourceError(
        'RESOURCE_LIFECYCLE_CONFLICT',
        'Resource-use drain lease release is already in progress.',
      );
    }
    if (active.releaseMode !== undefined && active.releaseMode !== mode) {
      throw new ResourceError(
        'RESOURCE_LIFECYCLE_CONFLICT',
        'A partially released drain lease must be retried with its original release mode.',
      );
    }

    this.#releasingLeases.add(lease.leaseId);
    try {
      const results = await Promise.allSettled(active.children.map(async (child) => {
        const result = await this.#releaseChild(child, mode);
        if (
          !result.released
          || result.resourceId !== active.lease.resourceId
          || result.mode !== mode
        ) {
          throw new ResourceError(
            'RESOURCE_LIFECYCLE_CONFLICT',
            'A resource-use consumer rejected the fenced drain lease.',
          );
        }
        return result;
      }));
      const failedChildren = active.children.filter((_, index) => results[index]?.status === 'rejected');
      const released = results.flatMap((result) => (
        result.status === 'fulfilled' ? [result.value] : []
      ));
      const resumedUseIds = [...new Set([
        ...active.resumedUseIds,
        ...released.flatMap((result) => result.resumedUseIds),
      ])];
      if (failedChildren.length > 0) {
        this.#leases.set(lease.leaseId, {
          lease: active.lease,
          children: failedChildren,
          releaseMode: mode,
          resumedUseIds,
        });
        throw new ResourceError(
          'RESOURCE_PROVIDER_UNAVAILABLE',
          'One or more resource-use consumers could not release the drain lease; retry the same lease and mode.',
        );
      }
      this.#leases.delete(lease.leaseId);
      if (this.#activeLeaseByResource.get(active.lease.resourceId) === lease.leaseId) {
        this.#activeLeaseByResource.delete(active.lease.resourceId);
      }
      return {
        resourceId: active.lease.resourceId,
        released: true,
        mode,
        resumedUseIds,
      };
    } finally {
      this.#releasingLeases.delete(lease.leaseId);
    }
  }

  async #failedDrain(
    consumers: readonly TResourceUseConsumer[],
    resourceId: string,
    deadlineAtMs: number,
    childLeases: readonly TChildLease[],
    knownInspections: readonly TResourceUseInspection[] = [],
  ): Promise<TResourceDrainResult> {
    await this.#rollbackChildren(childLeases, deadlineAtMs);
    const inspection = await this.#inspectConsumers(
      consumers,
      resourceId,
      deadlineAtMs,
      false,
      knownInspections,
    );
    return { ok: false, code: 'RESOURCE_DRAIN_TIMEOUT', inspection };
  }

  async #rollbackChildren(
    children: readonly TChildLease[],
    deadlineAtMs: number,
  ): Promise<void> {
    const releases = children.map((child) => this.#releaseChild(child, 'resume'));
    await Promise.all(releases.map((release) => this.#settleBeforeDeadline(release, deadlineAtMs)));
  }

  #releaseChild(
    child: TChildLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult> {
    try {
      return Promise.resolve(child.consumer.releaseResourceUses(child.lease, mode));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #releaseLateDrain(
    consumer: TResourceUseConsumer,
    pending: Promise<TResourceDrainResult>,
  ): void {
    void pending.then((result) => (
      result.ok ? consumer.releaseResourceUses(result.lease, 'resume') : undefined
    )).catch(() => undefined);
  }

  async #inspectConsumers(
    consumers: readonly TResourceUseConsumer[],
    resourceId: string,
    deadlineAtMs: number,
    strict: boolean,
    knownInspections: readonly TResourceUseInspection[] = [],
  ): Promise<TResourceUseInspection> {
    if (consumers.length > 0 && this.#nowMs() >= deadlineAtMs) {
      if (strict) {
        throw new ResourceError('RESOURCE_DRAIN_TIMEOUT', 'Resource-use inspection timed out.');
      }
      return {
        resourceId,
        uses: this.#mergeUses(knownInspections.flatMap((inspection) => inspection.uses)),
      };
    }

    const inspections = consumers.map((consumer) => this.#settleBeforeDeadline(
      Promise.resolve().then(() => consumer.inspectResourceUses(resourceId)),
      deadlineAtMs,
    ));
    const settled = await Promise.all(inspections);
    if (strict) {
      if (settled.some((result) => result.status === 'timeout')) {
        throw new ResourceError('RESOURCE_DRAIN_TIMEOUT', 'Resource-use inspection timed out.');
      }
      const failed = settled.find((result): result is Extract<TDeadlineResult<TResourceUseInspection>, { status: 'rejected' }> => (
        result.status === 'rejected'
      ));
      if (failed) {
        if (failed.error instanceof ResourceError) throw failed.error;
        throw new ResourceError(
          'RESOURCE_PROVIDER_UNAVAILABLE',
          'Resource uses could not be inspected.',
        );
      }
    }

    const uses = [
      ...knownInspections,
      ...settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
    ].flatMap((inspection) => inspection.uses);
    return { resourceId, uses: this.#mergeUses(uses) };
  }

  #requireActiveLease(lease: TResourceDrainLease): TBridgeLease {
    const active = this.#leases.get(lease.leaseId);
    if (!active) {
      throw new ResourceError(
        'RESOURCE_LIFECYCLE_CONFLICT',
        'Resource-use drain lease is unknown, stale, or already released.',
      );
    }
    if (
      active.lease.resourceId !== lease.resourceId
      || active.lease.leaseEpoch !== lease.leaseEpoch
      || active.lease.expiresAtMs !== lease.expiresAtMs
      || this.#activeLeaseByResource.get(active.lease.resourceId) !== lease.leaseId
    ) {
      throw new ResourceError(
        'RESOURCE_LIFECYCLE_CONFLICT',
        'Resource-use drain lease fencing data does not match the active lease.',
      );
    }
    if (this.#nowMs() >= active.lease.expiresAtMs) {
      this.#leases.delete(lease.leaseId);
      this.#activeLeaseByResource.delete(active.lease.resourceId);
      throw new ResourceError(
        'RESOURCE_LIFECYCLE_CONFLICT',
        'Resource-use drain lease has expired.',
      );
    }
    return active;
  }

  #validChildLease(lease: TResourceDrainLease, resourceId: string): boolean {
    return lease.resourceId === resourceId
      && typeof lease.leaseId === 'string'
      && lease.leaseId.length > 0
      && Number.isSafeInteger(lease.leaseEpoch)
      && lease.leaseEpoch >= 0
      && Number.isSafeInteger(lease.expiresAtMs)
      && lease.expiresAtMs > this.#nowMs();
  }

  #discardExpiredLease(resourceId: string): void {
    const leaseId = this.#activeLeaseByResource.get(resourceId);
    if (!leaseId) return;
    const active = this.#leases.get(leaseId);
    if (active && this.#nowMs() < active.lease.expiresAtMs) return;
    this.#leases.delete(leaseId);
    this.#activeLeaseByResource.delete(resourceId);
  }

  #deadline(timeoutMs: number): number {
    const nowMs = this.#nowMs();
    const durationMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
    return durationMs >= Number.MAX_SAFE_INTEGER - nowMs
      ? Number.MAX_SAFE_INTEGER
      : nowMs + durationMs;
  }

  async #settleBeforeDeadline<T>(
    operation: Promise<T>,
    deadlineAtMs: number,
  ): Promise<TDeadlineResult<T>> {
    const observed: Promise<TDeadlineResult<T>> = operation.then(
      (value): TDeadlineResult<T> => ({ status: 'fulfilled', value }),
      (error): TDeadlineResult<T> => ({ status: 'rejected', error }),
    );
    const remainingMs = deadlineAtMs - this.#nowMs();
    if (remainingMs <= 0) return { status: 'timeout' };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<TDeadlineResult<T>>((resolve) => {
      const schedule = (): void => {
        const remaining = deadlineAtMs - this.#nowMs();
        if (remaining <= 0) {
          resolve({ status: 'timeout' });
          return;
        }
        timer = setTimeout(schedule, Math.min(remaining, MAX_TIMER_DELAY_MS));
      };
      schedule();
    });
    try {
      return await Promise.race([observed, timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  #mergeUses(uses: readonly TResourceUse[]): TResourceUse[] {
    return [...new Map(uses.map((use) => [use.id, use])).values()];
  }
}

export { ResourceUseCoordinatorBridge };
export type {
  TResourceUseConsumer,
  TResourceUseCoordinatorBridgeConfig,
};
