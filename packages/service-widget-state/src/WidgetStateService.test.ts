import { describe, expect, test } from 'bun:test';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { IWidgetStateStore } from './IWidgetStateService';
import { WidgetStateService } from './WidgetStateService';
import type {
  TWidgetStateInstanceIdentity,
  TWidgetStateJson,
  TWidgetStateStoredSnapshot,
  TWidgetStateStoreCompareAndSwapArgs,
  TWidgetStateStoreCompareAndSwapResult,
  TWidgetStateStoreGetArgs,
  TWidgetStateStoreGetResult,
} from './types';

const tenantA = Object.freeze({
  orgId: '00000000-0000-4000-8000-000000000011',
  accountId: '00000000-0000-4000-8000-000000000012',
  cellId: '00000000-0000-4000-8000-000000000013',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['*']),
  requestId: 'request-a',
}) satisfies TTenantContext;

const tenantB = Object.freeze({
  ...tenantA,
  orgId: '00000000-0000-4000-8000-000000000021',
  accountId: '00000000-0000-4000-8000-000000000022',
  requestId: 'request-b',
}) satisfies TTenantContext;

const identityA = Object.freeze({
  orgId: tenantA.orgId,
  canvasId: '00000000-0000-4000-8000-000000000101',
  elementId: 'element-a',
  widgetInstanceId: '00000000-0000-4000-8000-000000000102',
  definitionId: '00000000-0000-4000-8000-000000000103',
  revisionId: '00000000-0000-4000-8000-000000000104',
}) satisfies TWidgetStateInstanceIdentity;

const identityA2 = Object.freeze({
  ...identityA,
  elementId: 'element-a2',
  widgetInstanceId: '00000000-0000-4000-8000-000000000105',
}) satisfies TWidgetStateInstanceIdentity;

const identityB = Object.freeze({
  ...identityA,
  orgId: tenantB.orgId,
  canvasId: '00000000-0000-4000-8000-000000000201',
  elementId: 'element-b',
  widgetInstanceId: '00000000-0000-4000-8000-000000000202',
}) satisfies TWidgetStateInstanceIdentity;

function identityKey(identity: TWidgetStateInstanceIdentity): string {
  return [
    identity.orgId,
    identity.canvasId,
    identity.elementId,
    identity.widgetInstanceId,
    identity.definitionId,
    identity.revisionId,
  ].join('|');
}

class FakeWidgetStateStore implements IWidgetStateStore {
  readonly rows = new Map<string, TWidgetStateStoredSnapshot>();
  getCalls = 0;
  compareAndSwapCalls = 0;
  blockedAccounts = new Set<string>();

  async getAuthorizedExactInstance(
    args: TWidgetStateStoreGetArgs,
  ): Promise<TWidgetStateStoreGetResult> {
    this.getCalls += 1;
    if (!this.#authorized(args.tenant, args.identity)) {
      return { status: 'unavailable' };
    }
    const key = identityKey(args.identity);
    const snapshot = this.rows.get(key) ?? args.initialSnapshot;
    this.rows.set(key, snapshot);
    return { status: 'found', snapshot };
  }

  async compareAndSwapAuthorizedExactInstance(
    args: TWidgetStateStoreCompareAndSwapArgs,
  ): Promise<TWidgetStateStoreCompareAndSwapResult> {
    this.compareAndSwapCalls += 1;
    if (!this.#authorized(args.tenant, args.identity)) {
      return { status: 'unavailable' };
    }
    const key = identityKey(args.identity);
    const current = this.rows.get(key) ?? args.initialSnapshot;
    this.rows.set(key, current);
    if (current.version !== args.expectedVersion) {
      return { status: 'conflict', snapshot: current };
    }
    const snapshot = Object.freeze({
      version: current.version + 1,
      state: args.state,
    });
    this.rows.set(key, snapshot);
    return { status: 'changed', snapshot };
  }

  #authorized(
    tenant: TTenantContext,
    identity: TWidgetStateInstanceIdentity,
  ): boolean {
    return tenant.orgId === identity.orgId
      && !this.blockedAccounts.has(tenant.accountId);
  }
}

