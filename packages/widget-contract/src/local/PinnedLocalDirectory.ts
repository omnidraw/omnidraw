import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';

type TDirectoryIdentity = Readonly<{
  path: string;
  device: number;
  inode: number;
}>;

export type TPinnedLocalDirectory = Readonly<{
  path: string;
  rootPath: string;
  identities: readonly TDirectoryIdentity[];
}>;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyPresent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function identity(path: string, value: Awaited<ReturnType<typeof lstat>>): TDirectoryIdentity {
  if (!value.isDirectory() || value.isSymbolicLink()) {
    throw new Error(`Pinned local path '${path}' must be a real directory.`);
  }
  return Object.freeze({
    path,
    device: Number(value.dev),
    inode: Number(value.ino),
  });
}

function identityMatches(
  expected: TDirectoryIdentity,
  value: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return value.isDirectory()
    && !value.isSymbolicLink()
    && Number(value.dev) === expected.device
    && Number(value.ino) === expected.inode;
}

function canonicalAncestorPaths(path: string): readonly string[] {
  const root = parse(path).root;
  const suffix = path.slice(root.length).split('/').filter((segment) => segment.length > 0);
  const paths = [root];
  let current = root;
  for (const segment of suffix) {
    current = join(current, segment);
    paths.push(current);
  }
  return paths;
}

async function assertLexicalAncestors(path: string): Promise<void> {
  for (const ancestor of canonicalAncestorPaths(path)) {
    let value;
    try {
      value = await lstat(ancestor);
    } catch (error) {
      if (isMissing(error)) break;
      throw error;
    }
    if (value.isSymbolicLink()) {
      const rootOwnedFilesystemAlias = dirname(ancestor) === parse(ancestor).root
        && Number(value.uid) === 0;
      if (!rootOwnedFilesystemAlias) {
        throw new Error(`Pinned local path has a symlinked ancestor '${ancestor}'.`);
      }
      continue;
    }
    if (!value.isDirectory()) {
      throw new Error(`Pinned local path ancestor '${ancestor}' is not a directory.`);
    }
  }
}

function assertSafeSegments(segments: readonly string[]): void {
  if (segments.some((segment) => (
    segment.length === 0
    || segment === '.'
    || segment === '..'
    || segment.includes('/')
    || segment.includes('\\')
    || segment.includes('\0')
  ))) {
    throw new Error('Pinned local directory contains an unsafe path segment.');
  }
}

/** Lazily creates, canonicalizes, and pins one local directory hierarchy. */
export class PinnedLocalDirectory {
  readonly #requestedPath: string;
  readonly #knownIdentities = new Map<string, TDirectoryIdentity>();
  #rootPromise: Promise<TPinnedLocalDirectory> | null = null;

  constructor(requestedPath: string) {
    this.#requestedPath = resolve(requestedPath);
  }

  async ensureRoot(): Promise<TPinnedLocalDirectory> {
    this.#rootPromise ??= this.#initializeRoot();
    const root = await this.#rootPromise;
    await this.assertDirectory(root);
    return root;
  }

  async ensureDirectory(segments: readonly string[]): Promise<TPinnedLocalDirectory> {
    assertSafeSegments(segments);
    const root = await this.ensureRoot();
    const identities = [...root.identities];
    let current = root.path;
    for (const segment of segments) {
      current = join(current, segment);
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (!isAlreadyPresent(error)) throw error;
      }
      identities.push(this.#pinIdentity(identity(current, await lstat(current))));
    }
    const pinned = Object.freeze({
      path: current,
      rootPath: root.rootPath,
      identities: Object.freeze(identities),
    });
    await this.assertDirectory(pinned);
    return pinned;
  }

