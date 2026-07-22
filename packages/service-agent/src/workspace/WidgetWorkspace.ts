import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  cp,
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
import { ZWidgetManifestV2, type TWidgetSourceSnapshot } from '@vibecanvas/widget-contract';
import { WidgetSourceSnapshot as WidgetSourceSnapshotMaterializer } from '@vibecanvas/widget-contract/local';
import { fnChatStorageSegments } from '@vibecanvas/shared-functions/chat/fn.chat-id';
import { fnMatchesGlob } from './fn.glob';
import { fnAssertSafeSearchPattern } from './fn.safe-search-pattern';
import { fnNormalizeWidgetName } from './fn.names';
import { fxWidgetCatalog } from './fx.widget-catalog';
import { txEnsureChatStorage } from './tx.chat-storage';
import { txMaterializeSdkPackage } from './tx.materialize-sdk-package';
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
  platform?: NodeJS.Platform;
  createId?: () => string;
  copyDirectory?: typeof cp;
};

type TTransientDraftSnapshot = {
  name: string;
  revision: string;
  rootPath: string;
  dispose(): Promise<void>;
};

type TDraftMaterializationIdentity = Readonly<{
  definitionId: string;
  publishedRevisionId: string;
  sourceDigestSha256: string;
}>;

type TDraftMaterializationMarker = TDraftMaterializationIdentity & Readonly<{
  version: 1;
  name: string;
}>;

type TDraftMaterializationResult = Readonly<{
  draft: TWidgetDraftWorkspaceEntry;
  created: boolean;
  pending: boolean;
  commitSeed<T>(operation: () => Promise<T>): Promise<T>;
  rollback(): Promise<boolean>;
}>;

type TDraftMaterializationMarkerRead =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'valid'; marker: TDraftMaterializationMarker }>;

type TScaffold = (args: TWidgetCreateInput & { cwd: string; name: string }) => Promise<string[]>;

const GREP_FILE_LIMIT = 500;
const GREP_BYTE_LIMIT = 2_000_000;
const GREP_MATCH_LIMIT = 500;
const MUTATION_FILE_BYTE_LIMIT = 5_000_000;

export class WidgetWorkspace {
  readonly agentRoot: string;
  readonly chatRoot: string;
  readonly draftRoot: string;
  readonly draftStateRoot: string;
  readonly sdkPackagePath: string;
  readonly #platform: NodeJS.Platform;
  readonly #createId: () => string;
  readonly #copyDirectory: typeof cp;
  readonly #writeQueues = new Map<string, Promise<unknown>>();

  constructor(config: TWidgetWorkspaceConfig) {
    this.agentRoot = join(config.dataPath, 'pi', 'agent');
    this.chatRoot = join(this.agentRoot, 'chats');
    this.draftRoot = join(this.agentRoot, 'widgets', 'drafts');
    this.draftStateRoot = join(this.agentRoot, 'draft-state');
    this.sdkPackagePath = join(this.agentRoot, 'sdk');
    this.#platform = config.platform ?? process.platform;
    this.#createId = config.createId ?? randomUUID;
    this.#copyDirectory = config.copyDirectory ?? cp;
  }

