import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { fnScopedKey } from '@vibecanvas/tenant-core';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'fs';
import { basename, dirname, isAbsolute, relative, resolve, sep, win32 } from 'path';
import type { IFilesystemService } from './IFilesystemService';
import type {
  TFilesystemPathArgs,
  TFilesystemNativeWatch,
  TFilesystemRenameArgs,
  TFilesystemRootRegistrationArgs,
  TFilesystemScopeArgs,
  TFilesystemServiceOptions,
  TFilesystemWatchArgs,
  TFilesystemWatchControlArgs,
  TFilesystemWatchEvent,
  TFilesystemWriteFileArgs,
} from './types';

type TWatchEntry = {
  rootKey: string;
  path: string;
  tenant: TTenantContext;
  filesystemId: string;
  virtualPath: string;
  watcher: FSWatcher | null;
  abortController: AbortController | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  snapshot: TWatchSnapshot | null;
  listeners: Set<string>;
  subscriptions: Map<string, AsyncIterator<TFilesystemWatchEvent>>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};

type TWatchSnapshot = Map<string, string>;

type TPathScopeFailure = 'capability_not_found' | 'outside_root';

type TResolvedPath =
  | { ok: true; path: string; rootKey: string; virtualPath: string }
  | { ok: false; reason: TPathScopeFailure };

const DEFAULT_WATCH_TTL_MS = 60 * 1000;
const DEFAULT_WATCH_POLL_INTERVAL_MS = 500;
const MIN_WATCH_POLL_INTERVAL_MS = 10;
const MAX_WATCH_POLL_INTERVAL_MS = 60 * 1000;

// TODO: [S57]
export class FilesystemServiceNode implements IFilesystemService {
  readonly name = 'filesystem' as const;

  readonly #roots = new Map<string, string>();
  readonly #watchersByPath = new Map<string, TWatchEntry>();
  readonly #watchIdToPath = new Map<string, string>();
  readonly #nativeWatch: TFilesystemNativeWatch;
  readonly #watchPollIntervalMs: number;
  readonly #watchTtlMs: number;

  constructor(
    private readonly eventPublisher: IEventPublisherService,
    options: TFilesystemServiceOptions = {},
  ) {
    this.#nativeWatch = options.nativeWatch ?? watch;
    const requestedPollIntervalMs = options.watchPollIntervalMs ?? DEFAULT_WATCH_POLL_INTERVAL_MS;
    this.#watchPollIntervalMs = Number.isFinite(requestedPollIntervalMs)
      ? Math.min(
        MAX_WATCH_POLL_INTERVAL_MS,
        Math.max(MIN_WATCH_POLL_INTERVAL_MS, Math.floor(requestedPollIntervalMs)),
      )
      : DEFAULT_WATCH_POLL_INTERVAL_MS;
    this.#watchTtlMs = options.watchTtlMs ?? DEFAULT_WATCH_TTL_MS;
  }

  registerRoot(tenant: TTenantContext, args: TFilesystemRootRegistrationArgs): void {
    const candidate = realpathSync(resolve(args.rootPath));
    if (!statSync(candidate).isDirectory()) {
      throw new Error('Filesystem root must be a directory');
    }

    const rootKey = this.#rootKey(tenant, args.filesystemId);
    const existing = this.#roots.get(rootKey);
    if (existing && existing !== candidate) {
      throw new Error('Filesystem capability is already registered');
    }

    this.#roots.set(rootKey, candidate);
  }