describe('WidgetStateService durable state', () => {
  test('initializes at version one with an exact instance identity', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store);

    const result = await service.get(tenantA, { identity: identityA });

    expect(result).toEqual({
      status: 'found',
      snapshot: {
        identity: identityA,
        version: 1,
        state: null,
      },
    });
    expect(Object.isFrozen(result.status === 'found' ? result.snapshot : null)).toBe(true);
  });

  test('supports a custom valid initial version and immutable JSON state', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store, {
      initialVersion: 4,
      initialState: { nested: ['value'] },
    });

    const result = await service.get(tenantA, { identity: identityA });
    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('Expected state.');
    expect(result.snapshot.version).toBe(4);
    expect(result.snapshot.state).toEqual({ nested: ['value'] });
    expect(Object.isFrozen(result.snapshot.state)).toBe(true);
    const nested = (result.snapshot.state as { nested: readonly string[] }).nested;
    expect(Object.isFrozen(nested)).toBe(true);
  });

  test('increments one version and returns the latest snapshot on conflict', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store);

    const changed = await service.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: { count: 1 },
    });
    const conflict = await service.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: { count: 2 },
    });

    expect(changed).toMatchObject({
      status: 'changed',
      snapshot: { version: 2, state: { count: 1 } },
    });
    expect(conflict).toMatchObject({
      status: 'conflict',
      snapshot: { version: 2, state: { count: 1 } },
    });
    expect(service.getMetrics()).toMatchObject({
      changes: 1,
      conflicts: 1,
      changeAttempts: 2,
    });
  });

  test('allows exactly one concurrent writer for one expected version', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => service.change(tenantA, {
        identity: identityA,
        expectedVersion: 1,
        state: { writer: index },
      })),
    );

    expect(results.filter((result) => result.status === 'changed')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'conflict')).toHaveLength(9);
    expect(
      new Set(
        results
          .filter((result) => result.status !== 'rate-limited' && result.status !== 'unavailable')
          .map((result) => result.snapshot.version),
      ),
    ).toEqual(new Set([2]));
  });

  test('collapses missing, unauthorized, inactive, and mismatched access', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store);
    store.blockedAccounts.add(tenantA.accountId);

    expect(await service.get(tenantA, { identity: identityA })).toEqual({
      status: 'unavailable',
    });
    const callsBeforeCrossTenant = store.getCalls;
    expect(await service.get(tenantA, { identity: identityB })).toEqual({
      status: 'unavailable',
    });
    expect(store.getCalls).toBe(callsBeforeCrossTenant);
    expect(await service.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: null,
    })).toEqual({ status: 'unavailable' });
  });
});

