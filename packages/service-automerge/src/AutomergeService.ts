import { Repo, type DocHandle, type PeerId, type StorageAdapterInterface } from '@automerge/automerge-repo';
import type { Database as TursoDatabase } from '@tursodatabase/database';
import { TursoStorageAdapter } from './adapters/turso.adapter';
import { BunWSServerAdapter } from './adapters/websocket.adapter';
import type { IAutomergeService } from './IAutomergeService';
import type { TCanvasDoc, TElement } from './types/canvas-doc.types';

export type TAutomergeStorageConfig = TursoDatabase | { type: 'turso'; database: TursoDatabase };
export type TAutomergeElementEvent = {
  canvasDocId: string;
  automergeUrl: string;
  element: TElement;
};

export type TAutomergeCallbacks = {
  onElementDelete: (event: TAutomergeElementEvent, handle: DocHandle<TCanvasDoc>) => void;
  onElementCreate: (event: TAutomergeElementEvent, handle: DocHandle<TCanvasDoc>) => void;
};

export class AutomergeService implements IAutomergeService {
  readonly name = 'automerge' as const;
  #repo: Repo | null = null;
  readonly wsAdapter: BunWSServerAdapter;
  #elementDeleteWatchedDocumentIds = new Set<string>();
  #elementDeleteScanInterval: ReturnType<typeof setInterval> | null = null;
  #onElementDelete: (event: TAutomergeElementEvent) => void;
  #onElementCreate: (event: TAutomergeElementEvent) => void;

  constructor(
    private readonly database: TAutomergeStorageConfig,
    cb: TAutomergeCallbacks,
  ) {
    this.wsAdapter = new BunWSServerAdapter();
    this.#onElementDelete = cb.onElementDelete;
    this.#onElementCreate = cb.onElementCreate;
  }

  get repo(): Repo {
    if (this.#repo === null) {
      throw new Error('AutomergeService repo accessed before service start');
    }

    return this.#repo;
  }

  start(): void {
    if (this.#repo !== null) {
      return;
    }

    const storage = this.#createStorageAdapter(this.database);

    this.#repo = new Repo({
      storage,
      network: [this.wsAdapter],
      peerId: `server-${Date.now()}` as PeerId,
    });

    this.wsAdapter.connect(this.#repo.peerId!);
    this.#startElementDeleteWatcher();
  }

  #createStorageAdapter(database: TAutomergeStorageConfig): StorageAdapterInterface {
    if ('type' in database) {
      return new TursoStorageAdapter(database.database);
    }

    return new TursoStorageAdapter(database);
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
      const canvasDocId = after?.id ?? before?.id ?? handle.documentId;
      const beforeElements = before?.elements ?? {};
      const afterElements = after?.elements ?? {};

      for (const [elementId, element] of Object.entries(beforeElements)) {
        if (elementId in afterElements) {
          continue;
        }

        this.#onElementDelete({
          canvasDocId,
          automergeUrl: handle.url,
          element,
        }, handle);
      }

      for (const [elementId, element] of Object.entries(afterElements)) {
        if (elementId in beforeElements) {
          continue;
        }

        this.#onElementCreate({
          canvasDocId,
          automergeUrl: handle.url,
          element,
        }, handle);
      }
    });
  }


  stop(): void {
    if (this.#elementDeleteScanInterval !== null) {
      clearInterval(this.#elementDeleteScanInterval);
      this.#elementDeleteScanInterval = null;
    }

    this.wsAdapter.disconnect();
    this.#repo = null;
  }
}
