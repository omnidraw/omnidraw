import { describe, expect, test, vi } from 'vitest';
import {
  createWidgetCollaborativeStatePort,
  WidgetCollaborativeStateConflictError,
} from '../../src/widget-runtime/create-widget-collaborative-state-port';
import type {
  TWidgetCollaborativeJsonValue,
  TWidgetCollaborativeStateIdentity,
  TWidgetCollaborativeStateTransportPort,
  TWidgetCollaborativeStateTransportSnapshot,
} from '../../src/widget-runtime/interface';

const identity = Object.freeze({
  orgId: 'org-a',
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
}) satisfies TWidgetCollaborativeStateIdentity;

class MemoryEventQueue implements AsyncIterableIterator<TWidgetCollaborativeStateTransportSnapshot> {
  readonly #onClose: () => void;
  readonly #queue: TWidgetCollaborativeStateTransportSnapshot[] = [];
  #pending: ((result: IteratorResult<TWidgetCollaborativeStateTransportSnapshot>) => void) | null = null;
  #closed = false;

  constructor(onClose: () => void) {
    this.#onClose = onClose;
  }

  push(snapshot: TWidgetCollaborativeStateTransportSnapshot): void {
    if (this.#closed) return;
    if (this.#pending) {
      const resolve = this.#pending;
      this.#pending = null;
      resolve({ done: false, value: snapshot });
      return;
    }
    this.#queue.push(snapshot);
  }

  async next(): Promise<IteratorResult<TWidgetCollaborativeStateTransportSnapshot>> {
    const queued = this.#queue.shift();
    if (queued) return { done: false, value: queued };
    if (this.#closed) return { done: true, value: undefined };
    return await new Promise((resolve) => {
      this.#pending = resolve;
    });
  }

  async return(): Promise<IteratorResult<TWidgetCollaborativeStateTransportSnapshot>> {
    if (!this.#closed) {
      this.#closed = true;
      this.#queue.splice(0);
      this.#pending?.({ done: true, value: undefined });
      this.#pending = null;
      this.#onClose();
    }
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<TWidgetCollaborativeStateTransportSnapshot> {
    return this;
  }
}

class MemoryCollaborativeStateTransport {
  readonly queues = new Set<MemoryEventQueue>();
  readonly dispose = vi.fn();
  readonly changeCalls = vi.fn();
  pauseEvents = false;
  maxChanges = Number.POSITIVE_INFINITY;
  #changeCount = 0;
  #identity: TWidgetCollaborativeStateIdentity;
  #version = 1;
  #state: TWidgetCollaborativeJsonValue = null;

  constructor(identityValue: TWidgetCollaborativeStateIdentity = identity) {
    this.#identity = identityValue;
  }

  port(): TWidgetCollaborativeStateTransportPort {
    return {
      get: async () => this.snapshot(),
      change: async ({ expectedVersion, state }) => {
        this.changeCalls(expectedVersion, state);
        if (this.#changeCount >= this.maxChanges) {
          throw new Error('Widget collaborative state mutation rate limit exceeded.');
        }
        if (expectedVersion !== this.#version) {
          return { status: 'conflict', snapshot: this.snapshot() };
        }
        this.#changeCount += 1;
        this.#version += 1;
        this.#state = state;
        const snapshot = this.snapshot();
        if (!this.pauseEvents) {
          for (const queue of this.queues) queue.push(snapshot);
        }
        return { status: 'changed', snapshot };
      },
      events: async ({ afterVersion }) => {
        let queue!: MemoryEventQueue;
        queue = new MemoryEventQueue(() => this.queues.delete(queue));
        this.queues.add(queue);
        if (this.#version > afterVersion) queue.push(this.snapshot());
        return queue;
      },
      dispose: this.dispose,
    };
  }

  snapshot(): TWidgetCollaborativeStateTransportSnapshot {
    return Object.freeze({
      identity: this.#identity,
      version: this.#version,
      state: this.#state,
    });
  }

  replaceIdentity(nextIdentity: TWidgetCollaborativeStateIdentity): void {
    this.#identity = nextIdentity;
    this.#version += 1;
    const snapshot = this.snapshot();
    for (const queue of this.queues) queue.push(snapshot);
  }

  replaceState(value: TWidgetCollaborativeJsonValue): void {
    this.#version += 1;
    this.#state = value;
    const snapshot = this.snapshot();
    for (const queue of this.queues) queue.push(snapshot);
  }

  resetRateLimit(): void {
    this.#changeCount = 0;
  }
}

function port(
  memory: MemoryCollaborativeStateTransport,
  isCurrent = () => true,
) {
  return createWidgetCollaborativeStatePort({
    isIdentityCurrent: isCurrent,
    openTransport: () => memory.port(),
  });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe('widget collaborative-state port', () => {
  test('converges two clients, tears down streams, and retains durable versions after reconnect', async () => {
    const memory = new MemoryCollaborativeStateTransport();
    const collaborativeState = port(memory);
    const first = await collaborativeState.open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });
    const second = await collaborativeState.open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });

    expect(await first.get()).toEqual({ version: 1, value: null });
    const secondUpdate = second.next(1, 'second-update');
    await first.change({ count: 1, source: 'first' });
    await expect(secondUpdate).resolves.toEqual({
      version: 2,
      value: { count: 1, source: 'first' },
    });

    first.dispose();
    second.dispose();
    await vi.waitFor(() => expect(memory.queues.size).toBe(0));

    memory.replaceState({ count: 2, source: 'offline-peer' });
    const reconnected = await collaborativeState.open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });
    await expect(reconnected.get()).resolves.toEqual({
      version: 3,
      value: { count: 2, source: 'offline-peer' },
    });
    reconnected.dispose();
  });