  unregisterRoot(tenant: TTenantContext, args: TFilesystemScopeArgs): void {
    const rootKey = this.#rootKey(tenant, args.filesystemId);
    if (!this.#roots.delete(rootKey)) return;

    for (const [pathKey, entry] of this.#watchersByPath) {
      if (entry.rootKey === rootKey) this.#releasePath(pathKey);
    }
  }

  resolveHostPath(tenant: TTenantContext, args: TFilesystemPathArgs): string | null {
    const resolved = this.#resolveAuthorizedPath(tenant, args);
    return resolved.ok ? resolved.path : null;
  }

  homeDir(tenant: TTenantContext, args: TFilesystemScopeArgs): string | null {
    return this.#roots.has(this.#rootKey(tenant, args.filesystemId)) ? '' : null;
  }

  exists(tenant: TTenantContext, args: TFilesystemPathArgs): boolean {
    const resolved = this.#resolveAuthorizedPath(tenant, args);
    return resolved.ok && existsSync(resolved.path);
  }

  readdir(tenant: TTenantContext, args: TFilesystemPathArgs): TErrTuple<import('fs').Dirent[]> {
    const resolved = this.#resolveAuthorizedPath(tenant, args);
    if (!resolved.ok) return [null, this.#scopeError(resolved.reason)];

    try {
      return [readdirSync(resolved.path, { withFileTypes: true }), null];
    } catch (error) {
      return [null, this.#toFilesystemError(error, 'SRV.FILESYSTEM.READDIR.FAILED', 'Failed to read directory')];
    }
  }

  stat(tenant: TTenantContext, args: TFilesystemPathArgs): TErrTuple<import('fs').Stats> {
    const resolved = this.#resolveAuthorizedPath(tenant, args);
    if (!resolved.ok) return [null, this.#scopeError(resolved.reason)];

    try {
      return [statSync(resolved.path), null];
    } catch (error) {
      return [null, this.#toFilesystemError(error, 'SRV.FILESYSTEM.STAT.FAILED', 'Failed to stat path')];
    }
  }

  readFile(tenant: TTenantContext, args: TFilesystemPathArgs): TErrTuple<Buffer> {
    const resolved = this.#resolveAuthorizedPath(tenant, args);
    if (!resolved.ok) return [null, this.#scopeError(resolved.reason)];

    try {
      return [readFileSync(resolved.path), null];
    } catch (error) {
      return [null, this.#toFilesystemError(error, 'SRV.FILESYSTEM.READ.FAILED', 'Failed to read file')];
    }
  }

  writeFile(tenant: TTenantContext, args: TFilesystemWriteFileArgs): TErrTuple<void> {
    const resolved = this.#resolveAuthorizedPath(tenant, args);
    if (!resolved.ok) return [null, this.#scopeError(resolved.reason)];

    try {
      writeFileSync(resolved.path, args.content, 'utf8');
      return [undefined, null];
    } catch (error) {
      return [null, this.#toFilesystemError(error, 'SRV.FILESYSTEM.WRITE.FAILED', 'Failed to write file')];
    }
  }

  rename(tenant: TTenantContext, args: TFilesystemRenameArgs): TErrTuple<void> {
    const source = this.#resolveAuthorizedPath(tenant, {
      filesystemId: args.filesystemId,
      path: args.sourcePath,
    });
    const target = this.#resolveAuthorizedPath(tenant, {
      filesystemId: args.filesystemId,
      path: args.targetPath,
    });
    if (!source.ok) return [null, this.#scopeError(source.reason)];
    if (!target.ok) return [null, this.#scopeError(target.reason)];

    try {
      renameSync(source.path, target.path);
      return [undefined, null];
    } catch (error) {
      return [null, this.#toFilesystemError(error, 'SRV.FILESYSTEM.RENAME.FAILED', 'Failed to rename path')];
    }
  }

  watch(tenant: TTenantContext, args: TFilesystemWatchArgs): AsyncIterable<TFilesystemWatchEvent> | null {
    const resolved = this.#resolveAuthorizedPath(tenant, args);
    if (!resolved.ok) return null;

    const watchKey = this.#watchKey(tenant, args.filesystemId, args.watchId);
    if (this.#watchIdToPath.has(watchKey)) return null;
    const afterSequence = this.eventPublisher.getFilesystemEventCursor(tenant, args.filesystemId);

    const pathKey = fnScopedKey('filesystem-watch-path', [
      tenant.orgId,
      tenant.cellId,
      `${tenant.placementEpoch}`,
      args.filesystemId,
      resolved.path,
    ]);
    let entry = this.#watchersByPath.get(pathKey);

    if (!entry) {
      entry = {
        rootKey: resolved.rootKey,
        path: resolved.path,
        tenant,
        filesystemId: args.filesystemId,
        virtualPath: resolved.virtualPath,
        watcher: null,
        abortController: null,
        pollTimer: null,
        snapshot: this.#readWatchSnapshot(resolved.path),
        listeners: new Set(),
        subscriptions: new Map(),
        timeouts: new Map(),
      };
      this.#watchersByPath.set(pathKey, entry);
      entry.pollTimer = setInterval(() => this.#pollWatchPath(pathKey), this.#watchPollIntervalMs);
      entry.pollTimer.unref?.();
      this.#startNativeWatch(pathKey, entry);
    }

    entry.listeners.add(watchKey);
    this.#watchIdToPath.set(watchKey, pathKey);
    this.#resetTimeout(pathKey, watchKey);

    const subscription = this.eventPublisher.subscribeFilesystemEvents(
      tenant,
      args.filesystemId,
      resolved.virtualPath,
      { afterSequence },
    )[Symbol.asyncIterator]();
    entry.subscriptions.set(watchKey, subscription);

    const iterator: AsyncIterator<TFilesystemWatchEvent> = {
      next: () => subscription.next(),
      return: async () => {
        this.#unwatchKeys(watchKey);
        return { done: true, value: undefined };
      },
    };
    return {
      [Symbol.asyncIterator]: () => iterator,
    };
  }

  keepalive(tenant: TTenantContext, args: TFilesystemWatchControlArgs): boolean {
    const watchKey = this.#watchKey(tenant, args.filesystemId, args.watchId);
    const pathKey = this.#watchIdToPath.get(watchKey);
    if (!pathKey || !this.#watchersByPath.has(pathKey)) return false;
    this.#resetTimeout(pathKey, watchKey);
    return true;
  }

  unwatch(tenant: TTenantContext, args: TFilesystemWatchControlArgs): void {
    const watchKey = this.#watchKey(tenant, args.filesystemId, args.watchId);
    this.#unwatchKeys(watchKey);
  }

  stop(): void {
    for (const pathKey of [...this.#watchersByPath.keys()]) {
      this.#releasePath(pathKey);
    }

    this.#watchIdToPath.clear();
    this.#roots.clear();
  }

  #rootKey(tenant: TTenantContext, filesystemId: string): string {
    return fnScopedKey('filesystem-root', [
      tenant.orgId,
      tenant.cellId,
      `${tenant.placementEpoch}`,
      filesystemId,
    ]);
  }

  #watchKey(tenant: TTenantContext, filesystemId: string, watchId: string): string {
    return fnScopedKey('filesystem-watch', [
      tenant.orgId,
      tenant.accountId,
      tenant.cellId,
      `${tenant.placementEpoch}`,
      filesystemId,
      watchId,
    ]);
  }

  #resolveAuthorizedPath(tenant: TTenantContext, args: TFilesystemPathArgs): TResolvedPath {
    const rootKey = this.#rootKey(tenant, args.filesystemId);
    const root = this.#roots.get(rootKey);
    if (!root) return { ok: false, reason: 'capability_not_found' };
    if (isAbsolute(args.path) || win32.isAbsolute(args.path) || args.path.includes('\\')) {
      return { ok: false, reason: 'outside_root' };
    }

    const candidate = resolve(root, args.path || '.');
    if (!this.#contains(root, candidate)) return { ok: false, reason: 'outside_root' };

    let existing = candidate;
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) return { ok: false, reason: 'outside_root' };
      existing = parent;
    }

    const canonicalExisting = realpathSync(existing);
    if (!this.#contains(root, canonicalExisting)) return { ok: false, reason: 'outside_root' };

    const path = existsSync(candidate)
      ? realpathSync(candidate)
      : resolve(canonicalExisting, relative(existing, candidate));
    if (!this.#contains(root, path)) return { ok: false, reason: 'outside_root' };
    return {
      ok: true,
      path,
      rootKey,
      virtualPath: relative(root, path).split(sep).join('/'),
    };
  }

  #contains(root: string, candidate: string): boolean {
    const fromRoot = relative(root, candidate);
    return fromRoot === ''
      || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
  }

  #scopeError(reason: TPathScopeFailure): TErrorEntry {
    if (reason === 'outside_root') {
      return {
        code: 'SRV.FILESYSTEM.PATH.OUTSIDE_ROOT',
        statusCode: 403,
        externalMessage: { en: 'Path is outside the registered filesystem root' },
      };
    }

    return {
      code: 'SRV.FILESYSTEM.CAPABILITY.NOT_FOUND',
      statusCode: 404,
      externalMessage: { en: 'Filesystem capability not found' },
    };
  }

  #toFilesystemError(error: unknown, fallbackCode: TErrorCode, fallbackMessage: string): TErrorEntry {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error ? (error.code as unknown) : null;

    if (errorCode === 'EPERM' || errorCode === 'EACCES') {
      return {
        code: `${fallbackCode.replace(/\.FAILED$/, '')}.PERMISSION_DENIED` as TErrorCode,
        statusCode: 403,
        externalMessage: { en: 'Permission denied' },
      };
    }

    if (errorCode === 'ENOENT') {
      return {
        code: `${fallbackCode.replace(/\.FAILED$/, '')}.NOT_FOUND` as TErrorCode,
        statusCode: 404,
        externalMessage: { en: 'Path not found' },
      };
    }

    return {
      code: fallbackCode,
      statusCode: 500,
      externalMessage: { en: fallbackMessage },
    };
  }

  #resetTimeout(pathKey: string, watchKey: string): void {
    const entry = this.#watchersByPath.get(pathKey);
    if (!entry) return;

    const existingTimeout = entry.timeouts.get(watchKey);
    if (existingTimeout) clearTimeout(existingTimeout);

    entry.timeouts.set(watchKey, setTimeout(() => {
      this.#unwatchKeys(watchKey);
    }, this.#watchTtlMs));
  }

  #startNativeWatch(pathKey: string, entry: TWatchEntry): void {
    const abortController = new AbortController();
    let watcher: FSWatcher;
    try {
      watcher = this.#nativeWatch(entry.path, { signal: abortController.signal });
    } catch {
      abortController.abort();
      return;
    }

    entry.watcher = watcher;
    entry.abortController = abortController;
    watcher.on('change', () => {
      const currentEntry = this.#watchersByPath.get(pathKey);
      if (currentEntry !== entry || currentEntry.watcher !== watcher) return;
      this.#pollWatchPath(pathKey);
    });
    watcher.on('close', () => {
      if (entry.watcher !== watcher) return;
      entry.watcher = null;
      entry.abortController = null;
    });
    watcher.on('error', () => {
      if (entry.watcher !== watcher) return;
      entry.watcher = null;
      entry.abortController = null;
      abortController.abort();
    });
  }

  #pollWatchPath(pathKey: string): void {
    const entry = this.#watchersByPath.get(pathKey);
    if (!entry) return;
    const nextSnapshot = this.#readWatchSnapshot(entry.path);
    if (!nextSnapshot) return;
    const previousSnapshot = entry.snapshot;
    entry.snapshot = nextSnapshot;
    if (!previousSnapshot) return;

    for (const fileName of previousSnapshot.keys()) {
      if (!nextSnapshot.has(fileName)) this.#publishWatchEvent(entry, 'rename', fileName);
    }
    for (const [fileName, fingerprint] of nextSnapshot) {
      const previousFingerprint = previousSnapshot.get(fileName);
      if (previousFingerprint === undefined) {
        this.#publishWatchEvent(entry, 'rename', fileName);
      } else if (previousFingerprint !== fingerprint) {
        this.#publishWatchEvent(entry, 'change', fileName);
      }
    }
  }

  #readWatchSnapshot(path: string): TWatchSnapshot | null {
    try {
      const stats = lstatSync(path);
      if (!stats.isDirectory()) {
        return new Map([[basename(path), this.#watchFingerprint(stats)]]);
      }

      const snapshot: TWatchSnapshot = new Map();
      for (const dirent of readdirSync(path, { withFileTypes: true })) {
        try {
          snapshot.set(dirent.name, this.#watchFingerprint(lstatSync(resolve(path, dirent.name))));
        } catch {
          snapshot.set(dirent.name, `entry:${dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : 'other'}`);
        }
      }
      return snapshot;
    } catch {
      return null;
    }
  }

  #watchFingerprint(stats: import('fs').Stats): string {
    return `${stats.mode}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
  }

  #publishWatchEvent(entry: TWatchEntry, eventType: 'rename' | 'change', fileName: string): void {
    this.eventPublisher.publishFilesystemEvent(
      entry.tenant,
      entry.filesystemId,
      entry.virtualPath,
      { eventType, fileName },
    );
  }

  #unwatchKeys(watchKey: string): void {
    const pathKey = this.#watchIdToPath.get(watchKey);
    if (!pathKey) return;

    const entry = this.#watchersByPath.get(pathKey);
    this.#watchIdToPath.delete(watchKey);
    if (!entry) return;

    this.#closeSubscription(entry, watchKey);

    const timeout = entry.timeouts.get(watchKey);
    if (timeout) {
      clearTimeout(timeout);
      entry.timeouts.delete(watchKey);
    }

    entry.listeners.delete(watchKey);
    if (entry.listeners.size > 0) return;

    this.#watchersByPath.delete(pathKey);
    if (entry.pollTimer !== null) clearInterval(entry.pollTimer);
    entry.abortController?.abort();
  }

  #releasePath(pathKey: string): void {
    const entry = this.#watchersByPath.get(pathKey);
    if (!entry) return;

    this.#watchersByPath.delete(pathKey);
    if (entry.pollTimer !== null) clearInterval(entry.pollTimer);
    entry.abortController?.abort();

    for (const watchKey of entry.listeners) {
      this.#watchIdToPath.delete(watchKey);
      this.#closeSubscription(entry, watchKey);
      const timeout = entry.timeouts.get(watchKey);
      if (timeout) clearTimeout(timeout);
    }

    entry.listeners.clear();
    entry.subscriptions.clear();
    entry.timeouts.clear();
  }

  #closeSubscription(entry: TWatchEntry, watchKey: string): void {
    const subscription = entry.subscriptions.get(watchKey);
    if (!subscription) return;
    entry.subscriptions.delete(watchKey);
    void Promise.resolve(subscription.return?.()).catch(() => undefined);
  }
}
