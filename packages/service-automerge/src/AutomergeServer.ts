import type { Database } from 'bun:sqlite';
import { Repo, type DocHandle, type PeerId, type StorageAdapterInterface } from '@automerge/automerge-repo';
import type { Database as TursoDatabase } from '@tursodatabase/database';
import { BunSqliteStorageAdapter } from './adapters/sqlite.adapter';
import { TursoStorageAdapter } from './adapters/turso.adapter';
import { BunWSServerAdapter } from './adapters/websocket.adapter';
import type { IAutomergeService } from './IAutomergeService';
import type { TCanvasDoc, TElement } from './types/canvas-doc.types';

export type TAutomergeStorageConfig =
  | string
  | Database
  | TursoDatabase
  | { type: 'sqlite'; database: string | Database }
  | { type: 'turso'; database: TursoDatabase };

export class AutomergeService implements IAutomergeService {
  readonly name = 'automerge' as const;
  readonly repo: Repo;
  readonly wsAdapter: BunWSServerAdapter;
  #elementDeleteWatchedDocumentIds = new Set<string>();
  #elementDeleteScanInterval: ReturnType<typeof setInterval> | null = null;
  #onElementDelete: (canvasId: string, element: TElement) => void;

  constructor(
    database: TAutomergeStorageConfig,
    onElementDelete: (canvasId: string, element: TElement) => void = () => {},
  ) {
    this.wsAdapter = new BunWSServerAdapter();
    const storage = this.#createStorageAdapter(database);

    this.repo = new Repo({
      storage,
      network: [this.wsAdapter],
      peerId: `server-${Date.now()}` as PeerId,
    });

    this.wsAdapter.connect(this.repo.peerId!);
    this.#onElementDelete = onElementDelete;
    this.#startElementDeleteWatcher();
  }

  #createStorageAdapter(database: TAutomergeStorageConfig): StorageAdapterInterface {
    if (typeof database === 'string') {
      return new BunSqliteStorageAdapter(database);
    }

    if (this.#isTursoDatabase(database)) {
      return new TursoStorageAdapter(database);
    }

    if ('type' in database) {
      if (database.type === 'turso') {
        return new TursoStorageAdapter(database.database);
      }

      if (typeof database.database === 'string') {
        return new BunSqliteStorageAdapter(database.database);
      }

      return new BunSqliteStorageAdapter(database.database);
    }

    return new BunSqliteStorageAdapter(database);
  }

  #isTursoDatabase(database: Exclude<TAutomergeStorageConfig, string>): database is TursoDatabase {
    return 'connect' in database && 'exec' in database && 'prepare' in database;
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

        this.#onElementDelete(canvasId, element);
      }
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