  test('fails closed when the service returns another exact instance identity', async () => {
    const memory = new MemoryCollaborativeStateTransport({
      ...identity,
      widgetInstanceId: 'foreign-instance',
    });
    await expect(port(memory).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    })).rejects.toThrow('identity mismatch');
    expect(memory.dispose).toHaveBeenCalledOnce();
    expect(memory.queues.size).toBe(0);
  });

  test('terminates pending subscribers when identity changes or the session is disposed', async () => {
    const memory = new MemoryCollaborativeStateTransport();
    const session = await port(memory).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });
    const changed = session.next(1, 'identity-change');
    memory.replaceIdentity({ ...identity, canvasId: 'foreign-canvas' });
    await expect(changed).rejects.toThrow('identity mismatch');
    await expect(session.get()).rejects.toThrow('identity mismatch');

    const replacement = new MemoryCollaborativeStateTransport();
    const disposed = await port(replacement).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });
    const pending = disposed.next(1, 'dispose-wait');
    disposed.dispose();
    await expect(pending).rejects.toThrow('disposed');
    await vi.waitFor(() => expect(replacement.queues.size).toBe(0));
  });

  test('rejects stale authority before opening or mutating state', async () => {
    const memory = new MemoryCollaborativeStateTransport();
    let current = true;
    const collaborativeState = port(memory, () => current);
    const session = await collaborativeState.open({
      identity,
      signal: signal(),
      isCurrent: () => current,
    });
    current = false;

    await expect(session.change({ denied: true })).rejects.toThrow('authority');
    expect(memory.changeCalls).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(collaborativeState.open({
      identity,
      signal: controller.signal,
      isCurrent: () => current,
    })).rejects.toThrow('authority');
    session.dispose();
  });

  test('surfaces server rate limiting without changing the durable version', async () => {
    const memory = new MemoryCollaborativeStateTransport();
    memory.maxChanges = 20;
    const session = await port(memory).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });

    for (let count = 1; count <= 20; count += 1) {
      await expect(session.change({ count })).resolves.toMatchObject({
        version: count + 1,
        value: { count },
      });
    }
    await expect(session.change({ count: 21 })).rejects.toThrow('rate limit');
    memory.resetRateLimit();
    await expect(session.change({ count: 22 })).resolves.toMatchObject({
      version: 22,
      value: { count: 22 },
    });
    session.dispose();
  });

  test('returns the latest snapshot on a CAS conflict and requires a deliberate retry', async () => {
    const memory = new MemoryCollaborativeStateTransport();
    const collaborativeState = port(memory);
    const first = await collaborativeState.open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });
    const stale = await collaborativeState.open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });
    memory.pauseEvents = true;

    await first.change({ writer: 'first' });
    const operation = stale.change({ writer: 'stale' });
    await expect(operation).rejects.toBeInstanceOf(
      WidgetCollaborativeStateConflictError,
    );
    await expect(operation).rejects.toMatchObject({
      snapshot: { version: 2, value: { writer: 'first' } },
    });
    await expect(stale.next(1, 'latest-after-conflict')).resolves.toEqual({
      version: 2,
      value: { writer: 'first' },
    });
    expect(memory.snapshot()).toMatchObject({
      version: 2,
      state: { writer: 'first' },
    });
    first.dispose();
    stale.dispose();
  });

  test('rejects non-JSON and oversized state without calling the transport', async () => {
    const memory = new MemoryCollaborativeStateTransport();
    const session = await port(memory).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });

    await expect(session.change({ value: Number.POSITIVE_INFINITY } as never))
      .rejects.toThrow('finite numbers');
    await expect(session.change('x'.repeat(64 * 1_024 + 1)))
      .rejects.toThrow('byte limit');
    expect(memory.changeCalls).not.toHaveBeenCalled();
    session.dispose();
  });

  test('cancels pending long polls by id without consuming the bounded wait pool', async () => {
    const memory = new MemoryCollaborativeStateTransport();
    const session = await port(memory).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });

    for (let index = 0; index < 64; index += 1) {
      const waitId = `cancel-${index}`;
      const pending = session.next(1, waitId);
      session.cancel(waitId);
      await expect(pending).rejects.toThrow('cancelled');
    }
    const retained = session.next(1, 'retained');
    memory.replaceState({ count: 1 });
    await expect(retained).resolves.toMatchObject({
      version: 2,
      value: { count: 1 },
    });
    session.dispose();
  });
});
