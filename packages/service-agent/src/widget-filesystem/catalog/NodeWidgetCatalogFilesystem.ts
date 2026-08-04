import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  open,
  opendir,
  realpath,
} from 'node:fs/promises';
import {
  dirname,
  join,
  parse,
  resolve,
} from 'node:path';
import { TextDecoder } from 'node:util';
import type {
  TPinnedWidgetCatalogRoot,
  TWidgetCatalogDirectoryObservation,
  TWidgetCatalogFilesystemEntry,
  TWidgetCatalogFilesystemPortal,
  TWidgetCatalogHashPortal,
} from './typed';

type TStats = Awaited<ReturnType<typeof lstat>>;

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function statsIdentity(value: TStats): string {
  return [
    Number(value.dev),
    Number(value.ino),
    Number(value.size),
    Number(value.mtimeMs),
    Number(value.ctimeMs),
  ].join(':');
}

function sameIdentity(left: TStats, right: TStats): boolean {
  return left.isDirectory() === right.isDirectory()
    && left.isFile() === right.isFile()
    && left.isSymbolicLink() === right.isSymbolicLink()
    && Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino)
    && Number(left.size) === Number(right.size)
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function safeRelativeSegments(relativePath: string): readonly string[] {
  if (relativePath === '') return [];
  if (
    relativePath !== relativePath.trim()
    || relativePath.startsWith('/')
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relativePath)
    || relativePath.includes('\\')
    || relativePath.includes('\0')
    || /[\u0000-\u001f\u007f]/.test(relativePath)
    || relativePath !== relativePath.normalize('NFC')
  ) throw errorWithCode('Unsafe widget catalog relative path.', 'WIDGET_CATALOG_PATH_UNSAFE');
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw errorWithCode('Unsafe widget catalog relative path.', 'WIDGET_CATALOG_PATH_UNSAFE');
  }
  return segments;
}

function entryKind(value: TStats): TWidgetCatalogFilesystemEntry['kind'] {
  if (value.isSymbolicLink()) return 'symlink';
  if (value.isDirectory()) return 'directory';
  if (value.isFile()) return 'file';
  return 'special';
}

async function assertLexicalAncestors(path: string): Promise<void> {
  const root = parse(path).root;
  const segments = path.slice(root.length).split('/').filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const value = await lstat(current);
    if (value.isSymbolicLink()) {
      const rootOwnedFilesystemAlias = dirname(current) === root && Number(value.uid) === 0;
      if (rootOwnedFilesystemAlias) continue;
      throw errorWithCode(
        `Widget catalog root has a symlinked ancestor '${current}'.`,
        'WIDGET_CATALOG_ROOT_INVALID',
      );
    }
    if (!value.isDirectory()) {
      throw errorWithCode(
        `Widget catalog root ancestor '${current}' is not a directory.`,
        'WIDGET_CATALOG_ROOT_INVALID',
      );
    }
  }
}

/** No-follow filesystem implementation. The scanner itself still receives this as a port. */
export class NodeWidgetCatalogFilesystem implements TWidgetCatalogFilesystemPortal {
  async pinRoot(args: Readonly<{ requestedPath: string }>): Promise<TPinnedWidgetCatalogRoot> {
    const requestedPath = resolve(args.requestedPath);
    await assertLexicalAncestors(requestedPath);
    const requestedValue = await lstat(requestedPath);
    if (!requestedValue.isDirectory() || requestedValue.isSymbolicLink()) {
      throw errorWithCode(
        'Widget catalog root must be a real directory.',
        'WIDGET_CATALOG_ROOT_INVALID',
      );
    }
    const canonicalPath = await realpath(requestedPath);
    await assertLexicalAncestors(canonicalPath);
    const value = await lstat(canonicalPath);
    return Object.freeze({
      canonicalPath,
      identity: `${Number(value.dev)}:${Number(value.ino)}`,
    });
  }