  async init(): Promise<void> {
    await txMaterializeSdkPackage({ readFile, writeFile, mkdir, lstat, rename, rm, join, dirname, createId: this.#createId }, {
      targetPath: this.sdkPackagePath,
    });
    await Promise.all([
      mkdir(this.chatRoot, { recursive: true }),
      mkdir(this.draftRoot, { recursive: true }),
      mkdir(this.draftStateRoot, { recursive: true }),
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

    const target = join(this.draftRoot, normalized);
    const temporary = join(this.draftRoot, `.create-${this.#safeId()}`);
    let promoted = false;
    try {
      await mkdir(temporary, { recursive: false });
      const files = await scaffold({ ...input, name: normalized, cwd: temporary });
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
    await this.#assertNoCaseCollision(this.draftRoot, name);
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

  /** Atomically promotes one verified immutable published snapshot into draft storage. */
  async materializeDraftFromSnapshot(
    requestedName: string,
    snapshot: TWidgetSourceSnapshot,
    publication: Readonly<{ definitionId: string; publishedRevisionId: string }>,
  ): Promise<TDraftMaterializationResult> {
    const name = this.#normalizeName(requestedName);
    const draftPath = join(this.draftRoot, name);
    const marker: TDraftMaterializationMarker = {
      version: 1,
      name,
      definitionId: publication.definitionId,
      publishedRevisionId: publication.publishedRevisionId,
      sourceDigestSha256: snapshot.digestSha256,
    };
    return this.#withWidgetWrite(draftPath, async () => {
      await this.#assertNoCaseCollision(this.draftRoot, name);
      const targetEntry = await lstat(draftPath).catch(() => null);
      if (targetEntry) {
        if (!await this.#isDirectDirectory(this.draftRoot, draftPath)) {
          throw new Error(`Widget draft '${name}' is not a managed directory.`);
        }
        const markerRead = await this.#readDraftMaterializationMarker(name);
        if (markerRead.status === 'invalid') {
          throw Object.assign(
            new Error(`Widget draft '${name}' has invalid pending materialization authority.`),
            { code: 'WIDGET_DRAFT_MATERIALIZATION_INVALID' },
          );
        }
        const draft = await this.#readDraftEntry(name, draftPath);
        if (!draft) throw new Error(`Widget draft '${name}' could not be read.`);
        if (markerRead.status === 'missing') {
          return {
            draft,
            created: false,
            pending: false,
            commitSeed: async () => {
              throw new Error(`Widget draft '${name}' is not pending publication materialization.`);
            },
            rollback: async () => false,
          };
        }
        if (
          !this.#matchesDraftMaterializationMarker(markerRead.marker, marker)
          || !await this.#draftSourceMatchesDigest(draftPath, marker.sourceDigestSha256)
        ) {
          await this.#removePendingDraftMaterialization(name, draftPath);
          throw Object.assign(
            new Error(`Widget draft '${name}' does not match its pending immutable publication source.`),
            { code: 'WIDGET_DRAFT_MATERIALIZATION_MISMATCH' },
          );
        }
        return this.#pendingDraftMaterializationResult(name, draftPath, draft, marker, false);
      }

      await rm(this.#draftMaterializationMarkerPath(name), { force: true }).catch(() => undefined);

      const temporary = join(this.draftRoot, `.materialize-${this.#safeId()}`);
      let markerWritten = false;
      let promoted = false;
      try {
        await new WidgetSourceSnapshotMaterializer().materialize(snapshot, temporary);
        const manifest = ZWidgetManifestV2.safeParse(await this.#readManifest(temporary));
        if (!manifest.success) {
          throw new Error('INVALID_MANIFEST: Published widget source has no valid manifest-v2.');
        }
        if (manifest.data.name !== name) {
          throw new Error(
            `INVALID_MANIFEST: Published widget identity is '${name}', but vibecanvas.json declares '${manifest.data.name}'.`,
          );
        }
        await this.#writeDraftMaterializationMarker(marker);
        markerWritten = true;
        await rename(temporary, draftPath);
        promoted = true;
        const draft = await this.#readDraftEntry(name, draftPath);
        if (!draft) throw new Error(`Widget draft '${name}' could not be read after materialization.`);
        return this.#pendingDraftMaterializationResult(name, draftPath, draft, marker, true);
      } catch (error) {
        if (markerWritten && !promoted) {
          await rm(this.#draftMaterializationMarkerPath(name), { force: true }).catch(() => undefined);
        }
        throw error;
      } finally {
        await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  async isDraftMaterializationPending(requestedName: string): Promise<boolean> {
    const name = this.#normalizeName(requestedName);
    return (await this.#readDraftMaterializationMarker(name)).status !== 'missing';
  }

  async updateDraftManifestAtomic<T>(
    requestedName: string,
    expectedRevision: string,
    update: (manifest: unknown) => T,
  ): Promise<{ manifest: T; revision: string }> {
    const name = this.#normalizeName(requestedName);
    const draftPath = join(this.draftRoot, name);
    return this.#withWidgetWrite(draftPath, async () => {
      if (!await this.#isDirectDirectory(this.draftRoot, draftPath)) throw new Error(`Widget draft '${name}' does not exist.`);
      const currentRevision = await this.#readDraftRevision(draftPath);
      if (currentRevision.value !== expectedRevision) {
        throw new Error(`STALE_REVISION: Widget draft '${name}' changed before the edit was saved.`);
      }
      const manifestPath = join(draftPath, 'vibecanvas.json');
      const entry = await lstat(manifestPath).catch(() => null);
      if (!entry || entry.isSymbolicLink() || !entry.isFile()) throw new Error('INVALID_MANIFEST: vibecanvas.json is not a regular file.');
      const manifest = update(JSON.parse(await readFile(manifestPath, 'utf8')));
      const temporary = join(draftPath, `.vibecanvas.json.edit-${this.#safeId()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await rename(temporary, manifestPath);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      return { manifest, revision: (await this.#readDraftRevision(draftPath)).value };
    });
  }

  async updateDraftManifestAndNameAtomic<T>(
    requestedName: string,
    requestedNextName: string,
    expectedRevision: string,
    update: (manifest: unknown) => T,
    coordinateCommit?: (commit: () => Promise<void>) => Promise<void>,
  ): Promise<{ name: string; manifest: T; revision: string }> {
    const name = this.#normalizeName(requestedName);
    const nextName = this.#normalizeName(requestedNextName);
    const draftPath = join(this.draftRoot, name);
    const nextDraftPath = join(this.draftRoot, nextName);
    return this.#withWidgetWrites([draftPath, nextDraftPath], async () => {
      if (!await this.#isDirectDirectory(this.draftRoot, draftPath)) throw new Error(`Widget draft '${name}' does not exist.`);
      const currentRevision = await this.#readDraftRevision(draftPath);
      if (currentRevision.value !== expectedRevision) {
        throw new Error(`STALE_REVISION: Widget draft '${name}' changed before the edit was saved.`);
      }
      if (nextName !== name) {
        await this.#assertNoCaseCollision(this.draftRoot, nextName);
        if (await lstat(nextDraftPath).catch(() => null)) {
          throw new Error(`NAME_IN_USE: Widget name '${nextName}' is already in use.`);
        }
      }

      const manifestPath = join(draftPath, 'vibecanvas.json');
      const entry = await lstat(manifestPath).catch(() => null);
      if (!entry || entry.isSymbolicLink() || !entry.isFile()) throw new Error('INVALID_MANIFEST: vibecanvas.json is not a regular file.');
      const previousManifestText = await readFile(manifestPath, 'utf8');
      const manifest = update(JSON.parse(previousManifestText));
      const temporary = join(draftPath, `.vibecanvas.json.edit-${this.#safeId()}.tmp`);
      let renamed = false;
      let manifestReplaced = false;
      let rollbackMounts: (() => Promise<void>) | null = null;
      const commit = async () => {
        await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await rename(temporary, manifestPath);
        manifestReplaced = true;
        if (nextName !== name) {
          await rename(draftPath, nextDraftPath);
          renamed = true;
          rollbackMounts = await this.#moveDraftMount(name, nextName, nextDraftPath);
        }
      };
      try {
        if (coordinateCommit) await coordinateCommit(commit);
        else await commit();
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        const rollback = rollbackMounts as (() => Promise<void>) | null;
        if (rollback) await rollback().catch(() => undefined);
        if (renamed && !await lstat(draftPath).catch(() => null)) {
          await rename(nextDraftPath, draftPath).catch(() => undefined);
        }
        if (manifestReplaced) {
          await writeFile(join(draftPath, 'vibecanvas.json'), previousManifestText, 'utf8').catch(() => undefined);
        }
        throw error;
      }
      return {
        name: nextName,
        manifest,
        revision: (await this.#readDraftRevision(nextDraftPath)).value,
      };
    });
  }

  async removeDraft(requestedName: string): Promise<boolean> {
    const name = this.#normalizeName(requestedName);
    const draftPath = join(this.draftRoot, name);
    return this.#withWidgetWrite(draftPath, async () => {
      if (!await this.#isDirectDirectory(this.draftRoot, draftPath)) {
        await rm(this.#draftMaterializationMarkerPath(name), { force: true });
        return false;
      }
      await rm(draftPath, { recursive: true, force: false });
      await this.#removeDraftMount(name);
      await rm(this.#draftMaterializationMarkerPath(name), { force: true });
      return true;
    });
  }

  async listMounts(chatId: string): Promise<TWidgetMount[]> {
    const chatRoot = await this.ensureChat(chatId);
    const widgetsRoot = join(chatRoot, 'widgets');
    const entries = await readdir(widgetsRoot, { withFileTypes: true });
    const mounts: TWidgetMount[] = [];
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const mount = await this.#inspectMount(chatRoot, entry.name).catch(() => null);
      if (mount) mounts.push(mount);
    }
    return mounts.sort((left, right) => left.name.localeCompare(right.name));
  }

  async listDrafts(): Promise<TWidgetDraftWorkspaceEntry[]> {
    const entries = await readdir(this.draftRoot, { withFileTypes: true }).catch(() => []);
    const drafts = await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
      const normalized = fnNormalizeWidgetName(entry.name);
      if (!normalized.ok || normalized.value !== entry.name) return null;
      return this.getDraft(entry.name);
    }));

    return drafts
      .filter((draft): draft is TWidgetDraftWorkspaceEntry => draft !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getDraft(requestedName: string): Promise<TWidgetDraftWorkspaceEntry | null> {
    const name = this.#normalizeName(requestedName);
    await this.#assertNoCaseCollision(this.draftRoot, name);
    const draftPath = join(this.draftRoot, name);
    if (await this.isDraftMaterializationPending(name)) return null;
    return this.#readDraftEntry(name, draftPath);
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
        const v2 = ZWidgetManifestV2.safeParse(value);
        if (v2.success) {
          return { ok: true as const, name: v2.data.name, kind: 'widget' as const };
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

  async removeAllMounts(chatId: string): Promise<number> {
    const chatRoot = await this.ensureChat(chatId);
    const entries = await readdir(join(chatRoot, 'widgets'), { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue;
      const normalized = fnNormalizeWidgetName(entry.name);
      if (!normalized.ok || !await this.#ownedMountKind(join(chatRoot, 'widgets', entry.name), normalized.value)) continue;
      if (await this.removeMount(chatId, normalized.value)) removed += 1;
    }
    return removed;
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

  async createTransientDraftSnapshot(requestedName: string, expectedRevision: string): Promise<TTransientDraftSnapshot> {
    const name = this.#normalizeName(requestedName);
    const draftPath = join(this.draftRoot, name);
    const rootPath = join(this.draftRoot, `.snapshot-${this.#safeId()}-${name}`);
    let settled = false;
    try {
      await this.#withWidgetWrite(draftPath, async () => {
        if (!await this.#isDirectDirectory(this.draftRoot, draftPath)) {
          throw new Error(`Widget draft '${name}' does not exist.`);
        }
        const before = await this.#readDraftRevision(draftPath);
        if (before.value !== expectedRevision) {
          throw Object.assign(
            new Error(`Widget draft '${name}' changed. Expected revision '${expectedRevision}', current revision '${before.value}'.`),
            { code: 'WIDGET_DRAFT_REVISION_CHANGED', currentRevision: before.value },
          );
        }
        await this.#copyWidgetFolder(draftPath, rootPath);
        const after = await this.#readDraftRevision(draftPath);
        if (after.value !== before.value) {
          throw Object.assign(
            new Error(`Widget draft '${name}' changed while its request snapshot was being created.`),
            { code: 'WIDGET_DRAFT_REVISION_CHANGED', currentRevision: after.value },
          );
        }
        const snapshot = await this.#readDraftRevision(rootPath);
        if (snapshot.value !== before.value) {
          throw Object.assign(
            new Error(`Widget draft '${name}' could not be copied into one coherent request snapshot.`),
            { code: 'WIDGET_DRAFT_SNAPSHOT_MISMATCH', currentRevision: after.value },
          );
        }
      });
    } catch (error) {
      await rm(rootPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return {
      name,
      revision: expectedRevision,
      rootPath,
      dispose: async () => {
        if (settled) return;
        await rm(rootPath, { recursive: true, force: true });
        settled = true;
      },
    };
  }

  /**
   * Runs a durable authoring commit only while the live draft still matches
   * the immutable source revision that was validated. The operation executes
   * inside the draft's write lane and must not call another workspace mutation
   * for the same draft.
   */
  async withDraftRevisionFence<T>(
    requestedName: string,
    expectedRevision: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const name = this.#normalizeName(requestedName);
    const draftPath = join(this.draftRoot, name);
    return this.#withWidgetWrite(draftPath, async () => {
      if (!await this.#isDirectDirectory(this.draftRoot, draftPath)) {
        throw new Error(`Widget draft '${name}' does not exist.`);
      }
      const currentRevision = (await this.#readDraftRevision(draftPath)).value;
      if (currentRevision !== expectedRevision) {
        throw Object.assign(
          new Error(`Widget draft '${name}' changed. Expected revision '${expectedRevision}', current revision '${currentRevision}'.`),
          { code: 'WIDGET_DRAFT_REVISION_CHANGED', currentRevision },
        );
      }
      return operation();
    });
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

  async #resolveDraftTarget(name: string): Promise<string> {
    const draft = join(this.draftRoot, name);
    if (await this.isDraftMaterializationPending(name)) {
      throw new Error(`Widget draft '${name}' is still pending durable materialization.`);
    }
    const draftExists = await this.#isDirectDirectory(this.draftRoot, draft);
    if (!draftExists) throw new Error(`Widget draft '${name}' does not exist.`);
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
      if (ownedKind !== 'draft') continue;
      if (
        await this.#isDirectDirectory(this.draftRoot, join(this.draftRoot, entry.name))
        && !await this.isDraftMaterializationPending(entry.name)
      ) continue;
      await rm(mountPath, { force: true });
    }

    const drafts = await readdir(this.draftRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of drafts) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const normalized = fnNormalizeWidgetName(entry.name);
      if (!normalized.ok || normalized.value !== entry.name) continue;
      if (await this.isDraftMaterializationPending(entry.name)) continue;
      const targetPath = await realpath(join(this.draftRoot, entry.name));
      const mountPath = join(widgetsRoot, entry.name);
      const existing = await lstat(mountPath).catch(() => null);
      if (existing) {
        if (!existing.isSymbolicLink()) continue;
        const existingTarget = await realpath(mountPath).catch(() => null);
        if (existingTarget === targetPath) continue;
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
    const targetParent = dirname(targetPath);
    if (targetParent !== draftRoot || basename(targetPath) !== name) throw new Error(`Widget mount '${name}' does not point to a shared draft.`);
    const targetStat = await lstat(targetPath);
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error(`Widget mount '${name}' has an invalid target.`);
    return { name, source: 'draft', chatRoot, mountPath, targetPath };
  }

  async #assertOwnedMountLink(mountPath: string, name: string): Promise<void> {
    if (!await this.#ownedMountKind(mountPath, name)) throw new Error(`Widget mount '${name}' is not owned by the backend.`);
  }

  async #ownedMountKind(mountPath: string, name: string): Promise<'draft' | null> {
    const link = await readlink(mountPath);
    const lexicalTarget = resolve(await realpath(dirname(mountPath)), link);
    const linkedTarget = await realpath(mountPath).catch(() => lexicalTarget);
    const draftRoot = await realpath(this.draftRoot);
    if (linkedTarget === join(draftRoot, name)) return 'draft';
    return null;
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
    await Promise.all([
      this.#assertNoCaseCollision(this.draftRoot, name),
      this.#assertNoCaseCollision(join(this.getChatRoot(chatId), 'widgets'), name),
    ]);
    const paths = [join(this.draftRoot, name), join(this.getChatRoot(chatId), 'widgets', name)];
    if ((await Promise.all(paths.map((path) => lstat(path).catch(() => null)))).some(Boolean)) {
      throw new Error(`Widget name '${name}' is already in use.`);
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

  async #removeDraftMount(name: string): Promise<void> {
    for (const root of await this.#existingChatWorkspaceRoots()) {
      await this.#withWidgetWrite(root, async () => {
        const mountPath = join(root, 'widgets', name);
        const entry = await lstat(mountPath).catch(() => null);
        if (!entry?.isSymbolicLink()) return;
        if (await this.#ownedMountKind(mountPath, name).catch(() => null) !== 'draft') return;
        await rm(mountPath, { force: true });
      });
    }
  }

  async #moveDraftMount(
    name: string,
    nextName: string,
    nextDraftPath: string,
  ): Promise<() => Promise<void>> {
    const moves: { mountPath: string; nextMountPath: string; root: string }[] = [];
    for (const root of await this.#existingChatWorkspaceRoots()) {
      const mountPath = join(root, 'widgets', name);
      const entry = await lstat(mountPath).catch(() => null);
      if (!entry?.isSymbolicLink()) continue;
      if (await this.#ownedMountKind(mountPath, name).catch(() => null) !== 'draft') continue;
      const nextMountPath = join(root, 'widgets', nextName);
      if (await lstat(nextMountPath).catch(() => null)) throw new Error(`Widget mount '${nextName}' already exists.`);
      moves.push({ mountPath, nextMountPath, root });
    }

    const completed: typeof moves = [];
    try {
      for (const move of moves) {
        await this.#withWidgetWrite(move.root, async () => {
          await rm(move.mountPath, { force: true });
          try {
            const linkTarget = await this.#mountLinkTarget(move.nextMountPath, nextDraftPath);
            await symlink(linkTarget, move.nextMountPath, this.#platform === 'win32' ? 'junction' : 'dir');
          } catch (error) {
            await rm(move.nextMountPath, { force: true }).catch(() => undefined);
            const draftPath = join(this.draftRoot, name);
            const linkTarget = await this.#mountLinkTarget(move.mountPath, draftPath);
            await symlink(
              linkTarget,
              move.mountPath,
              this.#platform === 'win32' ? 'junction' : 'dir',
            ).catch(() => undefined);
            throw error;
          }
        });
        completed.push(move);
      }
    } catch (error) {
      const draftPath = join(this.draftRoot, name);
      for (const move of completed.reverse()) {
        await this.#withWidgetWrite(move.root, async () => {
          await rm(move.nextMountPath, { force: true }).catch(() => undefined);
          const linkTarget = await this.#mountLinkTarget(move.mountPath, draftPath);
          await symlink(linkTarget, move.mountPath, this.#platform === 'win32' ? 'junction' : 'dir').catch(() => undefined);
        });
      }
      throw error;
    }
    let rolledBack = false;
    return async () => {
      if (rolledBack) return;
      rolledBack = true;
      const draftPath = join(this.draftRoot, name);
      for (const move of [...completed].reverse()) {
        await this.#withWidgetWrite(move.root, async () => {
          await rm(move.nextMountPath, { force: true }).catch(() => undefined);
          const linkTarget = await this.#mountLinkTarget(move.mountPath, draftPath);
          await symlink(
            linkTarget,
            move.mountPath,
            this.#platform === 'win32' ? 'junction' : 'dir',
          );
        });
      }
    };
  }

  async #existingChatWorkspaceRoots(): Promise<string[]> {
    const roots: string[] = [];
    const groups = await readdir(this.chatRoot, { withFileTypes: true }).catch(() => []);
    for (const group of groups) {
      if (!group.isDirectory() || group.isSymbolicLink()) continue;
      const groupRoot = join(this.chatRoot, group.name);
      const chats = await readdir(groupRoot, { withFileTypes: true }).catch(() => []);
      for (const chat of chats) {
        if (!chat.isDirectory() || chat.isSymbolicLink()) continue;
        const workspaceRoot = join(groupRoot, chat.name, 'workspace');
        const entry = await lstat(workspaceRoot).catch(() => null);
        if (entry?.isDirectory() && !entry.isSymbolicLink()) roots.push(workspaceRoot);
      }
    }
    return roots;
  }

  async #readDraftEntry(
    name: string,
    draftPath: string,
  ): Promise<TWidgetDraftWorkspaceEntry | null> {
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

  #draftMaterializationMarkerPath(name: string): string {
    const key = createHash('sha256').update(name).digest('hex');
    return join(this.draftStateRoot, `materialization-${key}.json`);
  }

  async #readDraftMaterializationMarker(name: string): Promise<TDraftMaterializationMarkerRead> {
    let source: string;
    try {
      source = await readFile(this.#draftMaterializationMarkerPath(name), 'utf8');
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? { status: 'missing' }
        : { status: 'invalid' };
    }
    try {
      const value: unknown = JSON.parse(source);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid' };
      const candidate = value as Record<string, unknown>;
      const keys = Object.keys(candidate).sort();
      if (keys.join('\0') !== [
        'definitionId',
        'name',
        'publishedRevisionId',
        'sourceDigestSha256',
        'version',
      ].join('\0')) return { status: 'invalid' };
      if (
        candidate.version !== 1
        || candidate.name !== name
        || typeof candidate.definitionId !== 'string'
        || typeof candidate.publishedRevisionId !== 'string'
        || typeof candidate.sourceDigestSha256 !== 'string'
        || !/^[0-9a-f]{64}$/.test(candidate.sourceDigestSha256)
      ) return { status: 'invalid' };
      return {
        status: 'valid',
        marker: {
          version: 1,
          name,
          definitionId: candidate.definitionId,
          publishedRevisionId: candidate.publishedRevisionId,
          sourceDigestSha256: candidate.sourceDigestSha256,
        },
      };
    } catch {
      return { status: 'invalid' };
    }
  }

  async #writeDraftMaterializationMarker(marker: TDraftMaterializationMarker): Promise<void> {
    const markerPath = this.#draftMaterializationMarkerPath(marker.name);
    const temporary = `${markerPath}.tmp-${this.#safeId()}`;
    try {
      await writeFile(temporary, `${JSON.stringify(marker)}\n`, 'utf8');
      await rename(temporary, markerPath);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  #matchesDraftMaterializationMarker(
    current: TDraftMaterializationMarker,
    expected: TDraftMaterializationMarker,
  ): boolean {
    return current.version === expected.version
      && current.name === expected.name
      && current.definitionId === expected.definitionId
      && current.publishedRevisionId === expected.publishedRevisionId
      && current.sourceDigestSha256 === expected.sourceDigestSha256;
  }

  async #draftSourceMatchesDigest(draftPath: string, expectedDigestSha256: string): Promise<boolean> {
    try {
      const snapshot = await new WidgetSourceSnapshotMaterializer().capture(draftPath, {
        expectedDigestSha256,
      });
      return snapshot.digestSha256 === expectedDigestSha256;
    } catch {
      return false;
    }
  }

  async #removePendingDraftMaterialization(name: string, draftPath: string): Promise<void> {
    if (await this.#isDirectDirectory(this.draftRoot, draftPath)) {
      await rm(draftPath, { recursive: true, force: false });
    }
    await this.#removeDraftMount(name);
    await rm(this.#draftMaterializationMarkerPath(name), { force: true });
  }

  async #pendingDraftMaterializationResult(
    name: string,
    draftPath: string,
    draft: TWidgetDraftWorkspaceEntry,
    marker: TDraftMaterializationMarker,
    created: boolean,
  ): Promise<TDraftMaterializationResult> {
    const createdEntry = await lstat(draftPath);
    const assertExact = async () => {
      const markerRead = await this.#readDraftMaterializationMarker(name);
      if (
        markerRead.status !== 'valid'
        || !this.#matchesDraftMaterializationMarker(markerRead.marker, marker)
      ) {
        throw Object.assign(
          new Error(`Widget draft '${name}' pending materialization authority changed.`),
          { code: 'WIDGET_DRAFT_MATERIALIZATION_INVALID' },
        );
      }
      const currentEntry = await lstat(draftPath).catch(() => null);
      if (
        !currentEntry
        || currentEntry.dev !== createdEntry.dev
        || currentEntry.ino !== createdEntry.ino
      ) {
        throw Object.assign(
          new Error(`Widget draft '${name}' pending materialization source was replaced.`),
          { code: 'WIDGET_DRAFT_MATERIALIZATION_INVALID' },
        );
      }
      if (!await this.#draftSourceMatchesDigest(draftPath, marker.sourceDigestSha256)) {
        await this.#removePendingDraftMaterialization(name, draftPath);
        throw Object.assign(
          new Error(`Widget draft '${name}' pending immutable source changed.`),
          { code: 'WIDGET_DRAFT_MATERIALIZATION_MISMATCH' },
        );
      }
    };
    return {
      draft,
      created,
      pending: true,
      commitSeed: <T>(operation: () => Promise<T>) => this.#withWidgetWrite(draftPath, async () => {
        await assertExact();
        const result = await operation();
        await rm(this.#draftMaterializationMarkerPath(name), { force: true });
        return result;
      }),
      rollback: () => this.#withWidgetWrite(draftPath, async () => {
        const markerRead = await this.#readDraftMaterializationMarker(name);
        const currentEntry = await lstat(draftPath).catch(() => null);
        if (
          markerRead.status !== 'valid'
          || !this.#matchesDraftMaterializationMarker(markerRead.marker, marker)
          || !currentEntry
          || currentEntry.dev !== createdEntry.dev
          || currentEntry.ino !== createdEntry.ino
        ) return false;
        await this.#removePendingDraftMaterialization(name, draftPath);
        return true;
      }),
    };
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

  async #canonicalWriteLaneKey(candidate: string): Promise<string> {
    const absolute = resolve(candidate);
    const canonical = await realpath(absolute).catch(() => null);
    if (canonical) return canonical;
    const canonicalParent = await realpath(dirname(absolute)).catch(() => null);
    return canonicalParent ? join(canonicalParent, basename(absolute)) : absolute;
  }

  async #copyWidgetFolder(source: string, target: string): Promise<void> {
    await this.#copyDirectory(source, target, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: async (candidate) => {
        const rel = relative(source, candidate);
        if (rel.split(sep).some((part) => (
          part === 'node_modules'
          || part === '.git'
          || part === '.vibecanvas-wizard'
          || part === '.vibecanvas-validate.tsconfig.json'
        ))) return false;
        if ((await lstat(candidate)).isSymbolicLink()) {
          throw Object.assign(
            new Error('Widget source snapshots cannot contain symbolic links.'),
            { code: 'WIDGET_DRAFT_SYMLINK_FORBIDDEN' },
          );
        }
        return true;
      },
    });
  }

  async #readDraftRevision(root: string): Promise<{ value: string; updatedAtMs: number }> {
    const hash = createHash('sha256');
    let updatedAtMicros = 0;
    const excluded = new Set(['node_modules', '.git', '.vibecanvas-wizard', '.vibecanvas-validate.tsconfig.json']);
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

  async #readManifest(root: string): Promise<Record<string, unknown> | null> {
    try {
      const value: unknown = JSON.parse(await readFile(join(root, 'vibecanvas.json'), 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch {
      return null;
    }
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
