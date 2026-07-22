import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fnBrowserTenantStorageKeys, type TBrowserTenantScope } from '../src/fn.browser-tenant-scope';

const fakes = vi.hoisted(() => {
  type TDeferred = {
    promise: Promise<void>;
    resolve(): void;
  };

  function deferred(): TDeferred {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  class FakeHandle {
    readonly ready = deferred();
    readyCalls = 0;
    removedListeners = 0;

    constructor(readonly url: string, readonly document: Record<string, unknown>) {}

    get documentId(): string {
      return this.url.replace('automerge:', '');
    }

    async whenReady(_states?: unknown, options?: { signal?: AbortSignal }): Promise<void> {
      this.readyCalls += 1;
      if (options?.signal?.aborted) throw new Error('aborted');
      await this.ready.promise;
    }

    docSync(): Record<string, unknown> {
      return this.document;
    }

    removeAllListeners(): void {
      this.removedListeners += 1;
    }
  }

  const handles = new Map<string, FakeHandle>();
  const webSockets: FakeWebSocketAdapter[] = [];

  class FakeRepo {
    readonly removedDocumentIds: string[] = [];
    shutdownCalls = 0;

    find(url: string): FakeHandle {
      const handle = handles.get(url);
      if (!handle) throw new Error(`Missing fake handle for ${url}`);
      return handle;
    }

    async shutdown(): Promise<void> {
      this.shutdownCalls += 1;
    }

    async removeFromCache(documentId: string): Promise<void> {
      this.removedDocumentIds.push(documentId);
    }
  }

  class FakeWebSocketAdapter {
    disconnectCalls = 0;
    constructor(readonly url: string) { webSockets.push(this); }
    disconnect(): void { this.disconnectCalls += 1; }
  }

  class FakeStorageAdapter {}

  return { FakeHandle, FakeRepo, FakeStorageAdapter, FakeWebSocketAdapter, handles, webSockets };
});

vi.mock('@automerge/automerge-repo', () => ({ Repo: fakes.FakeRepo }));
vi.mock('@automerge/automerge-repo-network-websocket', () => ({
  BrowserWebSocketClientAdapter: fakes.FakeWebSocketAdapter,
}));
vi.mock('@automerge/automerge-repo-storage-indexeddb', () => ({
  IndexedDBStorageAdapter: fakes.FakeStorageAdapter,
}));

const tenantA = Object.freeze({
  accountId: 'account-a',
  cellId: 'cell-a',
  deploymentOrigin: 'https://canvas.example',
  orgId: 'org-a',
  placementEpoch: 1,
}) satisfies TBrowserTenantScope;

const tenantB = Object.freeze({
  ...tenantA,
  accountId: 'account-b',
  orgId: 'org-b',
}) satisfies TBrowserTenantScope;

async function waitForReadyCall(handle: InstanceType<typeof fakes.FakeHandle>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (handle.readyCalls > 0) return;
    await Promise.resolve();
  }
  throw new Error('Fake handle was never awaited.');
}

