import { describe, expect, test, vi } from 'vitest';
import { createWidgetCollaborativeStatePort } from '../../src/widget-runtime/create-widget-collaborative-state-port';
import type {
  TMutableWidgetCollaborativeStateDocument,
  TWidgetCollaborativeStateDocumentPort,
  TWidgetCollaborativeStateIdentity,
} from '../../src/widget-runtime/interface';

const identity = Object.freeze({
  orgId: 'org-a',
  canvasId: 'canvas-a',
  elementId: 'element-a',
  widgetInstanceId: 'instance-a',
  definitionId: 'definition-a',
  revisionId: 'revision-a',
  stateDocumentId: 'automerge:state-a',
}) satisfies TWidgetCollaborativeStateIdentity;

class MemoryCollaborativeDocument {
  readonly listeners = new Set<() => void>();
  readonly dispose = vi.fn();

  constructor(readonly value: TMutableWidgetCollaborativeStateDocument) {}

  port(): TWidgetCollaborativeStateDocumentPort {
    return {
      read: () => this.value,
      change: (mutator) => {
        mutator(this.value);
        this.emit();
      },
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
      },
      dispose: this.dispose,
    };
  }

  replaceIdentity(nextIdentity: TWidgetCollaborativeStateIdentity): void {
    this.value.identity = nextIdentity;
    this.emit();
  }

  replaceState(value: TMutableWidgetCollaborativeStateDocument['state']): void {
    this.value.state = value;
    this.emit();
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function document(identityValue = identity) {
  return new MemoryCollaborativeDocument({
    schemaVersion: 1,
    identity: { ...identityValue },
    state: null,
  });
}

function port(
  memory: MemoryCollaborativeDocument,
  isCurrent = () => true,
  nowMs = () => 0,
) {
  return createWidgetCollaborativeStatePort({
    isIdentityCurrent: isCurrent,
    nowMs,
    openDocument: async () => memory.port(),
  });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe('widget collaborative-state port', () => {
  test('converges two clients, tears down listeners, and replays state after reconnect', async () => {
    const memory = document();
    const collaborativeState = port(memory);
    const first = await collaborativeState.open({ identity, signal: signal(), isCurrent: () => true });
    const second = await collaborativeState.open({ identity, signal: signal(), isCurrent: () => true });

    expect(await first.get()).toEqual({ version: 1, value: null });
    const secondUpdate = second.next(1, 'second-update');
    await first.change({ count: 1, source: 'first' });
    await expect(secondUpdate).resolves.toEqual({
      version: 2,
      value: { count: 1, source: 'first' },
    });

    first.dispose();
    second.dispose();
    expect(memory.listeners.size).toBe(0);

    memory.replaceState({ count: 2, source: 'offline-peer' });
    const reconnected = await collaborativeState.open({ identity, signal: signal(), isCurrent: () => true });
    await expect(reconnected.get()).resolves.toEqual({
      version: 1,
      value: { count: 2, source: 'offline-peer' },
    });
    reconnected.dispose();
  });

  test('fails closed when the opened document belongs to another instance', async () => {
    const memory = document({ ...identity, widgetInstanceId: 'foreign-instance' });
    await expect(port(memory).open({ identity, signal: signal(), isCurrent: () => true }))
      .rejects.toThrow('identity mismatch');
    expect(memory.dispose).toHaveBeenCalledOnce();
    expect(memory.listeners.size).toBe(0);
  });

  test('terminates pending subscribers when identity changes or the session is disposed', async () => {
    const memory = document();
    const session = await port(memory).open({ identity, signal: signal(), isCurrent: () => true });
    const changed = session.next(1, 'identity-change');
    memory.replaceIdentity({ ...identity, canvasId: 'foreign-canvas' });
    await expect(changed).rejects.toThrow('identity mismatch');
    await expect(session.get()).rejects.toThrow('identity mismatch');

    const replacement = document();
    const disposed = await port(replacement).open({ identity, signal: signal(), isCurrent: () => true });
    const pending = disposed.next(1, 'dispose-wait');
    disposed.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(replacement.listeners.size).toBe(0);
  });

  test('rejects stale authority before opening or mutating state', async () => {
    const memory = document();
    let current = true;
    const collaborativeState = port(memory, () => current);
    const session = await collaborativeState.open({ identity, signal: signal(), isCurrent: () => current });
    current = false;

    await expect(session.change({ denied: true })).rejects.toThrow('authority');
    const controller = new AbortController();
    controller.abort();
    await expect(collaborativeState.open({
      identity,
      signal: controller.signal,
      isCurrent: () => current,
    }))
      .rejects.toThrow('authority');
  });

  test('enforces a deterministic per-session mutation rate limit', async () => {
    const memory = document();
    let now = 100;
    const session = await port(memory, () => true, () => now).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });

    for (let count = 1; count <= 20; count += 1) {
      await expect(session.change({ count })).resolves.toMatchObject({ value: { count } });
    }
    await expect(session.change({ count: 21 })).rejects.toThrow('rate limit');
    now += 1_000;
    await expect(session.change({ count: 22 })).resolves.toMatchObject({ value: { count: 22 } });
  });

  test('rejects non-JSON and oversized state without mutating the document', async () => {
    const memory = document();
    const session = await port(memory).open({
      identity,
      signal: signal(),
      isCurrent: () => true,
    });

    await expect(session.change({ value: Number.POSITIVE_INFINITY } as never))
      .rejects.toThrow('finite numbers');
    await expect(session.change('x'.repeat(64 * 1_024 + 1)))
      .rejects.toThrow('byte limit');
    expect(memory.value.state).toBeNull();
  });

  test('denies mutation immediately when the host exact-target callback becomes stale', async () => {
    const memory = document();
    let exactTargetCurrent = true;
    const session = await port(memory).open({
      identity,
      signal: signal(),
      isCurrent: () => exactTargetCurrent,
    });
    exactTargetCurrent = false;

    await expect(session.change({ denied: true })).rejects.toThrow('authority');
    expect(memory.value.state).toBeNull();
  });

  test('cancels pending long polls by id without consuming the bounded wait pool', async () => {
    const memory = document();
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
    await expect(retained).resolves.toMatchObject({ value: { count: 1 } });
    session.dispose();
  });
});
