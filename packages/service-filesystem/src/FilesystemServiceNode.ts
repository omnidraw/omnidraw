import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { fnScopedKey } from '@vibecanvas/tenant-core';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'fs';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'path';
import type { IFilesystemService } from './IFilesystemService';
import type {
  TFilesystemPathArgs,
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
  watcher: FSWatcher;
  abortController: AbortController;
  listeners: Set<string>;
  subscriptions: Map<string, AsyncIterator<TFilesystemWatchEvent>>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};

type TPathScopeFailure = 'capability_not_found' | 'outside_root';

type TResolvedPath =
  | { ok: true; path: string; rootKey: string; virtualPath: string }
  | { ok: false; reason: TPathScopeFailure };

const DEFAULT_WATCH_TTL_MS = 60 * 1000;

// TODO: [S57]
export class FilesystemServiceNode implements IFilesystemService {
  readonly name = 'filesystem' as const;

  readonly #roots = new Map<string, string>();
  readonly #watchersByPath = new Map<string, TWatchEntry>();
  readonly #watchIdToPath = new Map<string, string>();
  readonly #watchTtlMs: number;

  constructor(
    private readonly eventPublisher: IEventPublisherService,
    options: TFilesystemServiceOptions = {},
  ) {
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
      const abortController = new AbortController();
      const watcher = watch(resolved.path, { signal: abortController.signal });
      entry = {
        rootKey: resolved.rootKey,
        watcher,
        abortController,
        listeners: new Set(),
        subscriptions: new Map(),
        timeouts: new Map(),
      };

      watcher.on('change', (eventType: 'rename' | 'change', fileName) => {
        if (typeof fileName !== 'string') return;
        this.eventPublisher.publishFilesystemEvent(
          tenant,
          args.filesystemId,
          resolved.virtualPath,
          { eventType, fileName },
        );
      });

      watcher.on('close', () => {
        this.#releasePath(pathKey);
      });

      watcher.on('error', () => {
        this.#releasePath(pathKey);
      });

      this.#watchersByPath.set(pathKey, entry);
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
    entry.abortController.abort();
  }

  #releasePath(pathKey: string): void {
    const entry = this.#watchersByPath.get(pathKey);
    if (!entry) return;

    this.#watchersByPath.delete(pathKey);
    entry.abortController.abort();

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