describe('browser Automerge session isolation', () => {
  beforeEach(() => {
    fakes.handles.clear();
    fakes.webSockets.length = 0;
    localStorage.clear();
  });

  afterEach(async () => {
    const { cleanup } = await import('../src/automerge');
    await cleanup();
    vi.resetModules();
  });

  test('a stale persisted load cannot populate the next tenant handle cache', async () => {
    const handleA = new fakes.FakeHandle('automerge:tenant-a', {
      id: 'same-document-id',
      elements: {},
      groups: {},
    });
    fakes.handles.set(handleA.url, handleA);
    localStorage.setItem(
      fnBrowserTenantStorageKeys(tenantA).documents,
      JSON.stringify([{ id: 'same-document-id', url: handleA.url }]),
    );

    const automerge = await import('../src/automerge');
    const loadingA = automerge.loadPersistedDocuments(tenantA);
    await waitForReadyCall(handleA);
    await automerge.switchAutomergeTenant(tenantB);
    handleA.ready.resolve();

    await expect(loadingA).rejects.toThrow('Automerge tenant scope changed.');
    expect(automerge.getHandle(tenantB, 'same-document-id')).toBeUndefined();
    expect(handleA.removedListeners).toBeGreaterThan(0);
  });

  test('a stale find cannot return a handle after an organization switch', async () => {
    const handleA = new fakes.FakeHandle('automerge:tenant-a-find', {
      id: 'tenant-a-document',
      elements: {},
      groups: {},
    });
    fakes.handles.set(handleA.url, handleA);

    const automerge = await import('../src/automerge');
    const findingA = automerge.findDocument(tenantA, handleA.url as never);
    await waitForReadyCall(handleA);
    await automerge.switchAutomergeTenant(tenantB);
    handleA.ready.resolve();

    await expect(findingA).rejects.toThrow('Automerge tenant scope changed.');
    expect(handleA.removedListeners).toBeGreaterThan(0);
  });

  test('a returned Canvas handle is detached when its tenant scope is replaced', async () => {
    const handleA = new fakes.FakeHandle('automerge:tenant-a-active', {
      id: 'tenant-a-active-document',
      elements: {},
      groups: {},
    });
    handleA.ready.resolve();
    fakes.handles.set(handleA.url, handleA);

    const automerge = await import('../src/automerge');
    await expect(automerge.findDocument(tenantA, handleA.url as never)).resolves.toBe(handleA);
    expect(automerge.getHandle(tenantA, 'tenant-a-active-document')).toBe(handleA);

    await automerge.switchAutomergeTenant(tenantB);

    expect(handleA.removedListeners).toBeGreaterThan(0);
    expect(automerge.getHandle(tenantA, 'tenant-a-active-document')).toBeUndefined();
  });

  test('an aborted second shared-document open does not detach the first user', async () => {
    const handle = new fakes.FakeHandle('automerge:shared-widget-state', {
      schemaVersion: 1,
      identity: {},
      state: null,
    });
    handle.ready.resolve();
    fakes.handles.set(handle.url, handle);

    const automerge = await import('../src/automerge');
    await expect(automerge.openAutomergeDocument(tenantA, handle.url as never))
      .resolves.toBe(handle);
    const controller = new AbortController();
    controller.abort();
    await expect(automerge.openAutomergeDocument(
      tenantA,
      handle.url as never,
      controller.signal,
    )).rejects.toThrow('aborted');

    expect(handle.removedListeners).toBe(0);
    await automerge.releaseAutomergeDocument(tenantA, handle as never);
    expect(handle.removedListeners).toBe(0);
  });

  test('a shared state handle remains cached until its last lease is released', async () => {
    const handle = new fakes.FakeHandle('automerge:shared-state-leases', {
      schemaVersion: 1,
      identity: {},
      state: null,
    });
    handle.ready.resolve();
    fakes.handles.set(handle.url, handle);

    const automerge = await import('../src/automerge');
    await automerge.openAutomergeDocument(tenantA, handle.url as never);
    await automerge.openAutomergeDocument(tenantA, handle.url as never);
    const repo = await automerge.getOrCreateRepo(tenantA) as unknown as InstanceType<typeof fakes.FakeRepo>;

    await automerge.releaseAutomergeDocument(tenantA, handle as never);
    expect(repo.removedDocumentIds).toEqual([]);
    await automerge.releaseAutomergeDocument(tenantA, handle as never);
    expect(repo.removedDocumentIds).toEqual(['shared-state-leases']);
  });

  test('repeated state opens and releases do not retain document handles', async () => {
    const handle = new fakes.FakeHandle('automerge:repeated-state', {
      schemaVersion: 1,
      identity: {},
      state: null,
    });
    handle.ready.resolve();
    fakes.handles.set(handle.url, handle);

    const automerge = await import('../src/automerge');
    const repo = await automerge.getOrCreateRepo(tenantA) as unknown as InstanceType<typeof fakes.FakeRepo>;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const opened = await automerge.openAutomergeDocument(tenantA, handle.url as never);
      await automerge.releaseAutomergeDocument(tenantA, opened);
    }

    expect(repo.removedDocumentIds).toHaveLength(25);
  });

  test('an origin switch connects Automerge to the new deployment cell', async () => {
    const automerge = await import('../src/automerge');

    await automerge.switchAutomergeTenant(tenantA);
    await automerge.switchAutomergeTenant({
      ...tenantB,
      deploymentOrigin: 'https://cell-b.example:9443/ignored?old=1',
    });

    expect(fakes.webSockets.map((adapter) => adapter.url)).toEqual([
      'wss://canvas.example/automerge',
      'wss://cell-b.example:9443/automerge',
    ]);
    expect(fakes.webSockets[0]?.disconnectCalls).toBe(1);
  });
});
