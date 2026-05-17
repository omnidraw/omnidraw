import type { Database } from 'bun:sqlite';
import { Repo, type DocHandle, type PeerId } from '@automerge/automerge-repo';
import { BunSqliteStorageAdapter } from './adapters/sqlite.adapter';
import { BunWSServerAdapter } from './adapters/websocket.adapter';
import type { IAutomergeService } from './IAutomergeService';
import type { TCanvasDoc, TElement } from './types/canvas-doc.types';

export class AutomergeService implements IAutomergeService {
  readonly name = 'automerge' as const;
  readonly repo: Repo;
  readonly wsAdapter: BunWSServerAdapter;
  #elementDeleteWatchedDocumentIds = new Set<string>();
  #elementDeleteScanInterval: ReturnType<typeof setInterval> | null = null;

  constructor(database: Database | string) {
    this.wsAdapter = new BunWSServerAdapter();
    const storage = typeof database === 'string'
      ? new BunSqliteStorageAdapter(database)
      : new BunSqliteStorageAdapter(database);

    this.repo = new Repo({
      storage,
      network: [this.wsAdapter],
      peerId: `server-${Date.now()}` as PeerId,
    });

    this.wsAdapter.connect(this.repo.peerId!);
    this.#startElementDeleteWatcher();
  }

  #startElementDeleteWatcher(): void {
    this.#watchKnownCanvasHandles();
    this.#elementDeleteScanInterval = setInterval(() => {
      this.#watchKnownCanvasHandles();
    }, 1000);
  }

  #watchKnownCanvasHandles(): void {
    const handles = Object.values(this.repo.handles) as Array<DocHandle<TCanvasDoc>>;
    for (const handle of handles) {
      this.#watchCanvasHandle(handle);
    }
  }

  #watchCanvasHandle(handle: DocHandle<TCanvasDoc>): void {
    if (this.#elementDeleteWatchedDocumentIds.has(handle.documentId)) {
      return;
    }

    this.#elementDeleteWatchedDocumentIds.add(handle.documentId);
    handle.on('change', ({ patchInfo }) => {
      const before = patchInfo.before as TCanvasDoc | undefined;
      const after = patchInfo.after as TCanvasDoc | undefined;
      const canvasId = after?.id ?? before?.id ?? handle.documentId;
      const beforeElements = before?.elements ?? {};
      const afterElements = after?.elements ?? {};

      for (const [elementId, element] of Object.entries(beforeElements)) {
        if (elementId in afterElements) {
          continue;
        }

        if (element.data.type !== 'image') {
          continue;
        }

        this.onElementDelete(canvasId, element);
      }
    });
  }

  private onElementDelete(canvasId: string, element: TElement): void {
    console.log('Automerge image element deleted', {
      canvasId,
      elementId: element.id,
      element,
    });
  }

  stop(): void {
    if (this.#elementDeleteScanInterval !== null) {
      clearInterval(this.#elementDeleteScanInterval);
      this.#elementDeleteScanInterval = null;
    }

    this.wsAdapter.disconnect();
  }
}
