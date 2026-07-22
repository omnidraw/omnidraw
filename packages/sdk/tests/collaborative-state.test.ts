import { afterEach, describe, expect, test } from 'bun:test';
import {
  __setCollaborativeStateTransport,
  changeCollaborativeState,
  COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY,
  getCollaborativeState,
  subscribeCollaborativeState,
  type ICollaborativeStateTransport,
  type TCollaborativeStateSnapshot,
} from '../src/widget';
import type { TVibecanvasJsonValue } from '../src/shared';

class MemoryStateTransport implements ICollaborativeStateTransport {
  snapshot: TCollaborativeStateSnapshot = { version: 1, value: null };
  readonly waiters = new Map<string, (snapshot: TCollaborativeStateSnapshot) => void>();

  async get<TValue extends TVibecanvasJsonValue>() {
    return this.snapshot as TCollaborativeStateSnapshot<TValue>;
  }

  async change<TValue extends TVibecanvasJsonValue>(value: TValue) {
    this.snapshot = { version: this.snapshot.version + 1, value };
    for (const resolve of this.waiters.values()) resolve(this.snapshot);
    this.waiters.clear();
    return this.snapshot as TCollaborativeStateSnapshot<TValue>;
  }

  async next<TValue extends TVibecanvasJsonValue>(afterVersion: number, waitId: string) {
    if (this.snapshot.version > afterVersion) {
      return this.snapshot as TCollaborativeStateSnapshot<TValue>;
    }
    return await new Promise<TCollaborativeStateSnapshot<TValue>>((resolve) => {
      this.waiters.set(waitId, (snapshot) => resolve(snapshot as TCollaborativeStateSnapshot<TValue>));
    });
  }

  cancel(waitId: string) {
    this.waiters.delete(waitId);
  }
}

afterEach(() => {
  __setCollaborativeStateTransport(null);
  delete (globalThis as Record<string, unknown>)[COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY];
});

describe('generated widget collaborative-state client', () => {
  test('fails closed without an exact host transport', async () => {
    await expect(getCollaborativeState()).rejects.toThrow('not connected');
    expect(() => subscribeCollaborativeState(() => undefined)).toThrow('not connected');
  });

  test('gets, changes, and subscribes through the fixed host capability', async () => {
    const transport = new MemoryStateTransport();
    (globalThis as Record<string, unknown>)[COLLABORATIVE_STATE_TRANSPORT_GLOBAL_KEY] = transport;

    await expect(getCollaborativeState()).resolves.toBeNull();
    await expect(changeCollaborativeState({ count: 1 })).resolves.toEqual({ count: 1 });

    const observed: TVibecanvasJsonValue[] = [];
    const unsubscribe = subscribeCollaborativeState((value) => { observed.push(value); });
    for (let attempt = 0; observed.length === 0 && attempt < 20; attempt += 1) await Promise.resolve();
    expect(observed).toEqual([{ count: 1 }]);
    await transport.change({ count: 2 });
    for (let attempt = 0; observed.length < 2 && attempt < 20; attempt += 1) await Promise.resolve();
    expect(observed).toEqual([{ count: 1 }, { count: 2 }]);

    unsubscribe();
    expect(transport.waiters.size).toBe(0);
    await transport.change({ count: 3 });
    await Promise.resolve();
    expect(observed).toHaveLength(2);
  });

  test('repeated subscribe and unsubscribe cancels every pending long poll', async () => {
    const transport = new MemoryStateTransport();
    __setCollaborativeStateTransport(transport);

    for (let index = 0; index < 64; index += 1) {
      const unsubscribe = subscribeCollaborativeState(() => undefined);
      for (let attempt = 0; transport.waiters.size === 0 && attempt < 20; attempt += 1) {
        await Promise.resolve();
      }
      expect(transport.waiters.size).toBe(1);
      unsubscribe();
      expect(transport.waiters.size).toBe(0);
    }
  });

  test('isolates concurrent subscription waits and cancellation', async () => {
    const transport = new MemoryStateTransport();
    __setCollaborativeStateTransport(transport);
    const firstObserved: TVibecanvasJsonValue[] = [];
    const secondObserved: TVibecanvasJsonValue[] = [];

    const unsubscribeFirst = subscribeCollaborativeState((value) => { firstObserved.push(value); });
    const unsubscribeSecond = subscribeCollaborativeState((value) => { secondObserved.push(value); });
    for (let attempt = 0; transport.waiters.size < 2 && attempt < 20; attempt += 1) {
      await Promise.resolve();
    }

    expect(transport.waiters.size).toBe(2);
    const [firstWaitId, secondWaitId] = [...transport.waiters.keys()];
    expect(firstWaitId).not.toBe(secondWaitId);
    expect(firstWaitId).toMatch(/^state-wait-[a-z0-9]+-[a-z0-9]+$/);
    expect(secondWaitId).toMatch(/^state-wait-[a-z0-9]+-[a-z0-9]+$/);

    unsubscribeSecond();
    expect(transport.waiters.size).toBe(1);
    expect(transport.waiters.has(firstWaitId!)).toBe(true);

    await transport.change({ count: 1 });
    for (let attempt = 0; firstObserved.length < 2 && attempt < 20; attempt += 1) {
      await Promise.resolve();
    }
    expect(firstObserved).toEqual([null, { count: 1 }]);
    expect(secondObserved).toEqual([null]);

    unsubscribeFirst();
    expect(transport.waiters.size).toBe(0);
  });
});
