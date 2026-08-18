import { constants } from 'node:fs';
import {
  lstat,
  link,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import {
  isAbsolute,
  basename,
  dirname,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import type {
  TNodeWidgetPublicationFilesystemHooks,
  TNodeWidgetPublicationFilesystemInput,
  TPublicationCompareRemoveResult,
  TPublicationDirectoryEntry,
  TPublicationFileStat,
  TPublicationEffects,
  TPublicationTransitionEvent,
} from './typed';

type TRootIdentity = Readonly<{
  device: number;
  inode: number;
}>;

const CONTROL_FILE_MAX_BYTES = 1_048_576;
const DIRECTORY_ENTRY_MAX = 10_000;

function isMissing(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isAlreadyPresent(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

async function assertSafeLexicalRoot(requested: string): Promise<void> {
  const root = parse(requested).root;
  const segments = relative(root, requested).split(sep).filter(Boolean);
  let current = root;
  const paths = [root];
  for (const segment of segments) {
    current = join(current, segment);
    paths.push(current);
  }
  for (const path of paths) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const rootOwnedSystemAlias = path !== requested
        && dirname(path) === root
        && Number(stat.uid) === 0;
      if (!rootOwnedSystemAlias) {
        throw new Error(`Widget publication root has a symlinked lexical ancestor '${path}'.`);
      }
      continue;
    }
    if (!stat.isDirectory()) {
      throw new Error(`Widget publication root ancestor '${path}' is not a directory.`);
    }
  }
}

function isSameIdentity(
  stat: Awaited<ReturnType<typeof lstat>>,
  identity: TRootIdentity,
): boolean {
  return stat.isDirectory()
    && !stat.isSymbolicLink()
    && Number(stat.dev) === identity.device
    && Number(stat.ino) === identity.inode;
}

/**
 * Production no-follow, root-confined Node filesystem primitives for the
 * publication tx/fx lane. Product-specific digest and signature validation is
 * supplied through constructor hooks; this adapter never builds or signs.
 */
export class NodeWidgetPublicationFilesystem implements TPublicationEffects {
  readonly rootPath: string;
  readonly #identity: TRootIdentity;
  readonly #hooks: TNodeWidgetPublicationFilesystemHooks;

  private constructor(
    rootPath: string,
    identity: TRootIdentity,
    hooks: TNodeWidgetPublicationFilesystemHooks,
  ) {
    this.rootPath = rootPath;
    this.#identity = identity;
    this.#hooks = hooks;
  }

  static async create(
    args: TNodeWidgetPublicationFilesystemInput,
  ): Promise<NodeWidgetPublicationFilesystem> {
    const requested = resolve(args.widgetRoot);
    await assertSafeLexicalRoot(requested);
    const rootPath = await realpath(requested);
    const stat = await lstat(rootPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Widget publication root '${rootPath}' must be a direct directory.`);
    }
    return new NodeWidgetPublicationFilesystem(
      rootPath,
      Object.freeze({ device: Number(stat.dev), inode: Number(stat.ino) }),
      args.hooks,
    );
  }

  join(...parts: string[]): string {
    const path = resolve(...parts);
    this.#assertConfined(path);
    return path;
  }

  async lstat(path: string): Promise<TPublicationFileStat> {
    const confined = await this.#prepare(path, false);
    const stat = await lstat(confined);
    return Object.freeze({
      dev: stat.dev,
      size: stat.size,
      isDirectory: () => stat.isDirectory(),
      isFile: () => stat.isFile(),
      isSymbolicLink: () => stat.isSymbolicLink(),
    });
  }

  async readdir(
    path: string,
    options: Readonly<{ withFileTypes: true }>,
  ): Promise<readonly TPublicationDirectoryEntry[]> {
    const confined = await this.#prepare(path, true);
    void options;
    const directory = await opendir(confined);
    const entries: TPublicationDirectoryEntry[] = [];
    try {
      while (true) {
        const entry = await directory.read();
        if (entry === null) break;
        if (entries.length >= DIRECTORY_ENTRY_MAX) {
          throw new Error(`Publication directory '${confined}' exceeds ${DIRECTORY_ENTRY_MAX} entries.`);
        }
        entries.push(entry);
      }
    } finally {
      await directory.close();
    }
    return Object.freeze(entries);
  }

  async readFile(path: string, encoding: 'utf8'): Promise<string> {
    const confined = await this.#prepare(path, true);
    const handle = await open(confined, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`Publication read path '${confined}' is not a file.`);
      await this.#assertOpenedPathIdentity(confined, stat);
      if (Number(stat.size) > CONTROL_FILE_MAX_BYTES) {
        throw new Error(`Publication control file '${confined}' exceeds ${CONTROL_FILE_MAX_BYTES} bytes.`);
      }
      const buffer = Buffer.alloc(CONTROL_FILE_MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.byteLength) {
        const result = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      if (offset > CONTROL_FILE_MAX_BYTES) {
        throw new Error(`Publication control file '${confined}' exceeds ${CONTROL_FILE_MAX_BYTES} bytes.`);
      }
      return buffer.subarray(0, offset).toString(encoding);
    } finally {
      await handle.close();
    }
  }

  async mkdir(
    path: string,
    options: Readonly<{ recursive: false; mode: number }>,
  ): Promise<void> {
    const confined = await this.#prepare(path, false);
    const parent = resolve(confined, '..');
    await this.#assertDirectPath(parent);
    await mkdir(confined, options);
    await this.#assertDirectPath(confined);
  }

  async writeFile(
    path: string,
    bytes: Uint8Array | string,
    options: Readonly<{ flag: 'wx'; mode: number }>,
  ): Promise<void> {
    const confined = await this.#prepare(path, false);
    await this.#assertDirectPath(resolve(confined, '..'));
    const handle = await open(
      confined,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      options.mode,
    );
    try {
      await this.#assertOpenedPathIdentity(confined, await handle.stat());
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const confinedFrom = await this.#prepare(from, false);
    const confinedTo = await this.#prepare(to, false);
    await this.#assertDirectPath(resolve(confinedFrom, '..'));
    await this.#assertDirectPath(resolve(confinedTo, '..'));
    await rename(confinedFrom, confinedTo);
  }

  async removeFileIfContentsMatch(
    path: string,
    expected: string,
    claimToken: string,
  ): Promise<TPublicationCompareRemoveResult> {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(claimToken)) {
      throw new Error('Publication compare-remove claim token is invalid.');
    }
    const confined = resolve(path);
    this.#assertConfined(confined);
    await this.#assertRootIdentity();
    const parent = resolve(confined, '..');
    await this.#assertDirectPath(parent);
    const claimDirectory = resolve(
      parent,
      `.${basename(confined)}.remove-${claimToken}.claim`,
    );
    this.#assertConfined(claimDirectory);
    await mkdir(claimDirectory, { recursive: false, mode: 0o700 });
    const claimPath = resolve(claimDirectory, 'value');
    try {
      await rename(confined, claimPath);
    } catch (error) {
      await rmdir(claimDirectory).catch(() => undefined);
      if (isMissing(error)) return 'missing';
      throw error;
    }
    await this.#hooks.onCompareRemoveClaimed?.({ path: confined, claimPath });

    let handle;
    try {
      handle = await open(claimPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      throw new Error(`Claimed publication file is retained at '${claimPath}'.`, { cause: error });
    }
    let matches = false;
    try {
      const openedStat = await handle.stat();
      if (openedStat.isFile() && Number(openedStat.size) <= CONTROL_FILE_MAX_BYTES) {
        await this.#assertOpenedPathIdentity(claimPath, openedStat);
        matches = await handle.readFile({ encoding: 'utf8' }) === expected;
      }
    } finally {
      await handle.close();
    }
    if (matches) {
      await unlink(claimPath);
      await rmdir(claimDirectory);
      return 'removed';
    }
    try {
      await link(claimPath, confined);
      await unlink(claimPath);
      await rmdir(claimDirectory);
    } catch (error) {
      if (!isAlreadyPresent(error)) {
        throw new Error(`Mismatched publication file is retained at '${claimPath}'.`, { cause: error });
      }
    }
    return 'mismatch';
  }

  async syncFile(path: string): Promise<void> {
    const confined = await this.#prepare(path, true);
    const handle = await open(confined, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`Publication sync path '${confined}' is not a file.`);
      await this.#assertOpenedPathIdentity(confined, stat);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async syncDirectory(path: string): Promise<void> {
    const confined = await this.#prepare(path, true);
    const handle = await open(confined, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory()) throw new Error(`Publication sync path '${confined}' is not a directory.`);
      await this.#assertOpenedPathIdentity(confined, stat);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  observeFence(args: Parameters<TPublicationEffects['observeFence']>[0]) {
    return this.#hooks.observeFence(args);
  }

  async validateReopenedPublication(args: Readonly<{ slug: string; path: string }>) {
    await this.#prepare(args.path, true);
    return this.#hooks.validateReopenedPublication(args);
  }

  async validateMetadataCandidate(args: Readonly<{
    slug: string;
    currentPath: string;
    manifestJson: string;
    expectedExecutableManifestDigestSha256: string;
  }>) {
    await this.#prepare(args.currentPath, true);
    return this.#hooks.validateMetadataCandidate(args);
  }

  async onTransition(event: TPublicationTransitionEvent): Promise<void> {
    await this.#hooks.onTransition?.(event);
  }

  async #prepare(path: string, requireTarget: boolean): Promise<string> {
    const confined = resolve(path);
    this.#assertConfined(confined);
    await this.#assertRootIdentity();
    await this.#assertAncestors(confined, requireTarget);
    return confined;
  }

  #assertConfined(path: string): void {
    const suffix = relative(this.rootPath, resolve(path));
    if (suffix === '') return;
    if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
      throw new Error(`Publication path '${path}' escapes '${this.rootPath}'.`);
    }
  }

  async #assertRootIdentity(): Promise<void> {
    const stat = await lstat(this.rootPath);
    if (!isSameIdentity(stat, this.#identity)) {
      throw new Error('Widget publication root identity changed.');
    }
  }

  async #assertOpenedPathIdentity(
    path: string,
    openedStat: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>,
  ): Promise<void> {
    const canonical = await realpath(path);
    this.#assertConfined(canonical);
    const namedStat = await lstat(path);
    if (
      namedStat.isSymbolicLink()
      || Number(namedStat.dev) !== Number(openedStat.dev)
      || Number(namedStat.ino) !== Number(openedStat.ino)
    ) throw new Error(`Publication path '${path}' changed while it was open.`);
  }

  async #assertAncestors(path: string, requireTarget: boolean): Promise<void> {
    const suffix = relative(this.rootPath, path);
    if (suffix === '') return;
    const segments = suffix.split(sep).filter(Boolean);
    const count = requireTarget ? segments.length : Math.max(0, segments.length - 1);
    let current = this.rootPath;
    for (let index = 0; index < count; index += 1) {
      current = resolve(current, segments[index]!);
      let stat;
      try {
        stat = await lstat(current);
      } catch (error) {
        if (!requireTarget && isMissing(error)) return;
        throw error;
      }
      if (index < count - 1 || requireTarget) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          if (index === count - 1 && requireTarget && stat.isFile() && !stat.isSymbolicLink()) return;
          throw new Error(`Publication path ancestor '${current}' is not a direct directory.`);
        }
      }
    }
  }

  async #assertDirectPath(path: string): Promise<void> {
    const confined = await this.#prepare(path, true);
    const stat = await lstat(confined);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Publication path '${confined}' is not a direct directory.`);
    }
  }
}
