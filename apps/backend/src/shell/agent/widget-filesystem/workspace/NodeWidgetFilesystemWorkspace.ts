import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import {
  dirname,
  join,
  parse,
  resolve,
} from 'node:path';
import { TextDecoder } from 'node:util';
import {
  fnCanonicalizeWidgetManifestV1,
  fnWidgetManifestV1Digest,
  parseWidgetManifestV1Json,
} from '#backend/core/widget-domain/filesystem';
import type { TWidgetImportTreeEntry } from '../import/typed';
import { fnCanonicalizeWidgetObservedFileSet } from '#backend/core/widget-filesystem/fn.file-set';
import {
  WIDGET_WORKSPACE_DIRECTORY_MODE,
  WIDGET_WORKSPACE_EXECUTABLE_FILE_MODE,
  WIDGET_WORKSPACE_FILE_MODE,
  WIDGET_WORKSPACE_MANIFEST_MAX_BYTES,
  WIDGET_WORKSPACE_SOURCE_EXCLUDED_DIRECTORIES,
} from './CONSTANTS';
import {
  fnCanonicalizeWidgetWorkspaceTreeCapture,
  fnClassifyWidgetWorkspaceManagedPath,
  fnIsWidgetWorkspaceSlug,
  fnNormalizeWidgetWorkspaceRelativePath,
  fnResolveWidgetWorkspaceLimits,
} from './fn.workspace-path';
import type {
  TNodeWidgetFilesystemWorkspaceConfig,
  TWidgetWorkspaceLimits,
  TWidgetWorkspaceManagedPath,
  TWidgetWorkspaceDraftBuildCapture,
  TWidgetWorkspaceDraftManifestSaveResult,
  TWidgetWorkspaceManifestObservation,
  TWidgetWorkspaceTreeCapture,
} from './typed';

type TFileStats = Awaited<ReturnType<typeof lstat>>;

type TPinnedDirectory = Readonly<{
  path: string;
  identity: string;
}>;

type TDirectoryObservation = Readonly<{
  path: string;
  token: string;
  entries: readonly Readonly<{
    name: string;
    kind: TWidgetImportTreeEntry['kind'];
    stats: TFileStats;
  }>[];
}>;

type TCapturedSourceFile = Readonly<{
  path: string;
  bytes: Uint8Array;
  executable: boolean;
}>;

type TInternalTreeCapture = Readonly<{
  capture: TWidgetWorkspaceTreeCapture;
  sourceFiles: readonly TCapturedSourceFile[];
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function identity(value: TFileStats): string {
  return [
    Number(value.dev),
    Number(value.ino),
    Number(value.size),
    Number(value.mode),
    Number(value.mtimeMs),
    Number(value.ctimeMs),
  ].join(':');
}

function sameIdentity(left: TFileStats, right: TFileStats): boolean {
  return left.isDirectory() === right.isDirectory()
    && left.isFile() === right.isFile()
    && left.isSymbolicLink() === right.isSymbolicLink()
    && identity(left) === identity(right);
}

function entryKind(value: TFileStats): TWidgetImportTreeEntry['kind'] {
  if (value.isSymbolicLink()) return 'symbolic-link';
  if (value.isDirectory()) return 'directory';
  if (value.isFile()) return 'file';
  return 'special';
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw errorWithCode('Widget filesystem operation was cancelled.', 'ABORT_ERR');
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
        `Widget filesystem path has a symlinked ancestor '${current}'.`,
        'WIDGET_WORKSPACE_ROOT_INVALID',
      );
    }
    if (!value.isDirectory()) {
      throw errorWithCode(
        `Widget filesystem ancestor '${current}' is not a directory.`,
        'WIDGET_WORKSPACE_ROOT_INVALID',
      );
    }
  }
}