  async resolveDirectory(segments: readonly string[]): Promise<TPinnedLocalDirectory | null> {
    assertSafeSegments(segments);
    const root = await this.ensureRoot();
    const identities = [...root.identities];
    let current = root.path;
    for (const segment of segments) {
      current = join(current, segment);
      let value;
      try {
        value = await lstat(current);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      identities.push(this.#pinIdentity(identity(current, value)));
    }
    const pinned = Object.freeze({
      path: current,
      rootPath: root.rootPath,
      identities: Object.freeze(identities),
    });
    await this.assertDirectory(pinned);
    return pinned;
  }

  async assertDirectory(directory: TPinnedLocalDirectory): Promise<void> {
    for (const expected of directory.identities) {
      let value;
      try {
        value = await lstat(expected.path);
      } catch {
        throw new Error('Pinned local directory identity changed.');
      }
      if (!identityMatches(expected, value)) {
        throw new Error('Pinned local directory identity changed.');
      }
    }
    let requestedRealPath;
    try {
      requestedRealPath = await realpath(this.#requestedPath);
    } catch {
      throw new Error('Pinned local directory identity changed.');
    }
    const pinnedRootPath = (await this.#rootPromise)?.path;
    if (pinnedRootPath !== undefined && requestedRealPath !== pinnedRootPath) {
      throw new Error('Pinned local directory identity changed.');
    }
  }

  async sync(directory: TPinnedLocalDirectory): Promise<void> {
    await this.assertDirectory(directory);
    await this.#syncIdentity(directory.identities.at(-1)!);
    await this.assertDirectory(directory);
  }

  async syncHierarchy(
    directory: TPinnedLocalDirectory,
    syncOverride?: (path: string) => Promise<void>,
  ): Promise<void> {
    await this.assertDirectory(directory);
    const rootIndex = directory.identities.findIndex(({ path }) => path === directory.rootPath);
    if (rootIndex === -1) throw new Error('Pinned local directory is outside its root.');
    const hierarchyBoundary = Math.max(0, rootIndex - 1);
    for (let index = directory.identities.length - 1; index >= hierarchyBoundary; index -= 1) {
      const expected = directory.identities[index]!;
      if (syncOverride === undefined) await this.#syncIdentity(expected);
      else await syncOverride(expected.path);
      await this.assertDirectory(directory);
    }
  }

  async #initializeRoot(): Promise<TPinnedLocalDirectory> {
    await assertLexicalAncestors(this.#requestedPath);
    const missingSegments: string[] = [];
    let existingPath = this.#requestedPath;
    let existingValue;
    while (true) {
      try {
        existingValue = await lstat(existingPath);
        break;
      } catch (error) {
        if (!isMissing(error)) throw error;
        const parent = dirname(existingPath);
        if (parent === existingPath) throw error;
        missingSegments.unshift(basename(existingPath));
        existingPath = parent;
      }
    }
    if (!existingValue.isDirectory() || existingValue.isSymbolicLink()) {
      throw new Error('Pinned local root or its nearest existing ancestor is not a real directory.');
    }

    let canonicalPath = await realpath(existingPath);
    for (const segment of missingSegments) {
      canonicalPath = join(canonicalPath, segment);
      try {
        await mkdir(canonicalPath, { mode: 0o700 });
      } catch (error) {
        if (!isAlreadyPresent(error)) throw error;
      }
      identity(canonicalPath, await lstat(canonicalPath));
    }
    if (await realpath(this.#requestedPath) !== canonicalPath) {
      throw new Error('Pinned local root resolved outside its canonical directory.');
    }
    await assertLexicalAncestors(this.#requestedPath);

    const identities: TDirectoryIdentity[] = [];
    for (const ancestor of canonicalAncestorPaths(canonicalPath)) {
      identities.push(this.#pinIdentity(identity(ancestor, await lstat(ancestor))));
    }
    return Object.freeze({
      path: canonicalPath,
      rootPath: canonicalPath,
      identities: Object.freeze(identities),
    });
  }

  async #syncIdentity(expected: TDirectoryIdentity): Promise<void> {
    const handle = await open(
      expected.path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const value = await handle.stat();
      if (
        !value.isDirectory()
        || Number(value.dev) !== expected.device
        || Number(value.ino) !== expected.inode
      ) {
        throw new Error('Pinned local directory identity changed.');
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  #pinIdentity(value: TDirectoryIdentity): TDirectoryIdentity {
    const known = this.#knownIdentities.get(value.path);
    if (
      known !== undefined
      && (known.device !== value.device || known.inode !== value.inode)
    ) {
      throw new Error('Pinned local directory identity changed.');
    }
    if (known === undefined) this.#knownIdentities.set(value.path, value);
    return known ?? value;
  }
}
