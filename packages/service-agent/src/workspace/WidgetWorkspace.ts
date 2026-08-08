import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  ZWidgetManifestV1,
} from '@omnidraw/widget-contract';
import { fnChatStorageSegments } from '@omnidraw/shared-functions/chat/fn.chat-id';
import { fnMatchesGlob } from './fn.glob';
import { fnAssertSafeSearchPattern } from './fn.safe-search-pattern';
import { fnIsWidgetDraftSlug, fnNormalizeWidgetName } from './fn.names';
import { fxReadWidgetManifestRecord } from './fx.draft-manifest';
import { fxWidgetCatalog } from './fx.widget-catalog';
import { txEnsureChatStorage } from './tx.chat-storage';
import type {
  TResolvedMountedPath,
  TAvailableWidget,
  TWidgetCreateInput,
  TWidgetDraftWorkspaceEntry,
  TWidgetMount,
  TWorkspaceGrepResult,
} from './types';

type TWidgetWorkspaceConfig = {
  dataPath: string;
  draftRoot: string;
  platform?: NodeJS.Platform;
  createId?: () => string;
  npmUserConfigPath?: string;
  prepareNpmDependencies?: () => Promise<void>;
};

type TScaffold = (args: TWidgetCreateInput & { cwd: string; name: string }) => Promise<string[]>;

const GREP_FILE_LIMIT = 500;
const GREP_BYTE_LIMIT = 2_000_000;
const GREP_MATCH_LIMIT = 500;
const MUTATION_FILE_BYTE_LIMIT = 5_000_000;

/**
 * Chat-facing workspace over the one app-owned widget draft root. Drafts are
 * stored as `<draftRoot>/<slug>/` next to the catalog, Preview, and Publish
 * authorities; every chat mounts them by display name through symlinks under
 * `workspace/widgets/<name>`.
 */
export class WidgetWorkspace {
  readonly agentRoot: string;
  readonly chatRoot: string;
  readonly draftRoot: string;
  readonly transientRoot: string;
  readonly npmUserConfigPath?: string;
  readonly #platform: NodeJS.Platform;
  readonly #createId: () => string;
  readonly #prepareNpmDependencies?: () => Promise<void>;
  readonly #writeQueues = new Map<string, Promise<unknown>>();
  readonly #authoringQueues = new Map<string, Promise<unknown>>();

  constructor(config: TWidgetWorkspaceConfig) {
    this.agentRoot = join(config.dataPath, 'pi', 'agent');
    this.chatRoot = join(this.agentRoot, 'chats');
    this.draftRoot = config.draftRoot;
    this.transientRoot = join(this.agentRoot, 'widgets', 'tmp');
    this.npmUserConfigPath = config.npmUserConfigPath;
    this.#platform = config.platform ?? process.platform;
    this.#createId = config.createId ?? randomUUID;
    this.#prepareNpmDependencies = config.prepareNpmDependencies;
  }

