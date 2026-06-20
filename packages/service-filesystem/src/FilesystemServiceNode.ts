import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { existsSync, readFileSync, readdirSync, renameSync, statSync, watch, writeFileSync, type FSWatcher } from 'fs';
import { homedir } from 'os';
import type { IFilesystemService } from './IFilesystemService';
import type { TFilesystemWatchEvent } from './types';

type TWatchEntry = {
  watcher: FSWatcher;
  abortController: AbortController;
  listeners: Set<string>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};

const WATCH_TTL_MS = 60 * 1000;

// TODO: [S57]
export class FilesystemServiceNode implements IFilesystemService {
  readonly name = 'filesystem' as const;

  #watchersByPath = new Map<string, TWatchEntry>();
  #watchIdToPath = new Map<string, string>();

  constructor(private eventPublisher: IEventPublisherService) {
  }

  homeDir(_filesystemId: string): string {
    return homedir();
  }

  exists(_filesystemId: string, path: string): boolean {
    return existsSync(path);
  }

  readdir(_filesystemId: string, path: string): TErrTuple<import('fs').Dirent[]> {
    try {
      return [readdirSync(path, { withFileTypes: true }), null];
    } catch (error) {
      return [null, this.#toFilesystemError(error, 'SRV.FILESYSTEM.READDIR.FAILED', 'Failed to read directory')];
    }
  }

  stat(_filesystemId: string, path: string): TErrTuple<import('fs').Stats> {
    try {
      return [statSync(path), null];
    } catch (error) {
      return [null, this.#toFilesystemError(error, 'SRV.FILESYSTEM.STAT.FAILED', 'Failed to stat path')];
    }
  }

  readFile(_filesystemId: string, path: string): TErrTuple<Buffer> {
    try {
      return [readFileSync(path), null];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read file';
      return [null, {
        code: 'SRV.FILESYSTEM.READ.FAILED',
        statusCode: 500,
        externalMessage: { en: message },
      }];
    }
  }

  writeFile(_filesystemId: string, path: string, content: string): TErrTuple<void> {
    try {
      writeFileSync(path, content, 'utf8');
      return [undefined, null];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to write file';
      return [null, {
        code: 'SRV.FILESYSTEM.WRITE.FAILED',
        statusCode: 500,
        externalMessage: { en: message },
      }];
    }
  }

  rename(_filesystemId: string, sourcePath: string, targetPath: string): TErrTuple<void> {
    try {
      renameSync(sourcePath, targetPath);
      return [undefined, null];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename path';
      return [null, {
        code: 'SRV.FILESYSTEM.RENAME.FAILED',
        statusCode: 500,
        externalMessage: { en: message },
      }];
    }
  }

  watch(_filesystemId: string, path: string, watchId: string): AsyncIterable<TFilesystemWatchEvent> | null {
    if (this.#watchIdToPath.has(watchId)) return null;

    let entry = this.#watchersByPath.get(path);

    if (!entry) {
      const abortController = new AbortController();
      const watcher = watch(path, { signal: abortController.signal });
      entry = {
        watcher,
        abortController,
        listeners: new Set(),
        timeouts: new Map(),
      };

      watcher.on('change', (eventType: 'rename' | 'change', fileName) => {
        if (typeof fileName !== 'string') return;
        this.eventPublisher.publishFilesystemEvent(path, { eventType, fileName });
      });

      watcher.on('close', () => {
        this.#releasePath(path);
      });

      watcher.on('error', () => {
        this.#releasePath(path);
      });

      this.#watchersByPath.set(path, entry);
    }

    entry.listeners.add(watchId);
    this.#watchIdToPath.set(watchId, path);
    this.#resetTimeout(path, watchId);

    return this.eventPublisher.subscribeFilesystemEvents(path);
  }

  keepalive(_filesystemId: string, watchId: string): boolean {
    const path = this.#watchIdToPath.get(watchId);
    if (!path) return false;
    if (!this.#watchersByPath.has(path)) return false;
    this.#resetTimeout(path, watchId);
    return true;
  }

  unwatch(_filesystemId: string, watchId: string): void {
    const path = this.#watchIdToPath.get(watchId);
    if (!path) return;

    const entry = this.#watchersByPath.get(path);
    this.#watchIdToPath.delete(watchId);
    if (!entry) return;

    const timeout = entry.timeouts.get(watchId);
    if (timeout) {
      clearTimeout(timeout);
      entry.timeouts.delete(watchId);
    }

    entry.listeners.delete(watchId);
    if (entry.listeners.size > 0) return;

    this.#watchersByPath.delete(path);
    entry.abortController.abort();
  }

  stop(): void {
    for (const entry of this.#watchersByPath.values()) {
      for (const timeout of entry.timeouts.values()) {
        clearTimeout(timeout);
      }
      entry.abortController.abort();
    }

    this.#watchersByPath.clear();
    this.#watchIdToPath.clear();
  }

  #toFilesystemError(error: unknown, fallbackCode: TErrorCode, fallbackMessage: string): TErrorEntry {
    const message = error instanceof Error ? error.message : fallbackMessage;
    const errorCode = typeof error === 'object' && error !== null && 'code' in error ? (error.code as unknown) : null;

    if (errorCode === 'EPERM' || errorCode === 'EACCES') {
      return {
        code: `${fallbackCode.replace(/\.FAILED$/, '')}.PERMISSION_DENIED` as TErrorCode,
        statusCode: 403,
        externalMessage: { en: message },
      };
    }

    return {
      code: fallbackCode,
      statusCode: 500,
      externalMessage: { en: message },
    };
  }

  #resetTimeout(path: string, watchId: string) {
    const entry = this.#watchersByPath.get(path);
    if (!entry) return;

    const existingTimeout = entry.timeouts.get(watchId);
    if (existingTimeout) clearTimeout(existingTimeout);

    entry.timeouts.set(watchId, setTimeout(() => {
      this.unwatch('__local__', watchId);
    }, WATCH_TTL_MS));
  }

  #releasePath(path: string) {
    const entry = this.#watchersByPath.get(path);
    if (!entry) return;

    this.#watchersByPath.delete(path);

    for (const watchId of entry.listeners) {
      this.#watchIdToPath.delete(watchId);
      const timeout = entry.timeouts.get(watchId);
      if (timeout) clearTimeout(timeout);
    }

    entry.listeners.clear();
    entry.timeouts.clear();
  }
}