describe('WidgetStateService validation and quotas', () => {
  test('rejects non-JSON and reserved state before calling the store', async () => {
    const invalidValues: unknown[] = [
      Number.POSITIVE_INFINITY,
      Number.NaN,
      new Date(),
      { value: undefined },
      JSON.parse('{"__proto__":true}'),
      JSON.parse('{"constructor":true}'),
      JSON.parse('{"prototype":true}'),
    ];

    for (const invalid of invalidValues) {
      const store = new FakeWidgetStateStore();
      const service = new WidgetStateService(store);
      await expect(service.change(tenantA, {
        identity: identityA,
        expectedVersion: 1,
        state: invalid as TWidgetStateJson,
      })).rejects.toBeInstanceOf(TypeError);
      expect(store.compareAndSwapCalls).toBe(0);
    }
  });

  test('enforces 64 KiB, depth 32, and 10,000 node limits', async () => {
    const byteStore = new FakeWidgetStateStore();
    const byteService = new WidgetStateService(byteStore);
    await expect(byteService.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: 'x'.repeat(64 * 1024),
    })).rejects.toThrow('byte limit');

    let deep: unknown = null;
    for (let index = 0; index < 33; index += 1) deep = [deep];
    const depthStore = new FakeWidgetStateStore();
    const depthService = new WidgetStateService(depthStore);
    await expect(depthService.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: deep as TWidgetStateJson,
    })).rejects.toThrow('structural limit');

    const nodeStore = new FakeWidgetStateStore();
    const nodeService = new WidgetStateService(nodeStore);
    await expect(nodeService.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: Array.from({ length: 10_000 }, () => null),
    })).rejects.toThrow('structural limit');
    expect(byteStore.compareAndSwapCalls).toBe(0);
    expect(depthStore.compareAndSwapCalls).toBe(0);
    expect(nodeStore.compareAndSwapCalls).toBe(0);
  });

  test('requires positive durable versions and nonnegative replay cursors', async () => {
    const store = new FakeWidgetStateStore();
    expect(() => new WidgetStateService(store, { initialVersion: 0 })).toThrow(
      'greater than or equal to 1',
    );
    const service = new WidgetStateService(store);
    await expect(service.change(tenantA, {
      identity: identityA,
      expectedVersion: 0,
      state: null,
    })).rejects.toBeInstanceOf(TypeError);
    await expect(service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: -1,
    })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('WidgetStateService mutation rate limiting', () => {
  test('allows twenty mutations per organization and instance each second', async () => {
    const store = new FakeWidgetStateStore();
    let now = 0;
    const service = new WidgetStateService(store, { now: () => now });

    for (let version = 1; version <= 20; version += 1) {
      const result = await service.change(tenantA, {
        identity: identityA,
        expectedVersion: version,
        state: { version: version + 1 },
      });
      expect(result.status).toBe('changed');
    }
    expect(await service.change(tenantA, {
      identity: identityA,
      expectedVersion: 21,
      state: { version: 22 },
    })).toEqual({ status: 'rate-limited', retryAfterMs: 1_000 });

    expect((await service.change(tenantA, {
      identity: identityA2,
      expectedVersion: 1,
      state: { independent: true },
    })).status).toBe('changed');
    expect((await service.change(tenantB, {
      identity: identityB,
      expectedVersion: 1,
      state: { independent: true },
    })).status).toBe('changed');

    now = 1_000;
    expect((await service.change(tenantA, {
      identity: identityA,
      expectedVersion: 21,
      state: { version: 22 },
    })).status).toBe('changed');
  });

  test('bounds rate ledgers and releases their capacity', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store, {
      now: () => 0,
      maxMutationRateLedgers: 1,
    });
    expect((await service.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: 1,
    })).status).toBe('changed');
    expect(await service.change(tenantA, {
      identity: identityA2,
      expectedVersion: 1,
      state: 1,
    })).toEqual({ status: 'rate-limited', retryAfterMs: 1_000 });

    service.release(tenantA, { identity: identityA });
    expect((await service.change(tenantA, {
      identity: identityA2,
      expectedVersion: 1,
      state: 1,
    })).status).toBe('changed');
  });
});

