/**
 * Tenant-scoped browser Automerge client. A placement or organization switch
 * tears down the previous Repo before any document from the next scope loads.
 */
import { Repo, type AutomergeUrl, type DocHandle, type PeerId } from '@automerge/automerge-repo';
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import type { TCanvasDoc } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import {
  fnBrowserTenantScopeKey,
  fnBrowserTenantScopesMatch,
  fnBrowserTenantStorageKeys,
  type TBrowserTenantScope,
} from './fn.browser-tenant-scope';

type TBrowserAutomergeSession = {
  readonly documentLeases: Map<DocHandle<any>, number>;
  readonly documentReleaseTails: Map<string, Promise<void>>;
  readonly handles: Map<string, DocHandle<TCanvasDoc>>;
  readonly repo: Repo;
  readonly scope: TBrowserTenantScope;
  readonly trackedHandles: Set<DocHandle<any>>;
  readonly wsAdapter: BrowserWebSocketClientAdapter;
};

let activeSession: TBrowserAutomergeSession | null = null;
let activationTail: Promise<void> = Promise.resolve();

function getWebSocketUrl(scope: TBrowserTenantScope): string {
  const origin = new URL(scope.deploymentOrigin);
  origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  origin.pathname = '/automerge';
  origin.search = '';
  origin.hash = '';
  return origin.toString();
}

function getPersistedDocUrls(scope: TBrowserTenantScope): Array<{ id: string; url: AutomergeUrl }> {
  try {
    const stored = localStorage.getItem(fnBrowserTenantStorageKeys(scope).documents);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('[Automerge] Failed to load persisted docs:', error);
    return [];
  }
}

function persistDocUrls(scope: TBrowserTenantScope, docs: Array<{ id: string; url: AutomergeUrl }>): void {
  try {
    localStorage.setItem(fnBrowserTenantStorageKeys(scope).documents, JSON.stringify(docs));
  } catch (error) {
    console.error('[Automerge] Failed to persist docs:', error);
  }
}

function removePersistedDoc(scope: TBrowserTenantScope, id: string): void {
  persistDocUrls(scope, getPersistedDocUrls(scope).filter((doc) => doc.id !== id));
}

async function shutdownActiveRepo(): Promise<void> {
  const session = activeSession;
  activeSession = null;
  if (!session) return;
  await Promise.allSettled(session.documentReleaseTails.values());
  for (const handle of session.trackedHandles) handle.removeAllListeners();
  session.handles.clear();
  session.documentLeases.clear();
  session.documentReleaseTails.clear();
  session.trackedHandles.clear();
  session.wsAdapter.disconnect();
  await session.repo.shutdown();
}

async function activateScope(scope: TBrowserTenantScope): Promise<void> {
  const nextScope = Object.freeze({ ...scope });
  activationTail = activationTail.catch(() => undefined).then(async () => {
    if (activeSession && fnBrowserTenantScopesMatch(activeSession.scope, nextScope)) return;
    await shutdownActiveRepo();

    const keys = fnBrowserTenantStorageKeys(nextScope);
    const wsAdapter = new BrowserWebSocketClientAdapter(getWebSocketUrl(nextScope));
    const repo = new Repo({
      storage: new IndexedDBStorageAdapter(keys.automergeDatabase, keys.automergeStore),
      network: [wsAdapter],
      peerId: `client-${fnBrowserTenantScopeKey(nextScope)}-${crypto.randomUUID()}` as PeerId,
    });
    activeSession = {
      documentLeases: new Map(),
      documentReleaseTails: new Map(),
      handles: new Map(),
      repo,
      scope: nextScope,
      trackedHandles: new Set(),
      wsAdapter,
    };
  });
  await activationTail;
}

async function getOrCreateSession(scope: TBrowserTenantScope): Promise<TBrowserAutomergeSession> {
  await activateScope(scope);
  const session = activeSession;
  if (!session || !fnBrowserTenantScopesMatch(session.scope, scope)) {
    throw new Error('Automerge Repo activation failed.');
  }
  return session;
}

function assertCurrentSession(session: TBrowserAutomergeSession): void {
  if (activeSession !== session) throw new Error('Automerge tenant scope changed.');
}

export async function getOrCreateRepo(scope: TBrowserTenantScope): Promise<Repo> {
  return (await getOrCreateSession(scope)).repo;
}

export async function loadPersistedDocuments(scope: TBrowserTenantScope): Promise<Array<{
  handle: DocHandle<TCanvasDoc>;
  url: AutomergeUrl;
  doc: TCanvasDoc;
}>> {
  const session = await getOrCreateSession(scope);
  const results: Array<{ handle: DocHandle<TCanvasDoc>; url: AutomergeUrl; doc: TCanvasDoc }> = [];

  for (const { id, url } of getPersistedDocUrls(scope)) {
    let handle: DocHandle<TCanvasDoc> | null = null;
    try {
      handle = await Promise.resolve(session.repo.find<TCanvasDoc>(url));
      session.trackedHandles.add(handle);
      await handle.whenReady();
      assertCurrentSession(session);
      const doc = handle.docSync();
      if (!doc?.id) {
        removePersistedDoc(scope, id);
        continue;
      }
      session.handles.set(id, handle);
      results.push({ handle, url, doc: { ...doc } });
    } catch (error) {
      handle?.removeAllListeners();
      if (handle) session.trackedHandles.delete(handle);
      if (activeSession !== session) throw error;
      console.error('[Automerge] Failed to load document:', url, error);
      removePersistedDoc(scope, id);
    }
  }

  return results;
}