async function pinExistingDirectory(requestedPath: string): Promise<TPinnedDirectory> {
  const requested = resolve(requestedPath);
  await assertLexicalAncestors(requested);
  const canonical = await realpath(requested);
  await assertLexicalAncestors(canonical);
  const value = await lstat(canonical);
  if (!value.isDirectory() || value.isSymbolicLink()) {
    throw errorWithCode(
      'Widget filesystem root must be a real existing directory.',
      'WIDGET_WORKSPACE_ROOT_INVALID',
    );
  }
  return Object.freeze({
    path: canonical,
    identity: `${Number(value.dev)}:${Number(value.ino)}`,
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Concrete, one-root filesystem edge for filesystem-first import and Preview.
 * Build, source acquisition, signing, and mounting remain injected upstream.
 */
export class NodeWidgetFilesystemWorkspace {
  readonly #root: TPinnedDirectory;
  readonly #limits: TWidgetWorkspaceLimits;

  private constructor(root: TPinnedDirectory, limits: TWidgetWorkspaceLimits) {
    this.#root = root;
    this.#limits = limits;
  }

  static async open(
    config: TNodeWidgetFilesystemWorkspaceConfig,
  ): Promise<NodeWidgetFilesystemWorkspace> {
    const workspace = new NodeWidgetFilesystemWorkspace(
      await pinExistingDirectory(config.rootPath),
      fnResolveWidgetWorkspaceLimits(config.limits),
    );
    await workspace.#assertLayout();
    return workspace;
  }

  get rootPath(): string {
    return this.#root.path;
  }

  async listDraftDirectoryNames(
    args: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly string[]> {
    assertNotAborted(args.signal);
    const observation = await this.#observeDirectory(
      join(this.#root.path, 'drafts'),
      'drafts',
      args.signal,
    );
    const folded = new Map<string, string>();
    const names: string[] = [];
    for (const entry of observation.entries) {
      assertNotAborted(args.signal);
      if (!fnIsWidgetWorkspaceSlug(entry.name)) {
        throw errorWithCode(
          `Unsafe draft directory slug '${entry.name}'.`,
          'WIDGET_WORKSPACE_DRAFT_SLUG_INVALID',
        );
      }
      if (entry.kind !== 'directory') {
        throw errorWithCode(
          `Draft '${entry.name}' must be a real directory.`,
          entry.kind === 'symbolic-link'
            ? 'WIDGET_WORKSPACE_LINK_NOT_ALLOWED'
            : 'WIDGET_WORKSPACE_SPECIAL_NOT_ALLOWED',
        );
      }
      const collision = folded.get(entry.name.toLowerCase());
      if (collision !== undefined && collision !== entry.name) {
        throw errorWithCode(
          `Draft directory names '${collision}' and '${entry.name}' collide by case.`,
          'WIDGET_WORKSPACE_CASE_COLLISION',
        );
      }
      folded.set(entry.name.toLowerCase(), entry.name);
      names.push(entry.name);
    }
    await this.#assertDirectoryUnchanged(observation, args.signal);
    return Object.freeze(names.sort(compareText));
  }

  async prepareStaging(args: Readonly<{
    relativePath: string;
    expectedAbsent: true;
    signal: AbortSignal;
  }>): Promise<void> {
    if (args.expectedAbsent !== true) throw new TypeError('Staging preparation must require absence.');
    const managed = this.#requireManagedRoot(args.relativePath, 'staging');
    assertNotAborted(args.signal);
    await this.#createExclusiveManagedDirectory(managed, args.signal);
  }

  async prepareTempPath(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<void> {
    const managed = this.#requireManagedRoot(args.relativePath, 'preview');
    assertNotAborted(args.signal);
    await this.#ensureRealDirectory('.preview/sessions', args.signal);
    await this.#createExclusiveManagedDirectory(managed, args.signal);
  }

  async copyExternalCheckout(args: Readonly<{
    sourceRootPath: string;
    destinationRelativePath: string;
    mode: 'copy-files-no-follow';
    signal: AbortSignal;
  }>): Promise<TWidgetWorkspaceTreeCapture> {
    if (args.mode !== 'copy-files-no-follow') {
      throw new TypeError('Widget checkout copy mode must be copy-files-no-follow.');
    }
    const destination = this.#requireManagedRoot(args.destinationRelativePath, 'staging');
    const destinationPath = await this.#assertManagedDirectory(destination);
    const empty = await this.#captureTree({
      basePath: destinationPath,
      rootRelativePath: destination.rootRelativePath,
      captureBytes: false,
      excludeGeneratedSource: false,
      signal: args.signal,
    });
    if (empty.capture.entries.length !== 0) {
      throw errorWithCode(
        'Widget import staging directory must be empty before copy.',
        'WIDGET_WORKSPACE_STAGING_NOT_EMPTY',
      );
    }

    const source = await pinExistingDirectory(args.sourceRootPath);
    if (
      source.path === this.#root.path
      || source.path.startsWith(`${this.#root.path}/`)
    ) {
      throw errorWithCode(
        'External widget checkout must be outside the managed widget root.',
        'WIDGET_WORKSPACE_SOURCE_NOT_EXTERNAL',
      );
    }
    const captured = await this.#captureTree({
      basePath: source.path,
      rootRelativePath: destination.rootRelativePath,
      captureBytes: true,
      excludeGeneratedSource: true,
      signal: args.signal,
    });
    await this.#materializeCapturedTree(destinationPath, captured, args.signal);
    const staged = await this.captureManagedTree({
      relativePath: destination.rootRelativePath,
      signal: args.signal,
    });
    if (staged.digestSha256 !== captured.capture.digestSha256) {
      throw errorWithCode(
        'Copied widget staging tree does not match the captured checkout bytes.',
        'WIDGET_WORKSPACE_COPY_DIGEST_MISMATCH',
      );
    }
    return staged;
  }

  async observeManagedTree(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<readonly TWidgetImportTreeEntry[]> {
    return (await this.captureManagedTree(args)).entries;
  }

  async captureManagedTree(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<TWidgetWorkspaceTreeCapture> {
    const managed = this.#requireManagedRoot(args.relativePath);
    const basePath = await this.#assertManagedDirectory(managed);
    return (await this.#captureTree({
      basePath,
      rootRelativePath: managed.rootRelativePath,
      captureBytes: false,
      excludeGeneratedSource: false,
      signal: args.signal,
    })).capture;
  }

  async readManagedFile(args: Readonly<{
    relativePath: string;
    maximumBytes: number;
    signal: AbortSignal;
  }>): Promise<Uint8Array> {
    const managed = fnClassifyWidgetWorkspaceManagedPath(args.relativePath);
    if (managed === null || managed.relativePath !== args.relativePath) {
      throw errorWithCode('Unsafe managed widget file path.', 'WIDGET_WORKSPACE_PATH_UNSAFE');
    }
    if (!Number.isSafeInteger(args.maximumBytes) || args.maximumBytes < 0) {
      throw new TypeError('Managed widget file limit must be a non-negative integer.');
    }
    await this.#assertRoot();
    await this.#assertRealDirectoryChain(managed.segments.slice(0, -1));
    return this.#readExactFile(
      join(this.#root.path, ...managed.segments),
      args.maximumBytes,
      args.signal,
    );
  }

  async inspectManagedManifest(args: Readonly<{
    relativePath: string;
    signal: AbortSignal;
  }>): Promise<TWidgetWorkspaceManifestObservation> {
    const managed = this.#requireManagedRoot(args.relativePath);
    const capture = await this.captureManagedTree({
      relativePath: managed.rootRelativePath,
      signal: args.signal,
    });
    const bytes = await this.readManagedFile({
      relativePath: `${managed.rootRelativePath}/omnidraw.json`,
      maximumBytes: WIDGET_WORKSPACE_MANIFEST_MAX_BYTES,
      signal: args.signal,
    });
    const manifestFile = capture.files.find((file) => file.path === 'omnidraw.json');
    if (
      manifestFile === undefined
      || manifestFile.byteSize !== bytes.byteLength
      || manifestFile.sha256 !== sha256(bytes)
    ) {
      throw errorWithCode(
        'Managed widget manifest bytes changed after the tree capture.',
        'WIDGET_WORKSPACE_MANIFEST_CHANGED',
      );
    }
    let manifest;
    try {
      manifest = parseWidgetManifestV1Json(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch (error) {
      throw errorWithCode(
        `Managed widget manifest is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
        'WIDGET_WORKSPACE_MANIFEST_INVALID',
      );
    }
    if (managed.namespace === 'draft' && managed.segments[1] !== manifest.slug) {
      throw errorWithCode(
        `Draft folder '${managed.segments[1]}' does not match manifest slug '${manifest.slug}'.`,
        'WIDGET_WORKSPACE_MANIFEST_SLUG_MISMATCH',
      );
    }
    const confirmed = await this.captureManagedTree({
      relativePath: managed.rootRelativePath,
      signal: args.signal,
    });
    if (confirmed.digestSha256 !== capture.digestSha256) {
      throw errorWithCode(
        'Managed widget tree changed while its manifest was inspected.',
        'WIDGET_WORKSPACE_MANIFEST_CHANGED',
      );
    }
    return Object.freeze({
      slug: manifest.slug,
      manifest,
      canonicalJson: fnCanonicalizeWidgetManifestV1(manifest),
      manifestDigestSha256: fnWidgetManifestV1Digest({ manifest, digestSha256: sha256 }),
      treeDigestSha256: confirmed.digestSha256,
    });
  }

  async captureDraftBuildInput(args: Readonly<{
    slug: string;
    signal: AbortSignal;
  }>): Promise<TWidgetWorkspaceDraftBuildCapture> {
    if (!fnIsWidgetWorkspaceSlug(args.slug)) {
      throw errorWithCode('Widget draft slug is invalid.', 'WIDGET_WORKSPACE_DRAFT_SLUG_INVALID');
    }
    const managed = this.#requireManagedRoot(`drafts/${args.slug}`, 'draft');
    const basePath = await this.#assertManagedDirectory(managed);
    const captured = await this.#captureTree({
      basePath,
      rootRelativePath: managed.rootRelativePath,
      captureBytes: true,
      excludeGeneratedSource: true,
      signal: args.signal,
    });
    const manifestSource = captured.sourceFiles.find((file) => file.path === 'omnidraw.json');
    if (manifestSource === undefined) {
      throw errorWithCode(
        'Widget draft is missing omnidraw.json.',
        'WIDGET_WORKSPACE_MANIFEST_INVALID',
      );
    }
    let manifest;
    try {
      manifest = parseWidgetManifestV1Json(
        new TextDecoder('utf-8', { fatal: true }).decode(manifestSource.bytes),
      );
    } catch (error) {
      throw errorWithCode(
        `Managed widget manifest is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
        'WIDGET_WORKSPACE_MANIFEST_INVALID',
      );
    }
    if (manifest.slug !== args.slug) {
      throw errorWithCode(
        `Draft folder '${args.slug}' does not match manifest slug '${manifest.slug}'.`,
        'WIDGET_WORKSPACE_MANIFEST_SLUG_MISMATCH',
      );
    }
    const confirmed = await this.#captureTree({
      basePath,
      rootRelativePath: managed.rootRelativePath,
      captureBytes: false,
      excludeGeneratedSource: true,
      signal: args.signal,
    });
    if (confirmed.capture.digestSha256 !== captured.capture.digestSha256) {
      throw errorWithCode(
        'Widget draft changed while its build input was captured.',
        'WIDGET_WORKSPACE_TREE_DIGEST_MISMATCH',
      );
    }
    return Object.freeze({
      slug: args.slug,
      manifest,
      canonicalManifestJson: fnCanonicalizeWidgetManifestV1(manifest),
      manifestDigestSha256: fnWidgetManifestV1Digest({ manifest, digestSha256: sha256 }),
      treeDigestSha256: confirmed.capture.digestSha256,
      fileSetDigestSha256: sha256(
        fnCanonicalizeWidgetObservedFileSet(confirmed.capture.files),
      ),
      files: Object.freeze(captured.sourceFiles
        .filter((file) => file.path !== 'omnidraw.json')
        .map((file) => Object.freeze({
          path: file.path,
          bytes: new Uint8Array(file.bytes),
        }))),
    });
  }

  async saveDraftManifest(args: Readonly<{
    slug: string;
    expectedManifestDigestSha256: string;
    manifest: TWidgetWorkspaceDraftManifestSaveResult['manifest'];
    operationToken: string;
    signal: AbortSignal;
  }>): Promise<TWidgetWorkspaceDraftManifestSaveResult> {
    if (!fnIsWidgetWorkspaceSlug(args.slug)) {
      throw errorWithCode('Widget draft slug is invalid.', 'WIDGET_WORKSPACE_DRAFT_SLUG_INVALID');
    }
    if (!/^[0-9a-f]{64}$/.test(args.expectedManifestDigestSha256)) {
      throw new TypeError('Draft manifest save requires an expected lowercase SHA-256 digest.');
    }
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(args.operationToken)) {
      throw new TypeError('Draft manifest save operation token is invalid.');
    }
    const canonicalJson = fnCanonicalizeWidgetManifestV1(args.manifest);
    const manifest = parseWidgetManifestV1Json(canonicalJson);
    if (manifest.slug !== args.slug) {
      throw errorWithCode(
        'Structured Config cannot rename a widget slug.',
        'WIDGET_WORKSPACE_MANIFEST_SLUG_MISMATCH',
      );
    }
    const before = await this.inspectManagedManifest({
      relativePath: `drafts/${args.slug}`,
      signal: args.signal,
    });
    if (before.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
      throw errorWithCode(
        'Widget draft manifest changed after the Config form was loaded.',
        'WIDGET_WORKSPACE_MANIFEST_CONFLICT',
      );
    }
    const stagingRoot = join(this.#root.path, '.staging');
    await this.#assertRealDirectoryChain(['.staging']);
    const temporaryPath = join(
      stagingRoot,
      `${args.slug}.${args.operationToken}.manifest.json`,
    );
    const manifestPath = join(this.#root.path, 'drafts', args.slug, 'omnidraw.json');
    assertNotAborted(args.signal);
    const handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      WIDGET_WORKSPACE_FILE_MODE,
    );
    let temporaryPresent = true;
    try {
      await handle.writeFile(`${canonicalJson}\n`);
      await handle.sync();
      const opened = await handle.stat();
      if (!opened.isFile() || await this.#openedCanonicalPath(handle.fd) !== temporaryPath) {
        throw errorWithCode(
          'Draft manifest staging file identity changed.',
          'WIDGET_WORKSPACE_FILE_CHANGED',
        );
      }
      await handle.close();
      assertNotAborted(args.signal);
      const rechecked = await this.inspectManagedManifest({
        relativePath: `drafts/${args.slug}`,
        signal: args.signal,
      });
      if (rechecked.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
        throw errorWithCode(
          'Widget draft manifest changed before Config was saved.',
          'WIDGET_WORKSPACE_MANIFEST_CONFLICT',
        );
      }
      await rename(temporaryPath, manifestPath);
      temporaryPresent = false;
      await this.#syncDirectory(join(this.#root.path, 'drafts', args.slug));
      await this.#syncDirectory(stagingRoot);
      const after = await this.inspectManagedManifest({
        relativePath: `drafts/${args.slug}`,
        signal: args.signal,
      });
      const expectedDigest = fnWidgetManifestV1Digest({ manifest, digestSha256: sha256 });
      if (after.manifestDigestSha256 !== expectedDigest) {
        throw errorWithCode(
          'Saved widget manifest bytes failed exact re-open validation.',
          'WIDGET_WORKSPACE_MANIFEST_CHANGED',
        );
      }
      return Object.freeze({
        slug: args.slug,
        manifest: after.manifest,
        canonicalJson: after.canonicalJson,
        previousManifestDigestSha256: before.manifestDigestSha256,
        manifestDigestSha256: after.manifestDigestSha256,
      });
    } finally {
      try {
        await handle.close();
      } catch {
        // The success path closes before rename so Windows and strict hosts can replace safely.
      }
      if (temporaryPresent) await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async promoteStaging(args: Readonly<{
    stagingRelativePath: string;
    draftRelativePath: string;
    expectedDraftAbsent: true;
    expectedTreeDigestSha256: string;
    signal: AbortSignal;
  }>): Promise<void> {
    if (args.expectedDraftAbsent !== true) throw new TypeError('Draft promotion must require absence.');
    if (!/^[0-9a-f]{64}$/.test(args.expectedTreeDigestSha256)) {
      throw new TypeError('Draft promotion requires a lowercase SHA-256 tree digest.');
    }
    const staging = this.#requireManagedRoot(args.stagingRelativePath, 'staging');
    const draft = this.#requireManagedRoot(args.draftRelativePath, 'draft');
    const sourcePath = await this.#assertManagedDirectory(staging);
    assertNotAborted(args.signal);
    await this.#assertDraftDestinationAvailable(draft.segments[1]!, args.signal);
    const manifest = await this.inspectManagedManifest({
      relativePath: staging.rootRelativePath,
      signal: args.signal,
    });
    if (manifest.slug !== draft.segments[1]) {
      throw errorWithCode(
        `Staged manifest slug '${manifest.slug}' does not match draft target '${draft.segments[1]}'.`,
        'WIDGET_WORKSPACE_MANIFEST_SLUG_MISMATCH',
      );
    }
    if (manifest.treeDigestSha256 !== args.expectedTreeDigestSha256) {
      throw errorWithCode(
        'Staged manifest observation does not match the expected tree digest.',
        'WIDGET_WORKSPACE_TREE_DIGEST_MISMATCH',
      );
    }
    const capture = await this.captureManagedTree({
      relativePath: staging.rootRelativePath,
      signal: args.signal,
    });
    if (capture.digestSha256 !== args.expectedTreeDigestSha256) {
      throw errorWithCode(
        'Widget staging tree changed since the expected digest was captured.',
        'WIDGET_WORKSPACE_TREE_DIGEST_MISMATCH',
      );
    }
    await this.#syncTree(sourcePath, capture, args.signal);
    assertNotAborted(args.signal);
    const destinationPath = join(this.#root.path, ...draft.segments.slice(0, 2));
    await rename(sourcePath, destinationPath);
    try {
      const promoted = await this.captureManagedTree({
        relativePath: draft.rootRelativePath,
        signal: args.signal,
      });
      if (promoted.digestSha256 !== args.expectedTreeDigestSha256) {
        throw errorWithCode(
          'Promoted draft bytes do not match the expected staging digest.',
          'WIDGET_WORKSPACE_PROMOTION_DIGEST_MISMATCH',
        );
      }
    } catch (error) {
      try {
        await rename(destinationPath, sourcePath);
        await this.#syncDirectory(join(this.#root.path, 'drafts'));
        await this.#syncDirectory(join(this.#root.path, '.staging'));
      } catch (rollbackError) {
        throw errorWithCode(
          `Draft promotion validation and rollback failed: ${String(error)}; ${String(rollbackError)}`,
          'WIDGET_WORKSPACE_PROMOTION_ROLLBACK_FAILED',
        );
      }
      throw error;
    }
    await this.#syncDirectory(join(this.#root.path, 'drafts'));
    await this.#syncDirectory(join(this.#root.path, '.staging'));
  }

  async removeManagedPath(args: Readonly<{ relativePath: string }>): Promise<void> {
    const managed = this.#requireManagedRoot(args.relativePath);
    if (managed.namespace === 'draft') {
      throw errorWithCode(
        'Draft paths cannot be removed through temporary workspace cleanup.',
        'WIDGET_WORKSPACE_REMOVE_FORBIDDEN',
      );
    }
    await this.#removeTree(join(this.#root.path, ...managed.segments));
    const parent = managed.namespace === 'staging'
      ? join(this.#root.path, '.staging')
      : join(this.#root.path, '.preview', 'sessions');
    await this.#syncDirectory(parent);
  }

  async removeTempPath(args: Readonly<{ relativePath: string }>): Promise<void> {
    const managed = this.#requireManagedRoot(args.relativePath, 'preview');
    await this.removeManagedPath({ relativePath: managed.rootRelativePath });
  }

  async #assertLayout(): Promise<void> {
    await this.#assertRoot();
    const root = await this.#observeDirectory(this.#root.path, '', undefined);
    const folded = new Map(root.entries.map((entry) => [entry.name.toLowerCase(), entry.name]));
    for (const name of ['drafts', '.staging', '.preview'] as const) {
      const collision = root.entries.filter((entry) => entry.name.toLowerCase() === name.toLowerCase());
      if (collision.length !== 1 || collision[0]!.name !== name || collision[0]!.kind !== 'directory') {
        throw errorWithCode(
          `Widget root requires one real, exactly-cased '${name}/' directory.`,
          'WIDGET_WORKSPACE_LAYOUT_INVALID',
        );
      }
      if (folded.get(name.toLowerCase()) !== name) {
        throw errorWithCode('Widget root contains a case collision.', 'WIDGET_WORKSPACE_CASE_COLLISION');
      }
    }
    await this.#assertDirectoryUnchanged(root, undefined);
  }

  #requireManagedRoot(
    relativePath: string,
    expectedNamespace?: TWidgetWorkspaceManagedPath['namespace'],
  ): TWidgetWorkspaceManagedPath {
    const managed = fnClassifyWidgetWorkspaceManagedPath(relativePath);
    if (
      managed === null
      || managed.relativePath !== relativePath
      || managed.rootRelativePath !== relativePath
      || (expectedNamespace !== undefined && managed.namespace !== expectedNamespace)
    ) {
      throw errorWithCode(
        `Unsafe managed widget root path '${relativePath}'.`,
        'WIDGET_WORKSPACE_PATH_UNSAFE',
      );
    }
    return managed;
  }

  async #assertRoot(): Promise<void> {
    const value = await lstat(this.#root.path).catch(() => null);
    if (
      value === null
      || !value.isDirectory()
      || value.isSymbolicLink()
      || `${Number(value.dev)}:${Number(value.ino)}` !== this.#root.identity
      || await realpath(this.#root.path).catch(() => null) !== this.#root.path
    ) throw errorWithCode('Pinned widget root identity changed.', 'WIDGET_WORKSPACE_ROOT_CHANGED');
  }

  async #assertManagedDirectory(managed: TWidgetWorkspaceManagedPath): Promise<string> {
    await this.#assertRoot();
    await this.#assertRealDirectoryChain(managed.segments);
    return join(this.#root.path, ...managed.segments);
  }

  async #assertRealDirectoryChain(segments: readonly string[]): Promise<void> {
    let path = this.#root.path;
    for (const segment of segments) {
      path = join(path, segment);
      const value = await lstat(path);
      if (!value.isDirectory() || value.isSymbolicLink()) {
        throw errorWithCode(
          `Managed widget path '${path}' crosses a link or non-directory.`,
          'WIDGET_WORKSPACE_LINK_NOT_ALLOWED',
        );
      }
    }
  }

  async #ensureRealDirectory(relativePath: string, signal: AbortSignal): Promise<void> {
    const normalized = fnNormalizeWidgetWorkspaceRelativePath(relativePath);
    if (normalized === null || normalized !== relativePath) {
      throw errorWithCode('Unsafe managed directory path.', 'WIDGET_WORKSPACE_PATH_UNSAFE');
    }
    const segments = normalized.split('/');
    await this.#assertRealDirectoryChain(segments.slice(0, -1));
    const path = join(this.#root.path, ...segments);
    const existing = await lstat(path).catch((error) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (existing === null) {
      assertNotAborted(signal);
      await mkdir(path, { recursive: false, mode: WIDGET_WORKSPACE_DIRECTORY_MODE });
      await this.#syncDirectory(dirname(path));
    }
    const value = await lstat(path);
    if (!value.isDirectory() || value.isSymbolicLink()) {
      throw errorWithCode('Managed directory is not a real directory.', 'WIDGET_WORKSPACE_LINK_NOT_ALLOWED');
    }
  }

  async #createExclusiveManagedDirectory(
    managed: TWidgetWorkspaceManagedPath,
    signal: AbortSignal,
  ): Promise<void> {
    const parentSegments = managed.rootRelativePath.split('/').slice(0, -1);
    await this.#assertRealDirectoryChain(parentSegments);
    const name = managed.rootRelativePath.split('/').at(-1)!;
    const parentPath = join(this.#root.path, ...parentSegments);
    const parent = await this.#observeDirectory(parentPath, parentSegments.join('/'), signal);
    const collision = parent.entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (collision !== undefined) {
      throw errorWithCode(
        `Managed path '${managed.rootRelativePath}' already exists or collides by case.`,
        collision.name === name
          ? 'WIDGET_WORKSPACE_PATH_EXISTS'
          : 'WIDGET_WORKSPACE_CASE_COLLISION',
      );
    }
    assertNotAborted(signal);
    await mkdir(join(parentPath, name), {
      recursive: false,
      mode: WIDGET_WORKSPACE_DIRECTORY_MODE,
    });
    await this.#syncDirectory(parentPath);
  }

  async #assertDraftDestinationAvailable(slug: string, signal: AbortSignal): Promise<void> {
    if (!fnIsWidgetWorkspaceSlug(slug)) throw new TypeError('Draft slug is invalid.');
    const names = await this.listDraftDirectoryNames({ signal });
    const collision = names.find((name) => name.toLowerCase() === slug.toLowerCase());
    if (collision !== undefined) {
      throw errorWithCode(
        `Draft '${slug}' already exists or collides with '${collision}'.`,
        collision === slug
          ? 'WIDGET_WORKSPACE_DRAFT_EXISTS'
          : 'WIDGET_WORKSPACE_CASE_COLLISION',
      );
    }
  }

  async #captureTree(args: Readonly<{
    basePath: string;
    rootRelativePath: string;
    captureBytes: boolean;
    excludeGeneratedSource: boolean;
    signal: AbortSignal;
  }>): Promise<TInternalTreeCapture> {
    assertNotAborted(args.signal);
    const root = await lstat(args.basePath);
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw errorWithCode('Widget tree root must be a real directory.', 'WIDGET_WORKSPACE_LINK_NOT_ALLOWED');
    }
    const entries: TWidgetImportTreeEntry[] = [];
    const files: TWidgetWorkspaceTreeCapture['files'][number][] = [];
    const sourceFiles: TCapturedSourceFile[] = [];
    const observations: TDirectoryObservation[] = [];
    const queue: Array<Readonly<{ path: string; relativePath: string; depth: number }>> = [{
      path: args.basePath,
      relativePath: '',
      depth: 0,
    }];
    const foldedPaths = new Map<string, string>();
    let totalBytes = 0;
    let directoryCount = 1;

    while (queue.length > 0) {
      assertNotAborted(args.signal);
      const directory = queue.shift()!;
      const observation = await this.#observeDirectory(
        directory.path,
        directory.relativePath,
        args.signal,
      );
      observations.push(observation);
      for (const entry of observation.entries) {
        assertNotAborted(args.signal);
        const relativePath = directory.relativePath === ''
          ? entry.name
          : `${directory.relativePath}/${entry.name}`;
        const normalized = fnNormalizeWidgetWorkspaceRelativePath(
          relativePath,
          this.#limits.maxPathBytes,
        );
        if (normalized === null || normalized !== relativePath) {
          throw errorWithCode(
            `Unsafe widget tree path '${relativePath}'.`,
            'WIDGET_WORKSPACE_PATH_UNSAFE',
          );
        }
        const prior = foldedPaths.get(normalized.toLowerCase());
        if (prior !== undefined && prior !== normalized) {
          throw errorWithCode(
            `Widget tree paths '${prior}' and '${normalized}' collide by case.`,
            'WIDGET_WORKSPACE_CASE_COLLISION',
          );
        }
        foldedPaths.set(normalized.toLowerCase(), normalized);
        if (entry.kind === 'symbolic-link' || entry.kind === 'junction') {
          throw errorWithCode(
            `Widget tree link '${normalized}' is not allowed.`,
            'WIDGET_WORKSPACE_LINK_NOT_ALLOWED',
          );
        }
        if (entry.kind === 'special') {
          throw errorWithCode(
            `Widget tree special file '${normalized}' is not allowed.`,
            'WIDGET_WORKSPACE_SPECIAL_NOT_ALLOWED',
          );
        }
        if (
          entry.kind === 'directory'
          && args.excludeGeneratedSource
          && directory.depth === 0
          && WIDGET_WORKSPACE_SOURCE_EXCLUDED_DIRECTORIES.has(entry.name)
        ) continue;
        if (entries.length >= this.#limits.maxEntries) {
          throw errorWithCode('Widget tree exceeds its entry limit.', 'WIDGET_WORKSPACE_ENTRY_LIMIT');
        }
        entries.push(Object.freeze({ path: normalized, kind: entry.kind }));
        if (entry.kind === 'directory') {
          if (directory.depth + 1 > this.#limits.maxDepth) {
            throw errorWithCode('Widget tree exceeds its depth limit.', 'WIDGET_WORKSPACE_DEPTH_LIMIT');
          }
          directoryCount += 1;
          if (directoryCount > this.#limits.maxDirectories) {
            throw errorWithCode('Widget tree exceeds its directory limit.', 'WIDGET_WORKSPACE_DIRECTORY_LIMIT');
          }
          queue.push({
            path: join(directory.path, entry.name),
            relativePath: normalized,
            depth: directory.depth + 1,
          });
          continue;
        }
        if (files.length >= this.#limits.maxFiles) {
          throw errorWithCode('Widget tree exceeds its file limit.', 'WIDGET_WORKSPACE_FILE_LIMIT');
        }
        const observedSize = Number(entry.stats.size);
        if (observedSize > this.#limits.maxFileBytes) {
          throw errorWithCode(
            `Widget file '${normalized}' exceeds its per-file byte limit.`,
            'WIDGET_WORKSPACE_FILE_SIZE_LIMIT',
          );
        }
        if (totalBytes + observedSize > this.#limits.maxTotalBytes) {
          throw errorWithCode('Widget tree exceeds its total byte limit.', 'WIDGET_WORKSPACE_TOTAL_SIZE_LIMIT');
        }
        const bytes = await this.#readExactFile(
          join(directory.path, entry.name),
          this.#limits.maxFileBytes,
          args.signal,
        );
        totalBytes += bytes.byteLength;
        files.push(Object.freeze({
          path: normalized,
          byteSize: bytes.byteLength,
          sha256: sha256(bytes),
        }));
        if (args.captureBytes) {
          sourceFiles.push(Object.freeze({
            path: normalized,
            bytes,
            executable: (Number(entry.stats.mode) & 0o111) !== 0,
          }));
        }
      }
    }
    for (const observation of observations.reverse()) {
      await this.#assertDirectoryUnchanged(observation, args.signal);
    }
    const orderedEntries = Object.freeze(entries.sort((left, right) => compareText(left.path, right.path)));
    const orderedFiles = Object.freeze(files.sort((left, right) => compareText(left.path, right.path)));
    const head = Object.freeze({
      format: 'omnidraw.widget-managed-tree.v1' as const,
      entries: orderedEntries,
      files: orderedFiles,
      fileCount: orderedFiles.length,
      directoryCount,
      byteSize: totalBytes,
    });
    const capture: TWidgetWorkspaceTreeCapture = Object.freeze({
      ...head,
      rootRelativePath: args.rootRelativePath,
      digestSha256: sha256(fnCanonicalizeWidgetWorkspaceTreeCapture(head)),
    });
    return Object.freeze({
      capture,
      sourceFiles: Object.freeze(sourceFiles.sort((left, right) => compareText(left.path, right.path))),
    });
  }

  async #materializeCapturedTree(
    destinationPath: string,
    captured: TInternalTreeCapture,
    signal: AbortSignal,
  ): Promise<void> {
    const directories = captured.capture.entries
      .filter((entry) => entry.kind === 'directory')
      .sort((left, right) => left.path.split('/').length - right.path.split('/').length
        || compareText(left.path, right.path));
    for (const directory of directories) {
      assertNotAborted(signal);
      await mkdir(join(destinationPath, ...directory.path.split('/')), {
        recursive: false,
        mode: WIDGET_WORKSPACE_DIRECTORY_MODE,
      });
    }
    for (const file of captured.sourceFiles) {
      assertNotAborted(signal);
      const path = join(destinationPath, ...file.path.split('/'));
      const handle = await open(
        path,
        // O_RDWR preserves exclusive/no-follow creation and lets Bun expose
        // the descriptor through /dev/fd for canonical-path verification.
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
        file.executable ? WIDGET_WORKSPACE_EXECUTABLE_FILE_MODE : WIDGET_WORKSPACE_FILE_MODE,
      );
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile()
          || await this.#openedCanonicalPath(handle.fd) !== path
        ) {
          throw errorWithCode(
            'Managed output file resolved outside its staged destination.',
            'WIDGET_WORKSPACE_FILE_CHANGED',
          );
        }
        await handle.writeFile(file.bytes);
        await handle.sync();
        const written = await handle.stat();
        const writtenPath = await lstat(path).catch(() => null);
        if (
          writtenPath === null
          || !written.isFile()
          || !sameIdentity(written, writtenPath)
          || await this.#openedCanonicalPath(handle.fd) !== path
        ) {
          throw errorWithCode(
            'Managed output file identity changed while it was written.',
            'WIDGET_WORKSPACE_FILE_CHANGED',
          );
        }
      } finally {
        await handle.close();
      }
    }
    const directoriesToSync = [
      destinationPath,
      ...directories.map((directory) => join(destinationPath, ...directory.path.split('/'))),
    ].sort((left, right) => right.split('/').length - left.split('/').length);
    for (const path of directoriesToSync) await this.#syncDirectory(path);
  }

  async #readExactFile(
    path: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    assertNotAborted(signal);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw errorWithCode('Widget tree entry is not a regular file.', 'WIDGET_WORKSPACE_LINK_NOT_ALLOWED');
    }
    if (before.size > maximumBytes) {
      throw errorWithCode('Widget tree file exceeds its byte limit.', 'WIDGET_WORKSPACE_FILE_SIZE_LIMIT');
    }
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat();
      if (!sameIdentity(before, opened) || await this.#openedCanonicalPath(handle.fd) !== path) {
        throw errorWithCode('Widget file identity changed before reading.', 'WIDGET_WORKSPACE_FILE_CHANGED');
      }
      const bytes = Buffer.allocUnsafe(before.size);
      let offset = 0;
      while (offset < before.size) {
        assertNotAborted(signal);
        const read = await handle.read(bytes, offset, before.size - offset, offset);
        if (read.bytesRead === 0) {
          throw errorWithCode('Widget file changed while reading.', 'WIDGET_WORKSPACE_FILE_CHANGED');
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
      ) throw errorWithCode('Widget file changed while reading.', 'WIDGET_WORKSPACE_FILE_CHANGED');
      return new Uint8Array(bytes);
    } finally {
      await handle.close();
    }
  }

  async #observeDirectory(
    path: string,
    displayPath: string,
    signal: AbortSignal | undefined,
  ): Promise<TDirectoryObservation> {
    assertNotAborted(signal);
    const before = await lstat(path);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw errorWithCode(
        `Widget directory '${displayPath || '.'}' is not a real directory.`,
        'WIDGET_WORKSPACE_LINK_NOT_ALLOWED',
      );
    }
    const directory = await opendir(path);
    const names: string[] = [];
    try {
      while (true) {
        assertNotAborted(signal);
        const entry = await directory.read();
        if (entry === null) break;
        names.push(entry.name);
        if (names.length > this.#limits.maxEntriesPerDirectory) {
          throw errorWithCode(
            `Widget directory '${displayPath || '.'}' exceeds its entry limit.`,
            'WIDGET_WORKSPACE_DIRECTORY_ENTRY_LIMIT',
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
    const entries = [] as Array<{
      name: string;
      kind: TWidgetImportTreeEntry['kind'];
      stats: TFileStats;
    }>;
    for (const name of names.sort(compareText)) {
      const stats = await lstat(join(path, name));
      entries.push({ name, kind: entryKind(stats), stats });
    }
    const after = await lstat(path);
    if (!sameIdentity(before, after)) {
      throw errorWithCode('Widget directory changed during observation.', 'WIDGET_WORKSPACE_DIRECTORY_CHANGED');
    }
    return Object.freeze({
      path,
      token: JSON.stringify({
        directory: identity(after),
        entries: entries.map((entry) => ({
          name: entry.name,
          kind: entry.kind,
          identity: identity(entry.stats),
        })),
      }),
      entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    });
  }

  async #assertDirectoryUnchanged(
    observation: TDirectoryObservation,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const next = await this.#observeDirectory(observation.path, observation.path, signal);
    if (next.token !== observation.token) {
      throw errorWithCode('Widget directory changed during capture.', 'WIDGET_WORKSPACE_DIRECTORY_CHANGED');
    }
  }

  async #syncTree(
    rootPath: string,
    capture: TWidgetWorkspaceTreeCapture,
    signal: AbortSignal,
  ): Promise<void> {
    for (const file of capture.files) {
      assertNotAborted(signal);
      const path = join(rootPath, ...file.path.split('/'));
      const bytes = await this.#readExactFile(path, this.#limits.maxFileBytes, signal);
      if (bytes.byteLength !== file.byteSize || sha256(bytes) !== file.sha256) {
        throw errorWithCode('Widget tree changed before sync.', 'WIDGET_WORKSPACE_TREE_DIGEST_MISMATCH');
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const directories = [
      rootPath,
      ...capture.entries
        .filter((entry) => entry.kind === 'directory')
        .map((entry) => join(rootPath, ...entry.path.split('/'))),
    ].sort((left, right) => right.split('/').length - left.split('/').length);
    for (const path of directories) await this.#syncDirectory(path);
  }

  async #syncDirectory(path: string): Promise<void> {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (await this.#openedCanonicalPath(handle.fd) !== path) {
        throw errorWithCode('Widget directory identity changed before sync.', 'WIDGET_WORKSPACE_DIRECTORY_CHANGED');
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #removeTree(rootPath: string): Promise<void> {
    const stack: Array<Readonly<{ path: string; depth: number; visited: boolean }>> = [{
      path: rootPath,
      depth: 0,
      visited: false,
    }];
    let entries = 0;
    let directories = 0;
    while (stack.length > 0) {
      const current = stack.pop()!;
      const value = await lstat(current.path).catch((error) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (value === null) continue;
      if (current.depth > this.#limits.maxDepth) {
        throw errorWithCode(
          'Temporary widget cleanup exceeds its depth limit.',
          'WIDGET_WORKSPACE_CLEANUP_LIMIT',
        );
      }
      if (current.visited) {
        if (!value.isDirectory() || value.isSymbolicLink()) {
          throw errorWithCode(
            'Temporary widget directory changed during cleanup.',
            'WIDGET_WORKSPACE_DIRECTORY_CHANGED',
          );
        }
        await rmdir(current.path);
        continue;
      }
      if (current.depth > 0) {
        entries += 1;
        if (entries > this.#limits.maxEntries) {
          throw errorWithCode(
            'Temporary widget cleanup exceeds its global entry limit.',
            'WIDGET_WORKSPACE_CLEANUP_LIMIT',
          );
        }
      }
      if (!value.isDirectory() || value.isSymbolicLink()) {
        await unlink(current.path);
        continue;
      }
      directories += 1;
      if (directories > this.#limits.maxDirectories) {
        throw errorWithCode(
          'Temporary widget cleanup exceeds its directory limit.',
          'WIDGET_WORKSPACE_CLEANUP_LIMIT',
        );
      }
      const observation = await this.#observeDirectory(current.path, current.path, undefined);
      stack.push({ ...current, visited: true });
      for (const entry of [...observation.entries].reverse()) {
        stack.push({
          path: join(current.path, entry.name),
          depth: current.depth + 1,
          visited: false,
        });
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
      'The host cannot verify an opened widget path.',
      'WIDGET_WORKSPACE_IDENTITY_UNAVAILABLE',
    );
  }
}