describe('WidgetStateService version subscriptions', () => {
  test('delivers initial and live full snapshots', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store);
    const subscription = await service.subscribe(tenantA, {
      identity: identityA,
    });
    expect(subscription.status).toBe('subscribed');
    if (subscription.status !== 'subscribed') throw new Error('Expected subscription.');
    const iterator = subscription.events[Symbol.asyncIterator]();

    expect(await iterator.next()).toMatchObject({
      done: false,
      value: {
        type: 'snapshot',
        reason: 'initial',
        snapshot: { version: 1, state: null },
      },
    });
    const pending = iterator.next();
    await service.change(tenantA, {
      identity: identityA,
      expectedVersion: 1,
      state: { count: 1 },
    });
    expect(await pending).toMatchObject({
      done: false,
      value: {
        type: 'changed',
        snapshot: { version: 2, state: { count: 1 } },
      },
    });
    await iterator.return?.();
    expect(service.getMetrics().activeSubscribers).toBe(0);
  });

  test('replays a contiguous retained tail and resyncs a missed tail', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store, { replayCapacity: 2 });
    for (let version = 1; version <= 3; version += 1) {
      await service.change(tenantA, {
        identity: identityA,
        expectedVersion: version,
        state: { version: version + 1 },
      });
    }

    const replay = await service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: 2,
    });
    if (replay.status !== 'subscribed') throw new Error('Expected replay.');
    const replayIterator = replay.events[Symbol.asyncIterator]();
    expect((await replayIterator.next()).value).toMatchObject({
      type: 'changed',
      snapshot: { version: 3 },
    });
    expect((await replayIterator.next()).value).toMatchObject({
      type: 'changed',
      snapshot: { version: 4 },
    });
    await replayIterator.return?.();

    const missed = await service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: 1,
    });
    if (missed.status !== 'subscribed') throw new Error('Expected resync.');
    const missedIterator = missed.events[Symbol.asyncIterator]();
    expect(await missedIterator.next()).toMatchObject({
      done: false,
      value: {
        type: 'snapshot',
        reason: 'resync',
        snapshot: { version: 4, state: { version: 4 } },
      },
    });
    await missedIterator.return?.();
  });

  test('coalesces a slow subscriber to one current resync snapshot', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store, {
      subscriberQueueCapacity: 2,
    });
    const subscription = await service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: 1,
    });
    if (subscription.status !== 'subscribed') throw new Error('Expected subscription.');
    const iterator = subscription.events[Symbol.asyncIterator]();

    for (let version = 1; version <= 4; version += 1) {
      await service.change(tenantA, {
        identity: identityA,
        expectedVersion: version,
        state: { version: version + 1 },
      });
    }

    expect(await iterator.next()).toMatchObject({
      done: false,
      value: {
        type: 'snapshot',
        reason: 'resync',
        snapshot: { version: 5, state: { version: 5 } },
      },
    });
    await iterator.return?.();
  });

  test('resyncs instead of creating an oversized initial replay queue', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store, {
      replayCapacity: 4,
      subscriberQueueCapacity: 2,
    });
    for (let version = 1; version <= 3; version += 1) {
      await service.change(tenantA, {
        identity: identityA,
        expectedVersion: version,
        state: { version: version + 1 },
      });
    }

    const subscription = await service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: 1,
    });
    if (subscription.status !== 'subscribed') throw new Error('Expected subscription.');
    const iterator = subscription.events[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({
      done: false,
      value: {
        type: 'snapshot',
        reason: 'resync',
        snapshot: { version: 4 },
      },
    });
    await iterator.return?.();
  });

  test('bounds active streams without evicting live subscribers', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store, { maxActiveStreams: 1 });
    const first = await service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: 1,
    });
    expect(first.status).toBe('subscribed');

    expect(await service.subscribe(tenantA, {
      identity: identityA2,
      afterVersion: 1,
    })).toEqual({ status: 'capacity-unavailable' });
    if (first.status === 'subscribed') {
      await first.events[Symbol.asyncIterator]().return?.();
    }
    const second = await service.subscribe(tenantA, {
      identity: identityA2,
      afterVersion: 1,
    });
    expect(second.status).toBe('subscribed');
    if (second.status === 'subscribed') {
      await second.events[Symbol.asyncIterator]().return?.();
    }
  });

  test('release and dispose close pending subscribers and clear metrics', async () => {
    const store = new FakeWidgetStateStore();
    const service = new WidgetStateService(store);
    const subscription = await service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: 1,
    });
    if (subscription.status !== 'subscribed') throw new Error('Expected subscription.');
    const iterator = subscription.events[Symbol.asyncIterator]();
    const pending = iterator.next();

    service.release(tenantA, { identity: identityA });
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(service.getMetrics()).toMatchObject({
      activeStreams: 0,
      activeSubscribers: 0,
      releases: 1,
    });

    const second = await service.subscribe(tenantA, {
      identity: identityA,
      afterVersion: 1,
    });
    if (second.status !== 'subscribed') throw new Error('Expected subscription.');
    const secondPending = second.events[Symbol.asyncIterator]().next();
    service.dispose();
    expect(await secondPending).toEqual({ done: true, value: undefined });
    expect(service.getMetrics()).toMatchObject({
      disposed: true,
      activeStreams: 0,
      activeSubscribers: 0,
      replayEvents: 0,
      mutationRateLedgers: 0,
    });
    await expect(service.get(tenantA, { identity: identityA })).rejects.toThrow(
      'disposed',
    );
  });
});