  async assertRoot(
    root: TPinnedWidgetCatalogRoot,
    _args: Readonly<Record<string, never>>,
  ): Promise<void> {
    const value = await lstat(root.canonicalPath).catch(() => null);
    if (
      value === null
      || !value.isDirectory()
      || value.isSymbolicLink()
      || `${Number(value.dev)}:${Number(value.ino)}` !== root.identity
      || await realpath(root.canonicalPath).catch(() => null) !== root.canonicalPath
    ) {
      throw errorWithCode(
        'Pinned widget catalog root identity changed.',
        'WIDGET_CATALOG_ROOT_CHANGED',
      );
    }
  }

  async readDirectory(
    root: TPinnedWidgetCatalogRoot,
    args: Readonly<{ relativePath: string; maxEntries: number }>,
  ): Promise<TWidgetCatalogDirectoryObservation> {
    return this.#observeDirectory(root, args);
  }

  async assertDirectoryUnchanged(
    root: TPinnedWidgetCatalogRoot,
    args: Readonly<{
      observation: TWidgetCatalogDirectoryObservation;
      maxEntries: number;
    }>,
  ): Promise<void> {
    const next = await this.#observeDirectory(root, {
      relativePath: args.observation.relativePath,
      maxEntries: args.maxEntries,
    });
    if (next.token !== args.observation.token) {
      throw errorWithCode(
        `Widget catalog directory '${args.observation.relativePath || '.'}' changed during scan.`,
        'WIDGET_CATALOG_DIRECTORY_CHANGED',
      );
    }
  }

  async readFile(
    root: TPinnedWidgetCatalogRoot,
    args: Readonly<{ relativePath: string; maxBytes: number }>,
  ): Promise<Uint8Array> {
    if (!Number.isSafeInteger(args.maxBytes) || args.maxBytes < 0) {
      throw new TypeError('Widget catalog read limit must be a non-negative integer.');
    }
    const segments = safeRelativeSegments(args.relativePath);
    if (segments.length === 0) {
      throw errorWithCode('Widget catalog root is not a file.', 'WIDGET_CATALOG_PATH_UNSAFE');
    }
    await this.assertRoot(root, {});
    await this.#assertDirectoryChain(root, segments.slice(0, -1));
    const path = join(root.canonicalPath, ...segments);
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw errorWithCode(
        `Widget catalog entry '${args.relativePath}' is not a regular file.`,
        'WIDGET_CATALOG_FILE_INVALID',
      );
    }
    if (before.size > args.maxBytes) {
      throw errorWithCode(
        `Widget catalog file '${args.relativePath}' exceeds its read limit.`,
        'WIDGET_CATALOG_FILE_LIMIT',
      );
    }

    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat();
      const openedPath = await this.#openedCanonicalPath(handle.fd);
      if (!sameIdentity(before, opened) || openedPath !== path) {
        throw errorWithCode(
          `Widget catalog file '${args.relativePath}' changed before reading.`,
          'WIDGET_CATALOG_FILE_CHANGED',
        );
      }
      const bytes = Buffer.allocUnsafe(before.size);
      let offset = 0;
      while (offset < before.size) {
        const read = await handle.read(bytes, offset, before.size - offset, offset);
        if (read.bytesRead === 0) {
          throw errorWithCode(
            `Widget catalog file '${args.relativePath}' changed while reading.`,
            'WIDGET_CATALOG_FILE_CHANGED',
          );
        }
        offset += read.bytesRead;
      }
      const probe = Buffer.allocUnsafe(1);
      const eof = await handle.read(probe, 0, 1, before.size);
      const afterHandle = await handle.stat();
      const afterPath = await lstat(path).catch(() => null);
      if (
        eof.bytesRead !== 0
        || afterPath === null
        || !sameIdentity(before, afterHandle)
        || !sameIdentity(before, afterPath)
      ) {
        throw errorWithCode(
          `Widget catalog file '${args.relativePath}' changed while reading.`,
          'WIDGET_CATALOG_FILE_CHANGED',
        );
      }
      await this.assertRoot(root, {});
      return new Uint8Array(bytes);
    } finally {
      await handle.close();
    }
  }

  decodeUtf8(args: Readonly<{ bytes: Uint8Array }>): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(args.bytes);
  }

  async #observeDirectory(
    root: TPinnedWidgetCatalogRoot,
    args: Readonly<{ relativePath: string; maxEntries: number }>,
  ): Promise<TWidgetCatalogDirectoryObservation> {
    if (!Number.isSafeInteger(args.maxEntries) || args.maxEntries < 1) {
      throw new TypeError('Widget catalog directory limit must be a positive integer.');
    }
    const segments = safeRelativeSegments(args.relativePath);
    await this.assertRoot(root, {});
    await this.#assertDirectoryChain(root, segments);
    const path = segments.length === 0
      ? root.canonicalPath
      : join(root.canonicalPath, ...segments);
    const before = await lstat(path);
    const directory = await opendir(path);
    const names: string[] = [];
    try {
      while (true) {
        const entry = await directory.read();
        if (entry === null) break;
        names.push(entry.name);
        if (names.length > args.maxEntries) {
          throw errorWithCode(
            `Widget catalog directory '${args.relativePath || '.'}' exceeds its entry limit.`,
            'WIDGET_CATALOG_DIRECTORY_LIMIT',
          );
        }
      }
    } finally {
      try {
        await directory.close();
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ERR_DIR_CLOSED')) {
          throw error;
        }
      }
    }

    const entries: Array<TWidgetCatalogFilesystemEntry & { identity: string }> = [];
    for (const name of names.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
      const value = await lstat(join(path, name));
      const kind = entryKind(value);
      entries.push({
        name,
        kind,
        byteSize: kind === 'file' ? Number(value.size) : null,
        identity: statsIdentity(value),
      });
    }
    const after = await lstat(path);
    if (!sameIdentity(before, after)) {
      throw errorWithCode(
        `Widget catalog directory '${args.relativePath || '.'}' changed while reading.`,
        'WIDGET_CATALOG_DIRECTORY_CHANGED',
      );
    }
    await this.assertRoot(root, {});
    const token = JSON.stringify({
      directory: statsIdentity(after),
      entries: entries.map(({ name, kind, byteSize, identity }) => ({
        name,
        kind,
        byteSize,
        identity,
      })),
    });
    return Object.freeze({
      relativePath: args.relativePath,
      token,
      entries: Object.freeze(entries.map(({ name, kind, byteSize }) => Object.freeze({
        name,
        kind,
        byteSize,
      }))),
    });
  }

  async #assertDirectoryChain(
    root: TPinnedWidgetCatalogRoot,
    segments: readonly string[],
  ): Promise<void> {
    let current = root.canonicalPath;
    for (const segment of segments) {
      current = join(current, segment);
      const value = await lstat(current);
      if (value.isSymbolicLink() || !value.isDirectory()) {
        throw errorWithCode(
          `Widget catalog path '${current}' crosses a non-directory or symlink.`,
          'WIDGET_CATALOG_DIRECTORY_INVALID',
        );
      }
    }
  }

  async #openedCanonicalPath(fileDescriptor: number): Promise<string> {
    for (const descriptorPath of [
      `/dev/fd/${fileDescriptor}`,
      `/proc/self/fd/${fileDescriptor}`,
    ]) {
      const path = await realpath(descriptorPath).catch(() => null);
      if (path !== null) return path;
    }
    throw errorWithCode(
      'The host cannot verify the canonical path of an opened widget file.',
      'WIDGET_CATALOG_FILE_IDENTITY_UNAVAILABLE',
    );
  }
}

export class NodeWidgetCatalogHash implements TWidgetCatalogHashPortal {
  digestSha256(args: Readonly<{ value: string | Uint8Array }>): string {
    return createHash('sha256').update(args.value).digest('hex');
  }
}
