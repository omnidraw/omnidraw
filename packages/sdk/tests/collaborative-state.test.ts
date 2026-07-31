import { afterEach, describe, expect, test } from 'bun:test';
import type { TOmnidrawJsonValue } from '../src/shared';
import {
  capsuleGuestMock,
  loadWidgetSdk,
  type TFakeCapabilityStream,
} from './capsule-guest.mock';

const {
  changeCollaborativeState,
  createCollaborativeStateClient,
  getCollaborativeState,
  subscribeCollaborativeState,
} = await loadWidgetSdk();

const selector = Object.freeze({
  id: 'omnidraw.widget.collaborative_state',
  versionRange: '1.0.0',
  contractHash:
    'sha256:4f1fb60c04cf513e111bae5840faf4233e47077215a32ceadf58e9d2232b18dc' as const,
});

type TSnapshot = Readonly<{
  version: number;
  value: TOmnidrawJsonValue;
}>;

class MemoryStateStream implements TFakeCapabilityStream {
  readonly id: string;
  readonly queue: TSnapshot[] = [];
  pending: ((result: IteratorResult<unknown>) => void) | undefined;
  cancelled = false;

  constructor(id: number, initial: TSnapshot) {
    this.id = `stream-${id}`;
    this.queue.push(initial);
  }

  push(snapshot: TSnapshot): void {
    if (this.cancelled) return;
    const resolve = this.pending;
    if (resolve === undefined) {
      this.queue.push(snapshot);
      return;
    }
    this.pending = undefined;
    resolve({ done: false, value: snapshot });
  }

  async next(): Promise<IteratorResult<unknown>> {
    const value = this.queue.shift();
    if (value !== undefined) return { done: false, value };
    if (this.cancelled) return { done: true, value: undefined };
    return await new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    const resolve = this.pending;
    this.pending = undefined;
    resolve?.({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this;
  }
}

class MemoryStateCapability {
  snapshot: TSnapshot = Object.freeze({ version: 1, value: null });
  readonly streams = new Set<MemoryStateStream>();
  nextStreamId = 1;

  install(): void {
    capsuleGuestMock.callCapabilityAsync = async (
      receivedSelector,
      operation,
      input,
    ) => {
      expect(receivedSelector).toEqual(selector);
      if (operation === 'get') {
        expect(input).toBeNull();
        return this.snapshot;
      }
      if (operation === 'change') {
        const value = (input as { value: TOmnidrawJsonValue }).value;
        this.snapshot = Object.freeze({
          version: this.snapshot.version + 1,
          value,
        });
        for (const stream of this.streams) stream.push(this.snapshot);
        return this.snapshot;
      }
      throw new Error(`Unexpected operation ${operation}.`);
    };
    capsuleGuestMock.openCapabilityStream = (
      receivedSelector,
      operation,
      input,
    ) => {
      expect(receivedSelector).toEqual(selector);
      expect(operation).toBe('subscribe');
      expect(input).toBeNull();
      const stream = new MemoryStateStream(this.nextStreamId++, this.snapshot);
      this.streams.add(stream);
      return stream;
    };
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

afterEach(() => {
  capsuleGuestMock.reset();
});

describe('Capsule collaborative-state client', () => {
  test('gets, changes, and subscribes through the exact capability contract', async () => {
    const capability = new MemoryStateCapability();
    capability.install();

    await expect(getCollaborativeState()).resolves.toBeNull();
    await expect(changeCollaborativeState({ count: 1 }))
      .resolves.toEqual({ count: 1 });

    const observed: TOmnidrawJsonValue[] = [];
    const unsubscribe = subscribeCollaborativeState(
      (value) => observed.push(value),
    );
    await settle();
    expect(observed).toEqual([{ count: 1 }]);

    await changeCollaborativeState({ count: 2 });
    await settle();
    expect(observed).toEqual([{ count: 1 }, { count: 2 }]);

    const [stream] = [...capability.streams];
    unsubscribe();
    expect(stream?.cancelled).toBe(true);
    await changeCollaborativeState({ count: 3 });
    await settle();
    expect(observed).toHaveLength(2);
  });

  test('cancels each independent stream idempotently', async () => {
    const capability = new MemoryStateCapability();
    capability.install();
    const first = subscribeCollaborativeState(() => undefined);
    const second = subscribeCollaborativeState(() => undefined);
    await settle();

    const streams = [...capability.streams];
    expect(streams).toHaveLength(2);
    first();
    first();
    expect(streams[0]?.cancelled).toBe(true);
    expect(streams[1]?.cancelled).toBe(false);
    second();
    expect(streams[1]?.cancelled).toBe(true);
  });

  test('client disposal cancels streams and pending capability calls', async () => {
    const capability = new MemoryStateCapability();
    capability.install();
    const client = createCollaborativeStateClient();
    const unsubscribe = client.subscribe(() => undefined);
    await settle();
    const [stream] = [...capability.streams];

    capsuleGuestMock.callCapabilityAsync = async (
      _selector,
      operation,
      _input,
      options,
    ) => {
      expect(operation).toBe('get');
      return await new Promise((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    };
    const pending = client.get();
    client.dispose();
    client.dispose();

    expect(stream?.cancelled).toBe(true);
    await expect(pending).rejects.toThrow('aborted');
    await expect(client.get()).rejects.toThrow('disposed');
    expect(() => client.subscribe(() => undefined)).toThrow('disposed');
    unsubscribe();
  });

  test('reports malformed or regressing snapshots and then disposes the stream', async () => {
    let stream: MemoryStateStream | undefined;
    capsuleGuestMock.openCapabilityStream = () => {
      stream = new MemoryStateStream(1, { version: 2, value: null });
      stream.queue.push({ version: 2, value: { stale: true } });
      return stream;
    };
    const observed: TOmnidrawJsonValue[] = [];
    const errors: unknown[] = [];

    subscribeCollaborativeState(
      (value) => observed.push(value),
      { onError: (error) => errors.push(error) },
    );
    await settle();

    expect(observed).toEqual([null]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('invalid version');
    expect(stream?.cancelled).toBe(true);
  });
});