export async function findDocument(
  scope: TBrowserTenantScope,
  url: AutomergeUrl,
): Promise<DocHandle<TCanvasDoc>> {
  const session = await getOrCreateSession(scope);
  const handle = await Promise.resolve(session.repo.find<TCanvasDoc>(url));
  session.trackedHandles.add(handle);
  try {
    await handle.whenReady();
    assertCurrentSession(session);
    const docId = handle.docSync()?.id;
    if (docId) session.handles.set(docId, handle);
  } catch (error) {
    handle.removeAllListeners();
    session.trackedHandles.delete(handle);
    throw error;
  }
  return handle;
}

/**
 * Opens a non-canvas document through the tenant-scoped shared Repo without
 * adding it to the canvas-id handle cache. Callers own only their listeners;
 * the tenant session owns the handle and connection lifecycle.
 */
export async function openAutomergeDocument<TDocument>(
  scope: TBrowserTenantScope,
  url: AutomergeUrl,
  signal?: AbortSignal,
): Promise<DocHandle<TDocument>> {
  const session = await getOrCreateSession(scope);
  let handle = await session.repo.find<TDocument>(url, { signal });
  const pendingRelease = session.documentReleaseTails.get(handle.documentId);
  if (pendingRelease) {
    await pendingRelease;
    assertCurrentSession(session);
    handle = await session.repo.find<TDocument>(url, { signal });
  }
  session.documentLeases.set(handle, (session.documentLeases.get(handle) ?? 0) + 1);
  session.trackedHandles.add(handle);
  try {
    // Repo.find may return a handle already used by another widget. This helper
    // installs no listeners, so a failed/aborted second open must not mutate the
    // shared handle. A lease keeps the shared handle cached until its last user
    // releases it.
    await handle.whenReady(undefined, { signal });
    assertCurrentSession(session);
    return handle;
  } catch (error) {
    await releaseAutomergeDocument(scope, handle);
    throw error;
  }
}

/** Releases one non-canvas document lease and evicts the last unused handle. */
export async function releaseAutomergeDocument<TDocument>(
  scope: TBrowserTenantScope,
  handle: DocHandle<TDocument>,
): Promise<void> {
  const session = activeSession;
  if (!session || !fnBrowserTenantScopesMatch(session.scope, scope)) return;

  const leaseCount = session.documentLeases.get(handle) ?? 0;
  if (leaseCount <= 0) return;
  if (leaseCount > 1) {
    session.documentLeases.set(handle, leaseCount - 1);
    return;
  }

  session.documentLeases.delete(handle);
  const documentId = handle.documentId;
  const previousTail = session.documentReleaseTails.get(documentId) ?? Promise.resolve();
  const releaseTail = previousTail.catch(() => undefined).then(async () => {
    if (
      activeSession !== session
      || (session.documentLeases.get(handle) ?? 0) > 0
    ) return;
    session.trackedHandles.delete(handle);
    await session.repo.removeFromCache(documentId);
  });
  session.documentReleaseTails.set(documentId, releaseTail);
  try {
    await releaseTail;
  } finally {
    if (session.documentReleaseTails.get(documentId) === releaseTail) {
      session.documentReleaseTails.delete(documentId);
    }
  }
}

export function getHandle(scope: TBrowserTenantScope, docId: string): DocHandle<TCanvasDoc> | undefined {
  return activeSession && fnBrowserTenantScopesMatch(activeSession.scope, scope)
    ? activeSession.handles.get(docId)
    : undefined;
}

export function getAllHandles(scope: TBrowserTenantScope): ReadonlyMap<string, DocHandle<TCanvasDoc>> {
  return activeSession && fnBrowserTenantScopesMatch(activeSession.scope, scope)
    ? new Map(activeSession.handles)
    : new Map();
}

export function updateDocumentName(handle: DocHandle<TCanvasDoc>, name: string): void {
  handle.change((document) => {
    document.name = name;
  });
}

export function removeFromCache(scope: TBrowserTenantScope, docId: string): void {
  const session = activeSession;
  if (!session || !fnBrowserTenantScopesMatch(session.scope, scope)) return;
  const handle = session.handles.get(docId);
  if (!handle) return;
  handle.removeAllListeners();
  session.handles.delete(docId);
  session.trackedHandles.delete(handle);
  removePersistedDoc(scope, docId);
}

export async function switchAutomergeTenant(scope: TBrowserTenantScope): Promise<void> {
  await activateScope(scope);
}

export async function cleanup(): Promise<void> {
  activationTail = activationTail.catch(() => undefined).then(shutdownActiveRepo);
  await activationTail;
}
