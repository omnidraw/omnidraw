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
  readonly handles: Map<string, DocHandle<TCanvasDoc>>;
  readonly repo: Repo;
  readonly scope: TBrowserTenantScope;
  readonly trackedHandles: Set<DocHandle<TCanvasDoc>>;
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
  for (const handle of session.trackedHandles) handle.removeAllListeners();
  session.handles.clear();
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
