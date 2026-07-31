import { afterEach, describe, expect, test, vi } from 'vitest';
import type { TBrowserTenantScope } from '@omnidraw/canvas/fn.browser-tenant-scope';
import {
  activateBrowserTenantScope,
  getBrowserTenantScope,
} from './tenant';

const stateApi = vi.hoisted(() => ({
  change: vi.fn(),
  events: vi.fn(),
  get: vi.fn(),
}));

vi.mock('./orpc-websocket', () => ({
  orpcWebsocketService: {
    apiService: {
      api: {
        widget: {
          runtime: {
            state: stateApi,
          },
        },
      },
    },
  },
}));

import { widgetCollaborativeStatePort } from './widget-collaborative-state';

const originalScope = getBrowserTenantScope();

function tenantScope(): TBrowserTenantScope {
  return Object.freeze({
    accountId: 'account-a',
    cellId: 'cell-a',
    deploymentOrigin: 'https://cloud.example',
    orgId: 'org-a',
    placementEpoch: 1,
  });
}

function identity(scope = tenantScope()) {
  return Object.freeze({
    orgId: scope.orgId,
    canvasId: 'canvas-a',
    elementId: 'element-a',
    widgetInstanceId: 'instance-a',
    definitionId: 'definition-a',
    revisionId: 'revision-a',
  });
}

function storedSnapshot(version: number, state: unknown) {
  return Object.freeze({
    identity: identity(),
    version,
    state,
  });
}

class EventQueue implements AsyncIterableIterator<Readonly<{
  type: 'changed';
  snapshot: ReturnType<typeof storedSnapshot>;
}>> {
  readonly returnSpy = vi.fn(async () => {
    this.#pending?.({ done: true, value: undefined });
    this.#pending = null;
    return { done: true, value: undefined } as const;
  });
  #pending: ((result: IteratorResult<Readonly<{
    type: 'changed';
    snapshot: ReturnType<typeof storedSnapshot>;
  }>>) => void) | null = null;

  push(version: number, state: unknown): void {
    const pending = this.#pending;
    if (!pending) throw new Error('Expected a pending state event read.');
    this.#pending = null;
    pending({
      done: false,
      value: {
        type: 'changed',
        snapshot: storedSnapshot(version, state),
      },
    });
  }

  async next(): Promise<IteratorResult<Readonly<{
    type: 'changed';
    snapshot: ReturnType<typeof storedSnapshot>;
  }>>> {
    return await new Promise((resolve) => {
      this.#pending = resolve;
    });
  }

  return() {
    return this.returnSpy();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Readonly<{
    type: 'changed';
    snapshot: ReturnType<typeof storedSnapshot>;
  }>> {
    return this;
  }
}

afterEach(() => {
  stateApi.change.mockReset();
  stateApi.events.mockReset();
  stateApi.get.mockReset();
  activateBrowserTenantScope(originalScope);
});

describe('widget collaborative-state browser adapter', () => {
  test('rejects an in-flight read when the same tenant scope is reactivated', async () => {
    const scope = tenantScope();
    activateBrowserTenantScope(scope);
    stateApi.get.mockImplementation(async () => {
      activateBrowserTenantScope({ ...scope });
      return [undefined, {
        status: 'found',
        snapshot: storedSnapshot(1, null),
      }];
    });

    await expect(widgetCollaborativeStatePort.open({
      identity: identity(scope),
      signal: new AbortController().signal,
      isCurrent: () => true,
    })).rejects.toThrow('tenant scope changed');

    expect(stateApi.get).toHaveBeenCalledWith({
      canvasId: 'canvas-a',
      elementId: 'element-a',
      widgetInstanceId: 'instance-a',
      definitionId: 'definition-a',
      revisionId: 'revision-a',
    }, { signal: expect.any(AbortSignal) });
    expect(stateApi.events).not.toHaveBeenCalled();
  });

  test('maps durable get, CAS, and event snapshots onto the host session', async () => {
    const scope = tenantScope();
    activateBrowserTenantScope(scope);
    const events = new EventQueue();
    stateApi.get.mockResolvedValue([undefined, {
      status: 'found',
      snapshot: storedSnapshot(1, null),
    }]);
    stateApi.change.mockResolvedValue([undefined, {
      status: 'changed',
      snapshot: storedSnapshot(2, { count: 1 }),
    }]);
    stateApi.events.mockResolvedValue([undefined, events]);

    const session = await widgetCollaborativeStatePort.open({
      identity: identity(scope),
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    await expect(session.change({ count: 1 })).resolves.toEqual({
      version: 2,
      value: { count: 1 },
    });
    expect(stateApi.change).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 1,
      state: { count: 1 },
    }), { signal: expect.any(AbortSignal) });

    const next = session.next(2, 'browser-event');
    await vi.waitFor(() => expect(events.returnSpy).not.toHaveBeenCalled());
    events.push(3, { count: 2 });
    await expect(next).resolves.toEqual({
      version: 3,
      value: { count: 2 },
    });
    session.dispose();
    await vi.waitFor(() => expect(events.returnSpy).toHaveBeenCalledOnce());
  });

  test('maps server mutation throttling to a rejected host mutation', async () => {
    const scope = tenantScope();
    activateBrowserTenantScope(scope);
    const events = new EventQueue();
    stateApi.get.mockResolvedValue([undefined, {
      status: 'found',
      snapshot: storedSnapshot(1, null),
    }]);
    stateApi.events.mockResolvedValue([undefined, events]);
    stateApi.change.mockResolvedValue([undefined, {
      status: 'rate-limited',
      retryAfterMs: 250,
    }]);
    const session = await widgetCollaborativeStatePort.open({
      identity: identity(scope),
      signal: new AbortController().signal,
      isCurrent: () => true,
    });

    await expect(session.change({ denied: true })).rejects.toThrow(
      'retry after 250ms',
    );
    session.dispose();
  });
});
