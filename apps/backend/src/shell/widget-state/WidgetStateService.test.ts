import { describe, expect, test } from 'bun:test';
import type { IWidgetStateStore } from '#backend/shell/widget-state/IWidgetStateService';
import { WidgetStateService } from './WidgetStateService';
import type {
  TWidgetStateInstanceIdentity,
  TWidgetStateJson,
  TWidgetStateStoredSnapshot,
  TWidgetStateStoreCompareAndSwapArgs,
  TWidgetStateStoreCompareAndSwapResult,
  TWidgetStateStoreGetArgs,
  TWidgetStateStoreGetResult,
} from '#backend/core/widget-state/types';

const identity = Object.freeze({
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
}) satisfies TWidgetStateInstanceIdentity;

const secondIdentity = Object.freeze({
  canvasId: 'canvas-a',
  elementId: 'element-b',
  widgetInstanceId: 'instance-b',
}) satisfies TWidgetStateInstanceIdentity;

function identityKey(value: TWidgetStateInstanceIdentity): string {
  return JSON.stringify([
    value.canvasId,
    value.elementId,
    value.widgetInstanceId,
  ]);
}

class FakeWidgetStateStore implements IWidgetStateStore {
  readonly rows = new Map<string, TWidgetStateStoredSnapshot>();
  readonly unavailable = new Set<string>();
  getCalls = 0;
  compareAndSwapCalls = 0;

  async getAuthorizedExactInstance(
    args: TWidgetStateStoreGetArgs,
  ): Promise<TWidgetStateStoreGetResult> {
    this.getCalls += 1;
    const key = identityKey(args.identity);
    if (this.unavailable.has(key)) return { status: 'unavailable' };
    const snapshot = this.rows.get(key) ?? args.initialSnapshot;
    this.rows.set(key, snapshot);
    return { status: 'found', snapshot };
  }

  async compareAndSwapAuthorizedExactInstance(
    args: TWidgetStateStoreCompareAndSwapArgs,
  ): Promise<TWidgetStateStoreCompareAndSwapResult> {
    this.compareAndSwapCalls += 1;
    const key = identityKey(args.identity);
    if (this.unavailable.has(key)) return { status: 'unavailable' };
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
}

describe('WidgetStateService durable state', () => {
  test('keys state by canvas item and stable instance', async () => {
    const service = new WidgetStateService(new FakeWidgetStateStore(), { now: () => 0 });

    await expect(service.get({ identity })).resolves.toEqual({
      status: 'found',
      snapshot: { identity, version: 1, state: null },
    });
  });

  test('increments one version and returns the current snapshot on conflict', async () => {
    const service = new WidgetStateService(new FakeWidgetStateStore(), { now: () => 0 });

    const changed = await service.change({
      identity,
      expectedVersion: 1,
      state: { count: 1 },
    });
    const conflict = await service.change({
      identity,
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
  });

  test('collapses a missing or mismatched canvas item to unavailable', async () => {
    const store = new FakeWidgetStateStore();
    store.unavailable.add(identityKey(identity));
    const service = new WidgetStateService(store, { now: () => 0 });

    expect(await service.get({ identity })).toEqual({ status: 'unavailable' });
    expect(await service.change({
      identity,
      expectedVersion: 1,
      state: null,
    })).toEqual({ status: 'unavailable' });
  });
});

describe('WidgetStateService validation and limits', () => {
  test('rejects non-JSON state before calling the store', async () => {
    const invalidValues: unknown[] = [
      Number.POSITIVE_INFINITY,
      Number.NaN,
      new Date(),
      { value: undefined },
      JSON.parse('{"__proto__":true}'),
    ];

    for (const invalid of invalidValues) {
      const store = new FakeWidgetStateStore();
      const service = new WidgetStateService(store, { now: () => 0 });
      await expect(service.change({
        identity,
        expectedVersion: 1,
        state: invalid as TWidgetStateJson,
      })).rejects.toBeInstanceOf(TypeError);
      expect(store.compareAndSwapCalls).toBe(0);
    }
  });

  test('bounds mutation ledgers and releases their capacity', async () => {
    const service = new WidgetStateService(new FakeWidgetStateStore(), {
      now: () => 0,
      maxMutationRateLedgers: 1,
    });
    expect((await service.change({
      identity,
      expectedVersion: 1,
      state: 1,
    })).status).toBe('changed');
    expect(await service.change({
      identity: secondIdentity,
      expectedVersion: 1,
      state: 1,
    })).toEqual({ status: 'rate-limited', retryAfterMs: 1_000 });

    service.release({ identity });
    expect((await service.change({
      identity: secondIdentity,
      expectedVersion: 1,
      state: 1,
    })).status).toBe('changed');
  });
});

describe('WidgetStateService subscriptions', () => {
  test('delivers the initial snapshot and live changes', async () => {
    const service = new WidgetStateService(new FakeWidgetStateStore(), { now: () => 0 });
    const subscription = await service.subscribe({ identity });
    if (subscription.status !== 'subscribed') throw new Error('Expected subscription.');
    const iterator = subscription.events[Symbol.asyncIterator]();

    expect(await iterator.next()).toMatchObject({
      done: false,
      value: { type: 'snapshot', reason: 'initial', snapshot: { version: 1 } },
    });
    const next = iterator.next();
    await service.change({
      identity,
      expectedVersion: 1,
      state: { count: 1 },
    });
    expect(await next).toMatchObject({
      done: false,
      value: { type: 'changed', snapshot: { version: 2, state: { count: 1 } } },
    });
    await iterator.return?.();
  });

  test('replays a retained tail and emits a resync snapshot after a gap', async () => {
    const service = new WidgetStateService(new FakeWidgetStateStore(), {
      now: () => 0,
      replayCapacity: 2,
    });
    for (let version = 1; version <= 3; version += 1) {
      await service.change({
        identity,
        expectedVersion: version,
        state: { version: version + 1 },
      });
    }

    const replay = await service.subscribe({ identity, afterVersion: 2 });
    if (replay.status !== 'subscribed') throw new Error('Expected replay.');
    const replayIterator = replay.events[Symbol.asyncIterator]();
    expect((await replayIterator.next()).value).toMatchObject({
      type: 'changed', snapshot: { version: 3 },
    });
    expect((await replayIterator.next()).value).toMatchObject({
      type: 'changed', snapshot: { version: 4 },
    });
    await replayIterator.return?.();

    const missed = await service.subscribe({ identity, afterVersion: 1 });
    if (missed.status !== 'subscribed') throw new Error('Expected resync.');
    const missedIterator = missed.events[Symbol.asyncIterator]();
    expect(await missedIterator.next()).toMatchObject({
      done: false,
      value: { type: 'snapshot', reason: 'resync', snapshot: { version: 4 } },
    });
    await missedIterator.return?.();
  });

  test('emits a durable resync snapshot after service restart loses volatile replay', async () => {
    const store = new FakeWidgetStateStore();
    const beforeRestart = new WidgetStateService(store, { now: () => 0 });
    await beforeRestart.change({ identity, expectedVersion: 1, state: { count: 1 } });
    beforeRestart.stop();

    const restarted = new WidgetStateService(store, { now: () => 0 });
    const subscription = await restarted.subscribe({ identity, afterVersion: 1 });
    if (subscription.status !== 'subscribed') throw new Error('Expected restarted subscription.');
    expect(await subscription.events[Symbol.asyncIterator]().next()).toMatchObject({
      done: false,
      value: { type: 'snapshot', reason: 'resync', snapshot: { version: 2, state: { count: 1 } } },
    });
    restarted.stop();
  });
});