  prepareNpmDependencies(): Promise<void> {
    return this.#prepareNpmDependencies?.() ?? Promise.resolve();
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.chatRoot, { recursive: true }),
      mkdir(this.draftRoot, { recursive: true }),
      mkdir(this.transientRoot, { recursive: true }),
    ]);
  }

  getChatRoot(chatId: string): string {
    const segments = fnChatStorageSegments(chatId);
    return join(this.agentRoot, ...segments.workspace);
  }

  getChatHistoryRoot(chatId: string): string {
    const segments = fnChatStorageSegments(chatId);
    return join(this.agentRoot, ...segments.history);
  }

  async ensureChat(chatId: string): Promise<string> {
    const storage = await txEnsureChatStorage({ join, mkdir, readFile, writeFile }, {
      agentRoot: this.agentRoot,
      sessionId: chatId,
    });
    const root = storage.workspace;
    await this.#withWidgetWrite(root, async () => {
      await mkdir(join(root, 'widgets'), { recursive: true });
      await this.#reconcileSharedMounts(root);
    });
    return root;
  }

  async createDraft(chatId: string, input: TWidgetCreateInput, scaffold: TScaffold): Promise<{ mount: TWidgetMount; files: string[] }> {
    const normalized = this.#normalizeName(input.name);
    await this.ensureChat(chatId);
    await this.#assertNameAvailable(chatId, normalized);

    const temporary = join(this.transientRoot, `create-${this.#safeId()}`);
    let promoted = false;
    try {
      await mkdir(temporary, { recursive: false });
      const files = await scaffold({ ...input, name: normalized, cwd: temporary });
      const identity = await this.#readDraftIdentity(temporary);
      if (identity === null) {
        throw new Error('Generated widget draft is missing a valid omnidraw.json name and slug.');
      }
      if (identity.name !== normalized) {
        throw new Error(`Generated widget manifest name '${identity.name}' does not match the requested name '${normalized}'.`);
      }
      await this.#assertSlugAvailable(identity.slug);
      const target = join(this.draftRoot, identity.slug);
      await rename(temporary, target);
      promoted = true;
      try {
        const mount = await this.loadWidget(chatId, normalized);
        return { mount, files };
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        throw error;
      }
    } finally {
      if (!promoted) await rm(temporary, { recursive: true, force: true });
    }
  }

  async loadWidget(chatId: string, requestedName: string): Promise<TWidgetMount> {
    const name = this.#normalizeName(requestedName);
    const chatRoot = await this.ensureChat(chatId);
    const targetPath = await this.#resolveDraftTarget(name);
    const mountPath = join(chatRoot, 'widgets', name);
    await this.#assertNoCaseCollision(join(chatRoot, 'widgets'), name);

    const existing = await lstat(mountPath).catch(() => null);
    if (existing) {
      if (!existing.isSymbolicLink()) throw new Error(`Widget mount '${name}' conflicts with an existing filesystem entry.`);
      const existingTarget = await realpath(mountPath).catch(() => null);
      if (existingTarget === targetPath) {
        return { name, source: 'draft', chatRoot, mountPath, targetPath };
      }
      throw new Error(`Widget mount '${name}' already points to a different target.`);
    }

    const linkTarget = await this.#mountLinkTarget(mountPath, targetPath);
    await symlink(linkTarget, mountPath, this.#platform === 'win32' ? 'junction' : 'dir');
    return { name, source: 'draft', chatRoot, mountPath, targetPath };
  }

  async listMounts(chatId: string): Promise<TWidgetMount[]> {
    await this.ensureChat(chatId);
    return this.inspectMounts(chatId);
  }

  /** Reads the current mount set without reconciling missing shared mounts. */
  async inspectMounts(chatId: string): Promise<TWidgetMount[]> {
    const chatRoot = this.getChatRoot(chatId);
    const widgetsRoot = join(chatRoot, 'widgets');
    const entries = await readdir(widgetsRoot, { withFileTypes: true }).catch(() => []);
    const mounts: TWidgetMount[] = [];
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const mount = await this.#inspectMount(chatRoot, entry.name).catch(() => null);
      if (mount) mounts.push(mount);
    }
    return mounts.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getDraft(requestedName: string): Promise<TWidgetDraftWorkspaceEntry | null> {
    const name = this.#normalizeName(requestedName);
    const slug = await this.#draftSlugForName(name);
    if (slug === null) return null;
    const draftPath = join(this.draftRoot, slug);
    if (!await this.#isDirectDirectory(this.draftRoot, draftPath)) return null;
    const revision = await this.#readDraftRevision(draftPath);
    return {
      name,
      draftPath,
      published: false,
      revision: revision.value,
      updatedAt: new Date(revision.updatedAtMs).toISOString(),
    };
  }

  async listAvailableWidgets(chatId: string): Promise<TAvailableWidget[]> {
    const mounts = await this.listMounts(chatId);
    return fxWidgetCatalog({
      readdir,
      lstat,
      readFile,
      realpath,
      join,
      dirname,
      parseManifest: (value) => {
        const manifest = ZWidgetManifestV1.safeParse(value);
        if (manifest.success) {
          return {
            ok: true as const,
            name: manifest.data.name,
            slug: manifest.data.slug,
            kind: 'widget' as const,
          };
        }
        return { ok: false as const };
      },
    }, {
      draftRoot: this.draftRoot,
      mountedNames: mounts.map((mount) => mount.name),
    });
  }

  async removeMount(chatId: string, requestedName: string): Promise<boolean> {
    const name = this.#normalizeName(requestedName);
    const chatRoot = await this.ensureChat(chatId);
    const mountPath = join(chatRoot, 'widgets', name);
    const entry = await lstat(mountPath).catch(() => null);
    if (!entry) return false;
    if (!entry.isSymbolicLink()) throw new Error(`Refusing to remove non-mount entry '${name}'.`);
    await this.#assertOwnedMountLink(mountPath, name);
    await rm(mountPath, { force: true });
    return true;
  }

  async resolveMountedPath(chatId: string, lexicalPath: string, options: { allowMissing?: boolean } = {}): Promise<TResolvedMountedPath> {
    if (isAbsolute(lexicalPath) || lexicalPath.includes('\\')) throw new Error('Widget file paths must be relative to the chat workspace.');
    const parts = lexicalPath.split('/');
    if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) throw new Error('Widget file path contains an unsafe segment.');
    if (parts[0] !== 'widgets' || parts.length < 3) {
      throw new Error("Widget files are accessible only through 'widgets/<mounted-name>/...'.");
    }

    const chatRoot = await this.ensureChat(chatId);
    const mount = await this.#inspectMount(chatRoot, parts[1]);
    const candidate = join(mount.targetPath, ...parts.slice(2));
    const existing = await lstat(candidate).catch(() => null);
    if (existing) {
      const resolved = await realpath(candidate);
      this.#assertInside(mount.targetPath, resolved);
      return { absolutePath: resolved, widgetRoot: mount.targetPath, mount };
    }
    if (!options.allowMissing) throw new Error(`Mounted widget path does not exist: ${lexicalPath}`);

    const resolvedParent = await realpath(dirname(candidate));
    this.#assertInside(mount.targetPath, resolvedParent);
    const parentStat = await stat(resolvedParent);
    if (!parentStat.isDirectory()) throw new Error('Widget file parent is not a directory.');
    return { absolutePath: join(resolvedParent, basename(candidate)), widgetRoot: mount.targetPath, mount };
  }

  async readMountedFile(chatId: string, lexicalPath: string): Promise<Buffer> {
    const resolved = await this.resolveMountedPath(chatId, lexicalPath);
    const fileStat = await stat(resolved.absolutePath);
    if (!fileStat.isFile()) throw new Error('Mounted widget path is not a file.');
    return readFile(resolved.absolutePath);
  }

  async assertMountedFileAccess(chatId: string, lexicalPath: string, mode: number): Promise<void> {
    const resolved = await this.resolveMountedPath(chatId, lexicalPath);
    await access(resolved.absolutePath, mode);
  }

  async writeMountedFileAtomic(chatId: string, lexicalPath: string, content: string): Promise<void> {
    await this.updateMountedFileAtomic(chatId, lexicalPath, () => ({ content, value: undefined }), { allowMissing: true });
  }

  /**
   * Serializes one complete source mutation and its durable authoring callback.
   * The separate lane allows the callback to take the lower-level file lock
   * while preventing another chat from changing the same draft in between.
   */
  async withDraftAuthoringOperation<T>(
    requestedName: string,
    operation: () => Promise<T>,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<T> {
    const name = this.#normalizeName(requestedName);
    const key = await this.#canonicalWriteLaneKey(join(this.draftRoot, name));
    return this.#withQueue(this.#authoringQueues, key, operation, options.signal);
  }

  async withDraftAuthoringOperations<T>(
    requestedNames: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    const names = [...new Set(requestedNames.map((name) => this.#normalizeName(name)))]
      .sort((left, right) => left.localeCompare(right, 'en-US'));
    const run = (index: number): Promise<T> => {
      const name = names[index];
      return name === undefined
        ? operation()
        : this.withDraftAuthoringOperation(name, () => run(index + 1));
    };
    return run(0);
  }

  async updateMountedFileAtomic<T>(
    chatId: string,
    lexicalPath: string,
    update: (content: string) => { content: string; value: T },
    options: { allowMissing?: boolean } = {},
  ): Promise<T> {
    const resolved = await this.resolveMountedPath(chatId, lexicalPath, { allowMissing: options.allowMissing });
    return this.#withWidgetWrite(resolved.widgetRoot, async () => {
      const entry = await lstat(resolved.absolutePath).catch(() => null);
      if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw new Error('Mounted widget path is not a regular file.');
      if (!entry && !options.allowMissing) throw new Error(`Mounted widget path does not exist: ${lexicalPath}`);
      const sourceBuffer = entry ? await readFile(resolved.absolutePath) : Buffer.alloc(0);
      if (sourceBuffer.byteLength > MUTATION_FILE_BYTE_LIMIT) throw new Error('Mounted widget file exceeds the mutation-size limit.');
      const source = sourceBuffer.toString('utf8');
      const next = update(source);
      if (Buffer.byteLength(next.content, 'utf8') > MUTATION_FILE_BYTE_LIMIT) throw new Error('Edited widget file exceeds the mutation-size limit.');
      const temporary = join(dirname(resolved.absolutePath), `.${basename(resolved.absolutePath)}.edit-${this.#safeId()}.tmp`);
      try {
        await writeFile(temporary, next.content, 'utf8');
        await rename(temporary, resolved.absolutePath);
        return next.value;
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    });
  }

  async grepMountedFiles(chatId: string, args: {
    pattern: string;
    path?: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    limit?: number;
  }): Promise<TWorkspaceGrepResult> {
    const limit = Math.max(1, Math.min(GREP_MATCH_LIMIT, Math.floor(args.limit ?? 100)));
    if (!args.literal) fnAssertSafeSearchPattern(args.pattern);
    const matcher = args.literal
      ? null
      : new RegExp(args.pattern, args.ignoreCase ? 'i' : undefined);
    const literal = args.ignoreCase ? args.pattern.toLocaleLowerCase('en-US') : args.pattern;
    const roots = await this.#grepRoots(chatId, args.path);
    const matches: TWorkspaceGrepResult['matches'] = [];
    let filesSearched = 0;
    let bytesRead = 0;
    let truncated = false;

    const walk = async (absoluteDir: string, displayDir: string, widgetRoot: string): Promise<void> => {
      if (truncated) return;
      const entries = await readdir(absoluteDir, { withFileTypes: true });
      for (const entry of entries) {
        if (truncated) return;
        const absolutePath = join(absoluteDir, entry.name);
        const displayPath = `${displayDir}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await walk(absolutePath, displayPath, widgetRoot);
          continue;
        }
        if (!entry.isFile() || !this.#matchesGlob(displayPath, args.glob)) continue;
        if (filesSearched >= GREP_FILE_LIMIT || bytesRead >= GREP_BYTE_LIMIT) {
          truncated = true;
          return;
        }
        const resolved = await realpath(absolutePath);
        this.#assertInside(widgetRoot, resolved);
        const buffer = await readFile(resolved);
        filesSearched += 1;
        bytesRead += buffer.byteLength;
        if (bytesRead > GREP_BYTE_LIMIT || buffer.includes(0)) {
          if (bytesRead > GREP_BYTE_LIMIT) truncated = true;
          continue;
        }
        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? '';
          const haystack = args.ignoreCase ? line.toLocaleLowerCase('en-US') : line;
          if (matcher ? matcher.test(line) : haystack.includes(literal)) {
            matches.push({ path: displayPath, line: index + 1, text: line.slice(0, 2_000) });
            if (matches.length >= limit) {
              truncated = true;
              return;
            }
          }
        }
      }
    };

    for (const root of roots) {
      const rootStat = await stat(root.absolutePath);
      if (rootStat.isFile()) {
        const buffer = await readFile(root.absolutePath);
        filesSearched += 1;
        bytesRead += buffer.byteLength;
        if (bytesRead > GREP_BYTE_LIMIT || buffer.includes(0)) {
          if (bytesRead > GREP_BYTE_LIMIT) truncated = true;
          continue;
        }
        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
          const line = lines[index] ?? '';
          const haystack = args.ignoreCase ? line.toLocaleLowerCase('en-US') : line;
          if (matcher ? matcher.test(line) : haystack.includes(literal)) matches.push({ path: root.displayPath, line: index + 1, text: line.slice(0, 2_000) });
        }
        if (matches.length >= limit) truncated = true;
      } else if (rootStat.isDirectory()) {
        await walk(root.absolutePath, root.displayPath, root.widgetRoot);
      }
      if (truncated) break;
    }

    return { matches, truncated, filesSearched };
  }

  async findMountedWidget(chatId: string, requestedName?: string): Promise<TWidgetMount> {
    const mounts = await this.listMounts(chatId);
    if (requestedName) {
      const name = this.#normalizeName(requestedName);
      const match = mounts.find((mount) => mount.name === name);
      if (!match) throw new Error(`Widget '${name}' is not mounted in this chat.`);
      return match;
    }
    if (mounts.length === 1) return mounts[0];
    if (mounts.length === 0) throw new Error('No widget is mounted in this chat.');
    throw new Error('More than one widget is mounted. Select a widget explicitly.');
  }

  /**
   * Resolves a display name to its shared draft slug by reading each draft's
   * manifest. Display names are mount identities; folder names stay slugs.
   */
  async #draftSlugForName(name: string): Promise<string | null> {
    const entries = await readdir(this.draftRoot, { withFileTypes: true }).catch(() => []);
    let match: string | null = null;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !fnIsWidgetDraftSlug(entry.name)) continue;
      const identity = await this.#readDraftIdentity(join(this.draftRoot, entry.name));
      if (identity?.name !== name) continue;
      if (match !== null) throw new Error(`Widget name '${name}' is ambiguous across shared drafts.`);
      match = entry.name;
    }
    return match;
  }

  async #readDraftIdentity(
    draftPath: string,
  ): Promise<Readonly<{ name: string; slug: string }> | null> {
    const manifest = await fxReadWidgetManifestRecord({ lstat, readFile, join }, { draftPath });
    if (manifest === null) return null;
    const { name, slug } = manifest;
    if (typeof name !== 'string' || typeof slug !== 'string' || !fnIsWidgetDraftSlug(slug)) return null;
    const normalized = fnNormalizeWidgetName(name);
    if (!normalized.ok || normalized.value !== name) return null;
    return { name, slug };
  }

  async #resolveDraftTarget(name: string): Promise<string> {
    const slug = await this.#draftSlugForName(name);
    if (slug === null) throw new Error(`Widget draft '${name}' does not exist.`);
    const draft = join(this.draftRoot, slug);
    if (!await this.#isDirectDirectory(this.draftRoot, draft)) {
      throw new Error(`Widget draft '${name}' does not exist.`);
    }
    return realpath(draft);
  }

  async #reconcileSharedMounts(root: string): Promise<void> {
    const widgetsRoot = join(root, 'widgets');
    const mounts = await readdir(widgetsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of mounts) {
      if (!entry.isSymbolicLink()) continue;
      const normalized = fnNormalizeWidgetName(entry.name);
      if (!normalized.ok || normalized.value !== entry.name) continue;
      const mountPath = join(widgetsRoot, entry.name);
      const ownedKind = await this.#ownedMountKind(mountPath, entry.name).catch(() => null);
      if (ownedKind === 'draft') continue;
      if (ownedKind === 'stale') await rm(mountPath, { force: true });
    }

    const drafts = await readdir(this.draftRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of drafts) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !fnIsWidgetDraftSlug(entry.name)) continue;
      const identity = await this.#readDraftIdentity(join(this.draftRoot, entry.name));
      if (identity === null || identity.slug !== entry.name) continue;
      const targetPath = await realpath(join(this.draftRoot, entry.name));
      const mountPath = join(widgetsRoot, identity.name);
      const existing = await lstat(mountPath).catch(() => null);
      if (existing) {
        continue;
      }
      const linkTarget = await this.#mountLinkTarget(mountPath, targetPath);
      await symlink(linkTarget, mountPath, this.#platform === 'win32' ? 'junction' : 'dir');
    }
  }

  async #inspectMount(chatRoot: string, requestedName: string): Promise<TWidgetMount> {
    const name = this.#normalizeName(requestedName);
    const mountPath = join(chatRoot, 'widgets', name);
    const mountStat = await lstat(mountPath).catch(() => null);
    if (!mountStat?.isSymbolicLink()) throw new Error(`Widget '${name}' is not a backend mount.`);
    const targetPath = await realpath(mountPath);
    const draftRoot = await realpath(this.draftRoot);
    if (dirname(targetPath) !== draftRoot || !fnIsWidgetDraftSlug(basename(targetPath))) {
      throw new Error(`Widget mount '${name}' does not point to a shared draft.`);
    }
    const targetStat = await lstat(targetPath);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error(`Widget mount '${name}' has an invalid target.`);
    const identity = await this.#readDraftIdentity(targetPath);
    if (identity?.name !== name) {
      throw new Error(`Widget mount '${name}' does not match the draft identity in its manifest.`);
    }
    return { name, source: 'draft', chatRoot, mountPath, targetPath };
  }

  async #assertOwnedMountLink(mountPath: string, name: string): Promise<void> {
    if (await this.#ownedMountKind(mountPath, name) !== 'draft') throw new Error(`Widget mount '${name}' is not owned by the backend.`);
  }

  /**
   * Classifies a mount link: 'draft' is live, 'stale' still points at a shared
   * draft folder but no longer matches its manifest identity, and null is a
   * foreign link the backend must not touch.
   */
  async #ownedMountKind(mountPath: string, name: string): Promise<'draft' | 'stale' | null> {
    const link = await readlink(mountPath);
    const lexicalTarget = resolve(await realpath(dirname(mountPath)), link);
    const linkedTarget = await realpath(mountPath).catch(() => lexicalTarget);
    const draftRoot = await realpath(this.draftRoot);
    if (dirname(linkedTarget) !== draftRoot || !fnIsWidgetDraftSlug(basename(linkedTarget))) return null;
    const identity = await this.#readDraftIdentity(linkedTarget).catch(() => null);
    if (identity === null || identity.slug !== basename(linkedTarget)) return 'stale';
    return identity.name === name ? 'draft' : 'stale';
  }

  async #grepRoots(chatId: string, lexicalPath?: string): Promise<{ absolutePath: string; displayPath: string; widgetRoot: string }[]> {
    if (lexicalPath && lexicalPath !== 'widgets') {
      const resolved = await this.resolveMountedPath(chatId, lexicalPath);
      return [{ absolutePath: resolved.absolutePath, displayPath: lexicalPath, widgetRoot: resolved.widgetRoot }];
    }
    const mounts = await this.listMounts(chatId);
    return mounts.map((mount) => ({ absolutePath: mount.targetPath, displayPath: `widgets/${mount.name}`, widgetRoot: mount.targetPath }));
  }

  async #assertNameAvailable(chatId: string, name: string): Promise<void> {
    await this.#assertNoCaseCollision(join(this.getChatRoot(chatId), 'widgets'), name);
    const chatMountPath = join(this.getChatRoot(chatId), 'widgets', name);
    if (await lstat(chatMountPath).catch(() => null)) {
      throw new Error(`Widget name '${name}' is already in use.`);
    }
    const entries = await readdir(this.draftRoot, { withFileTypes: true }).catch(() => []);
    const caseKey = name.toLocaleLowerCase('en-US');
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !fnIsWidgetDraftSlug(entry.name)) continue;
      const identity = await this.#readDraftIdentity(join(this.draftRoot, entry.name));
      if (identity === null) continue;
      if (identity.name === name || identity.name.toLocaleLowerCase('en-US') === caseKey) {
        throw new Error(`Widget name '${name}' is already in use.`);
      }
    }
  }

  async #assertSlugAvailable(slug: string): Promise<void> {
    const entries = await readdir(this.draftRoot).catch(() => [] as string[]);
    const caseKey = slug.toLocaleLowerCase('en-US');
    const collision = entries.find((entry) => (
      entry.toLocaleLowerCase('en-US') === caseKey
    ));
    if (collision !== undefined) {
      throw new Error(
        collision === slug
          ? `Widget draft '${slug}' already exists.`
          : `Widget draft '${slug}' collides with existing '${collision}' on a case-insensitive filesystem.`,
      );
    }
  }

  async #assertNoCaseCollision(root: string, name: string): Promise<void> {
    const entries = await readdir(root).catch(() => []);
    const caseKey = name.toLocaleLowerCase('en-US');
    const collision = entries.find((entry) => entry !== name && entry.toLocaleLowerCase('en-US') === caseKey);
    if (collision) throw new Error(`Widget name '${name}' collides with existing '${collision}' on a case-insensitive filesystem.`);
  }

  async #isDirectDirectory(root: string, candidate: string): Promise<boolean> {
    const candidateStat = await lstat(candidate).catch(() => null);
    if (!candidateStat?.isDirectory() || candidateStat.isSymbolicLink()) return false;
    const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    return dirname(resolvedCandidate) === resolvedRoot;
  }

  async #mountLinkTarget(mountPath: string, targetPath: string): Promise<string> {
    if (this.#platform === 'win32') return targetPath;
    return relative(await realpath(dirname(mountPath)), targetPath);
  }

  #assertInside(root: string, candidate: string): void {
    const rel = relative(root, candidate);
    if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return;
    throw new Error('Mounted widget path resolves outside its registered widget folder.');
  }

  #matchesGlob(path: string, glob?: string): boolean {
    if (!glob || glob === '**/*' || glob === '*') return true;
    return fnMatchesGlob(glob, path) || fnMatchesGlob(glob, basename(path));
  }

  async #withWidgetWrite<T>(widgetRoot: string, operation: () => Promise<T>): Promise<T> {
    return this.#withWidgetWrites([widgetRoot], operation);
  }

  async #withWidgetWrites<T>(widgetRoots: readonly string[], operation: () => Promise<T>): Promise<T> {
    const canonicalRoots = await Promise.all(widgetRoots.map((root) => this.#canonicalWriteLaneKey(root)));
    const roots = [...new Set(canonicalRoots)].sort((left, right) => left.localeCompare(right));
    const reservations = roots.map((root) => {
      const previous = this.#writeQueues.get(root) ?? Promise.resolve();
      let settle: (() => void) | undefined;
      const gate = new Promise<void>((resolveGate) => { settle = resolveGate; });
      const tail = previous.catch(() => undefined).then(() => gate);
      this.#writeQueues.set(root, tail);
      return { root, previous, tail, settle };
    });
    await Promise.all(reservations.map(({ previous }) => previous.catch(() => undefined)));
    try {
      return await operation();
    } finally {
      for (const reservation of reservations) reservation.settle?.();
      for (const { root, tail } of reservations) {
        if (this.#writeQueues.get(root) === tail) this.#writeQueues.delete(root);
      }
    }
  }

  async #withQueue<T>(
    queues: Map<string, Promise<unknown>>,
    key: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    let settle: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => { settle = resolveGate; });
    const tail = previous.catch(() => undefined).then(() => gate);
    queues.set(key, tail);
    let removeAbortListener: (() => void) | undefined;
    try {
      await (signal === undefined
        ? previous.catch(() => undefined)
        : Promise.race([
            previous.catch(() => undefined),
            new Promise<never>((_resolve, reject) => {
              const rejectAborted = () => reject(new Error(
                'Draft authoring operation was cancelled before it could start.',
              ));
              if (signal.aborted) {
                rejectAborted();
                return;
              }
              signal.addEventListener('abort', rejectAborted, { once: true });
              removeAbortListener = () => signal.removeEventListener('abort', rejectAborted);
            }),
          ]));
      if (signal?.aborted) {
        throw new Error('Draft authoring operation was cancelled before it could start.');
      }
    } catch (error) {
      settle?.();
      void tail.then(() => {
        if (queues.get(key) === tail) queues.delete(key);
      });
      throw error;
    } finally {
      removeAbortListener?.();
    }
    try {
      return await operation();
    } finally {
      settle?.();
      if (queues.get(key) === tail) queues.delete(key);
    }
  }

  async #canonicalWriteLaneKey(candidate: string): Promise<string> {
    const absolute = resolve(candidate);
    const canonical = await realpath(absolute).catch(() => null);
    if (canonical) return canonical;
    const canonicalParent = await realpath(dirname(absolute)).catch(() => null);
    return canonicalParent ? join(canonicalParent, basename(absolute)) : absolute;
  }

  async #readDraftRevision(root: string): Promise<{ value: string; updatedAtMs: number }> {
    const hash = createHash('sha256');
    let updatedAtMicros = 0;
    const excluded = new Set(['node_modules', '.git', '.omnidraw-wizard', '.omnidraw-validate.tsconfig.json']);
    const updatePath = (kind: 'directory' | 'file' | 'symlink', absolutePath: string) => {
      const normalized = relative(root, absolutePath).split(sep).join('/');
      hash.update(kind);
      hash.update('\0');
      hash.update(normalized);
      hash.update('\0');
    };

    const walk = async (dir: string): Promise<void> => {
      const entries = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => !excluded.has(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
      for (const entry of entries) {
        const absolutePath = join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          updatePath('symlink', absolutePath);
          hash.update(await readlink(absolutePath));
          hash.update('\0');
          continue;
        }
        if (entry.isDirectory()) {
          updatePath('directory', absolutePath);
          await walk(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;
        updatePath('file', absolutePath);
        const contents = await readFile(absolutePath);
        hash.update(contents);
        hash.update('\0');
        const details = await lstat(absolutePath);
        updatedAtMicros = Math.max(updatedAtMicros, Math.round(details.mtimeMs * 1_000));
      }
    };

    await walk(root);
    return {
      value: hash.digest('hex'),
      updatedAtMs: updatedAtMicros / 1_000,
    };
  }

  #normalizeName(input: string): string {
    const normalized = fnNormalizeWidgetName(input);
    if (!normalized.ok) throw new Error(normalized.message);
    return normalized.value;
  }

  #safeId(): string {
    return this.#createId().replace(/[^a-zA-Z0-9_-]/g, '');
  }
}

export { constants as FILE_ACCESS_CONSTANTS };
