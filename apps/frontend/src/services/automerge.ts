/**
 * Automerge Client Service
 *
 * Provides CRDT sync capabilities for the SPA via WebSocket connection to the server.
 * Uses IndexedDB for local persistence.
 */
import { showErrorToast } from "@/components/ui/Toast"
import { orpcWebsocketService } from "@/services/orpc-websocket"
import { Repo, type AutomergeUrl, type DocHandle, type PeerId } from "@automerge/automerge-repo"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types"

// LocalStorage key for persisting document URLs
const DOCS_STORAGE_KEY = "vibecanvas-automerge-docs"

// Singleton repo instance
let repo: Repo | null = null

// Track handles by document ID
const handles = new Map<string, DocHandle<TCanvasDoc>>()

/**
 * Get WebSocket URL based on current environment.
 */
function getWebSocketUrl(): string {
  // In dev, SPA runs on 3001 but server is on 3000
  const isDev = import.meta.env.DEV
  if (isDev) {
    return "ws://localhost:3000/automerge"
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const host = window.location.host
  return `${protocol}//${host}/automerge`
}

/**
 * Initialize the Automerge repository (singleton).
 * Called once on app startup.
 */
export function getOrCreateRepo(): Repo {
  if (repo) return repo

  const wsUrl = getWebSocketUrl()

  const wsAdapter = new BrowserWebSocketClientAdapter(wsUrl)

  repo = new Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [wsAdapter],
    peerId: `client-${Date.now()}` as PeerId,
  })

  return repo
}

/**
 * Get persisted document URLs from localStorage.
 */
function getPersistedDocUrls(): Array<{ id: string; url: AutomergeUrl }> {
  try {
    const stored = localStorage.getItem(DOCS_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error("[Automerge] Failed to load persisted docs:", e)
  }
  return []
}

/**
 * Save document URLs to localStorage.
 */
function persistDocUrls(docs: Array<{ id: string; url: AutomergeUrl }>): void {
  try {
    localStorage.setItem(DOCS_STORAGE_KEY, JSON.stringify(docs))
  } catch (e) {
    console.error("[Automerge] Failed to persist docs:", e)
  }
}

/**
 * Add a document URL to persisted storage.
 */
function addPersistedDoc(id: string, url: AutomergeUrl): void {
  const docs = getPersistedDocUrls()
  if (!docs.find((d) => d.id === id)) {
    docs.push({ id, url })
    persistDocUrls(docs)
  }
}

/**
 * Remove a document URL from persisted storage.
 */
function removePersistedDoc(id: string): void {
  const docs = getPersistedDocUrls().filter((d) => d.id !== id)
  persistDocUrls(docs)
}

/**
 * Load all persisted documents from storage.
 * Returns handles for all previously created documents.
 */
export async function loadPersistedDocuments(): Promise<Array<{ handle: DocHandle<TCanvasDoc>; url: AutomergeUrl; doc: TCanvasDoc }>> {
  const currentRepo = getOrCreateRepo()
  const persistedDocs = getPersistedDocUrls()
  const results: Array<{ handle: DocHandle<TCanvasDoc>; url: AutomergeUrl; doc: TCanvasDoc }> = []

  for (const { id, url } of persistedDocs) {
    try {
      const handle = await Promise.resolve(currentRepo.find<TCanvasDoc>(url))
      await handle.whenReady()

      const doc = handle.docSync()
      if (doc && doc.id) {
        handles.set(id, handle)
        results.push({ handle, url, doc: { ...doc } })
      } else {
        // Document doesn't exist or is empty, remove from persisted
        removePersistedDoc(id)
      }
    } catch (e) {
      console.error("[Automerge] Failed to load document:", url, e)
      removePersistedDoc(id)
    }
  }

  return results
}


/**
 * Find an existing document by its Automerge URL.
 * Waits for the document to be ready before returning.
 */
export async function findDocument(url: AutomergeUrl): Promise<DocHandle<TCanvasDoc>> {
  const currentRepo = getOrCreateRepo()
  const handle = await Promise.resolve(currentRepo.find<TCanvasDoc>(url))
  await handle.whenReady()
  return handle
}

/**
 * Get a cached handle by document ID.
 */
export function getHandle(docId: string): DocHandle<TCanvasDoc> | undefined {
  return handles.get(docId)
}

/**
 * Get all cached handles.
 */
export function getAllHandles(): Map<string, DocHandle<TCanvasDoc>> {
  return handles
}

/**
 * Update a document's name.
 */
export function updateDocumentName(handle: DocHandle<TCanvasDoc>, name: string): void {
  handle.change((d) => {
    d.name = name
  })
}

/**
 * Delete a document from local cache and persisted storage.
 */
export function removeFromCache(docId: string): void {
  const handle = handles.get(docId)
  if (handle) {
    handle.removeAllListeners()
    handles.delete(docId)
    removePersistedDoc(docId)
  }
}

/**
 * Cleanup all handles.
 */
export function cleanup(): void {
  handles.forEach((handle) => handle.removeAllListeners())
  handles.clear()
}
