import { createHash, randomUUID } from 'node:crypto';
import { relative, sep } from 'node:path';
import {
  NodeWidgetFilesystemWorkspace,
  NodeWidgetPublicationFilesystem,
  WIDGET_CATALOG_CONTRACTS,
  fxScanWidgetCatalog,
  fxScanWidgetPublishedFolder,
  fnApplyWidgetDraftConfig,
  txAcquireWidgetRootWriterLease,
  txPublishAtomicPublication,
  txPublishWidgetMetadata,
  type NodeWidgetCatalogFilesystem,
  type NodeWidgetCatalogHash,
  type PublicationReadWriteBarrier,
  type TPublicationPortal,
  type TWidgetCatalogCapsuleInspectionPortal,
  type TWidgetCatalogScanPortal,
  type TWidgetCatalogSnapshot,
  type TWidgetDraftConfig,
  type TWidgetFilesystemCatalogMutationResult,
  type TWidgetFilesystemFileEntry,
  type TWidgetFilesystemFilePreview,
  type TWidgetFilesystemManagementCapability,
  type WidgetFilesystemBuildService,
} from '@omnidraw/service-agent';
import {
  ZWidgetManifestV4,
  fnNormalizeWidgetFilesystemRelativePath,
  fnWidgetExecutableManifestDigest,
} from '@omnidraw/widget-contract/filesystem';

const FILE_PREVIEW_MAX_BYTES = 256 * 1_024;

type TCatalogAuthority = Readonly<{
  current(): TWidgetCatalogSnapshot;
  refresh(): Promise<TWidgetCatalogSnapshot>;
}>;

type TConfig = Readonly<{
  widgetsRoot: string;
  catalog: TCatalogAuthority;
  barrier: PublicationReadWriteBarrier;
  filesystem: NodeWidgetCatalogFilesystem;
  hash: NodeWidgetCatalogHash;
  capsule: TWidgetCatalogCapsuleInspectionPortal;
  builder: WidgetFilesystemBuildService;
  createOperationToken?: () => string;
}>;

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function immutableResult(
  widgetKey: string,
  snapshot: TWidgetCatalogSnapshot,
): TWidgetFilesystemCatalogMutationResult {
  return Object.freeze({
    widgetKey,
    generation: snapshot.generation,
    catalogDigestSha256: snapshot.digestSha256,
    snapshot,
  });
}

function relativeWidgetPath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join('/');
  const normalized = fnNormalizeWidgetFilesystemRelativePath(value);
  if (normalized === null || normalized !== value) {
    throw errorWithCode('Publication validation path escaped the widget root.', 'UNSAFE_PUBLICATION_PATH');
  }
  return normalized;
}

function previewText(bytes: Uint8Array): Readonly<{ binary: boolean; text: string | null }> {
  if (bytes.some((byte) => byte === 0 || (byte < 9 || (byte > 13 && byte < 32)))) {
    return Object.freeze({ binary: true, text: null });
  }
  try {
    return Object.freeze({
      binary: false,
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    });
  } catch {
    return Object.freeze({ binary: true, text: null });
  }
}

/**
 * Direct filesystem management edge used by the widget transport. It shares
 * the runtime catalog's read/write barrier and never calls the removed widget
 * database services.
 */
export class WidgetFilesystemManagementService
implements TWidgetFilesystemManagementCapability {
  readonly #config: TConfig;
  readonly #workspace: Promise<NodeWidgetFilesystemWorkspace>;
  readonly #widgetsRoot: Promise<string>;
  readonly #root: ReturnType<NodeWidgetCatalogFilesystem['pinRoot']>;
  readonly #scanPortal: TWidgetCatalogScanPortal;
  readonly #publication: Promise<TPublicationPortal>;
  readonly #createOperationToken: () => string;
  #closePromise: Promise<void> | null = null;

  constructor(config: TConfig) {
    this.#config = config;
    this.#createOperationToken = config.createOperationToken ?? randomUUID;
    this.#workspace = NodeWidgetFilesystemWorkspace.open({ rootPath: config.widgetsRoot });
    this.#widgetsRoot = this.#workspace.then((workspace) => workspace.rootPath);
    this.#root = config.filesystem.pinRoot({ requestedPath: config.widgetsRoot });
    this.#scanPortal = Object.freeze({
      filesystem: config.filesystem,
      hash: config.hash,
      capsule: config.capsule,
      contracts: WIDGET_CATALOG_CONTRACTS,
    });
    this.#publication = this.#createPublicationPortal();
  }

  async saveDraftConfig(args: Readonly<{
    widgetKey: string;
    expectedManifestDigestSha256: string;
    config: TWidgetDraftConfig;
    signal?: AbortSignal;
  }>): Promise<TWidgetFilesystemCatalogMutationResult> {
    const snapshot = await this.#config.catalog.refresh();
    const draft = snapshot.entries[args.widgetKey]?.draft;
    if (draft?.health !== 'healthy' || draft.manifest === null) {
      throw errorWithCode('Widget draft is missing or unhealthy.', 'WIDGET_DRAFT_MISSING');
    }
    if (draft.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
      throw errorWithCode(
        'Widget draft changed after the Config form was loaded.',
        'WIDGET_MANIFEST_CONFLICT',
      );
    }
    const nextManifest = ZWidgetManifestV4.parse(
      fnApplyWidgetDraftConfig(draft.manifest, args.config),
    );
    const token = this.#operationToken();
    const portal = await this.#publication;
    const lease = await txAcquireWidgetRootWriterLease(portal, {
      widgetRoot: await this.#widgetsRoot,
      operationToken: token,
      ownerToken: `save_${token}`,
      purpose: 'draft',
    });
    try {
      await this.#config.barrier.withWrite(async () => {
        const workspace = await this.#workspace;
        await workspace.saveDraftManifest({
          slug: args.widgetKey,
          expectedManifestDigestSha256: args.expectedManifestDigestSha256,
          manifest: nextManifest,
          operationToken: token,
          signal: args.signal ?? new AbortController().signal,
        });
      });
    } finally {
      await lease.release();
    }
    return immutableResult(args.widgetKey, await this.#config.catalog.refresh());
  }

  async publishMetadata(args: Readonly<{
    widgetKey: string;
    expectedManifestDigestSha256: string;
    expectedCatalogDigestSha256: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetFilesystemCatalogMutationResult> {
    const snapshot = await this.#refreshAndFence(args.expectedCatalogDigestSha256);
    const entry = snapshot.entries[args.widgetKey];
    const draft = entry?.draft;
    const published = entry?.published;
    if (
      draft?.health !== 'healthy'
      || draft.manifest === null
      || published?.health !== 'healthy'
      || published.release === null
    ) throw errorWithCode(
      'Metadata publication requires healthy draft and published forms.',
      'WIDGET_METADATA_UNAVAILABLE',
    );
    if (draft.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
      throw errorWithCode('Widget draft manifest changed.', 'WIDGET_MANIFEST_CONFLICT');
    }
    const executableDigest = fnWidgetExecutableManifestDigest({
      manifest: draft.manifest,
      digestSha256: sha256,
    });
    if (executableDigest !== published.release.executableManifestDigestSha256) {
      throw errorWithCode(
        'Executable Config changed; use Build and Publish.',
        'WIDGET_BUILD_REQUIRED',
      );
    }
    const workspace = await this.#workspace;
    const capture = await workspace.captureDraftBuildInput({
      slug: args.widgetKey,
      signal: args.signal ?? new AbortController().signal,
    });
    if (capture.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
      throw errorWithCode('Widget draft manifest changed.', 'WIDGET_MANIFEST_CONFLICT');
    }
    if (capture.fileSetDigestSha256 !== draft.treeDigestSha256) {
      throw errorWithCode('Widget draft source changed.', 'WIDGET_CATALOG_CHANGED');
    }
    const token = this.#operationToken();
    await txPublishWidgetMetadata(await this.#publication, {
      widgetRoot: await this.#widgetsRoot,
      slug: args.widgetKey,
      operationToken: token,
      lockOwnerToken: `metadata_${token}`,
      expectedFence: {
        draftDigestSha256: capture.treeDigestSha256,
        catalogDigestSha256: snapshot.digestSha256,
      },
      expectedExecutableManifestDigestSha256:
        published.release.executableManifestDigestSha256,
      newExecutableManifestDigestSha256: executableDigest,
      manifestJson: capture.canonicalManifestJson,
      barrier: this.#config.barrier,
    });
    return immutableResult(args.widgetKey, await this.#config.catalog.refresh());
  }

  async buildAndPublish(args: Readonly<{
    widgetKey: string;
    expectedManifestDigestSha256: string;
    expectedCatalogDigestSha256: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetFilesystemCatalogMutationResult> {
    const snapshot = await this.#refreshAndFence(args.expectedCatalogDigestSha256);
    const draft = snapshot.entries[args.widgetKey]?.draft;
    if (draft?.health !== 'healthy' || draft.manifest === null) {
      throw errorWithCode('Widget draft is missing or unhealthy.', 'WIDGET_DRAFT_MISSING');
    }
    if (draft.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
      throw errorWithCode('Widget draft manifest changed.', 'WIDGET_MANIFEST_CONFLICT');
    }
    const workspace = await this.#workspace;
    const signal = args.signal ?? new AbortController().signal;
    const capture = await workspace.captureDraftBuildInput({
      slug: args.widgetKey,
      signal,
    });
    if (capture.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
      throw errorWithCode('Widget draft manifest changed.', 'WIDGET_MANIFEST_CONFLICT');
    }
    if (capture.fileSetDigestSha256 !== draft.treeDigestSha256) {
      throw errorWithCode('Widget draft source changed.', 'WIDGET_CATALOG_CHANGED');
    }
    const construction = await this.#config.builder.construct({
      manifest: capture.manifest,
      files: capture.files,
      workspaceKey: `filesystem_${args.widgetKey}`,
      signal,
    });
    const prepared = await this.#config.builder.preparePublication({
      manifest: capture.manifest,
      construction,
    });
    const token = this.#operationToken();
    await txPublishAtomicPublication(await this.#publication, {
      widgetRoot: await this.#widgetsRoot,
      slug: args.widgetKey,
      operationToken: token,
      lockOwnerToken: `publish_${token}`,
      expectedFence: {
        draftDigestSha256: capture.treeDigestSha256,
        catalogDigestSha256: snapshot.digestSha256,
      },
      manifestJson: prepared.manifestJson,
      files: prepared.files.map((file) => Object.freeze({
        path: file.path,
        bytes: new Uint8Array(file.bytes),
      })),
      releaseJson: prepared.release.canonicalJson,
      barrier: this.#config.barrier,
    });
    return immutableResult(args.widgetKey, await this.#config.catalog.refresh());
  }

  listFiles(args: Readonly<{
    widgetKey: string;
    source: 'draft' | 'published';
  }>): readonly TWidgetFilesystemFileEntry[] {
    const form = this.#form(args.widgetKey, args.source);
    const directories = new Set<string>();
    for (const file of form.files) {
      const segments = file.path.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        directories.add(segments.slice(0, index).join('/'));
      }
    }
    return Object.freeze([
      ...[...directories].map((path) => Object.freeze({
        path,
        kind: 'directory' as const,
        byteSize: 0,
      })),
      ...form.files.map((file) => Object.freeze({
        path: file.path,
        kind: 'file' as const,
        byteSize: file.byteSize,
      })),
    ].sort((left, right) => left.path.localeCompare(right.path)
      || (left.kind === 'directory' ? -1 : 1)));
  }

  async readFile(args: Readonly<{
    widgetKey: string;
    source: 'draft' | 'published';
    path: string;
    maximumBytes: number;
  }>): Promise<TWidgetFilesystemFilePreview> {
    const normalized = fnNormalizeWidgetFilesystemRelativePath(args.path);
    if (normalized === null || normalized !== args.path) {
      throw errorWithCode('Widget file path is unsafe.', 'WIDGET_FILE_PATH_INVALID');
    }
    if (
      !Number.isSafeInteger(args.maximumBytes)
      || args.maximumBytes < 1
      || args.maximumBytes > FILE_PREVIEW_MAX_BYTES
    ) throw new TypeError('Widget file preview limit is invalid.');
    const form = this.#form(args.widgetKey, args.source);
    const observed = form.files.find((file) => file.path === normalized);
    if (observed === undefined) {
      throw errorWithCode('Widget file was not found.', 'WIDGET_FILE_MISSING');
    }
    if (observed.byteSize > args.maximumBytes) {
      return Object.freeze({
        path: normalized,
        byteSize: observed.byteSize,
        binary: false,
        truncated: true,
        text: null,
      });
    }
    const root = await this.#root;
    const bytes = await this.#config.filesystem.readFile(root, {
      relativePath: `${form.relativePath}/${normalized}`,
      maxBytes: args.maximumBytes,
    });
    if (bytes.byteLength !== observed.byteSize || sha256(bytes) !== observed.sha256) {
      throw errorWithCode('Widget file changed after catalog scan.', 'WIDGET_CATALOG_CHANGED');
    }
    const decoded = previewText(bytes);
    return Object.freeze({
      path: normalized,
      byteSize: observed.byteSize,
      binary: decoded.binary,
      truncated: false,
      text: decoded.text,
    });
  }

  close(): Promise<void> {
    if (this.#closePromise === null) {
      this.#closePromise = this.#config.builder.close();
    }
    return this.#closePromise;
  }

  #form(widgetKey: string, source: 'draft' | 'published') {
    const entry = this.#config.catalog.current().entries[widgetKey];
    const form = source === 'draft' ? entry?.draft : entry?.published;
    if (form === null || form === undefined) {
      throw errorWithCode('Widget catalog form was not found.', 'WIDGET_MISSING');
    }
    return form;
  }

  async #refreshAndFence(expectedCatalogDigestSha256: string): Promise<TWidgetCatalogSnapshot> {
    if (!/^[0-9a-f]{64}$/.test(expectedCatalogDigestSha256)) {
      throw new TypeError('Expected catalog digest must be lowercase SHA-256.');
    }
    const snapshot = await this.#config.catalog.refresh();
    if (snapshot.digestSha256 !== expectedCatalogDigestSha256) {
      throw errorWithCode(
        'Widget catalog changed after the action was selected.',
        'WIDGET_CATALOG_CHANGED',
      );
    }
    return snapshot;
  }

  #operationToken(): string {
    const token = this.#createOperationToken();
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(token)) {
      throw new TypeError('Widget filesystem operation token is invalid.');
    }
    return token;
  }

  async #scanCurrent(): Promise<TWidgetCatalogSnapshot> {
    return fxScanWidgetCatalog(this.#scanPortal, {
      root: await this.#root,
      generation: 1,
    });
  }

  async #validateFolder(slug: string, path: string) {
    const scanned = await fxScanWidgetPublishedFolder(this.#scanPortal, {
      root: await this.#root,
      slug,
      relativePath: relativeWidgetPath(await this.#widgetsRoot, path),
    });
    return scanned.health === 'healthy'
      ? Object.freeze({ valid: true as const })
      : Object.freeze({
          valid: false as const,
          reason: scanned.issues.map((issue) => issue.message).join(' ') || 'Publication is unhealthy.',
        });
  }

  async #createPublicationPortal(): Promise<TPublicationPortal> {
    return NodeWidgetPublicationFilesystem.create({
      widgetRoot: this.#config.widgetsRoot,
      hooks: {
        observeFence: async ({ slug }) => {
          const workspace = await this.#workspace;
          const [draft, snapshot] = await Promise.all([
            workspace.captureDraftBuildInput({
              slug,
              signal: new AbortController().signal,
            }),
            this.#scanCurrent(),
          ]);
          return Object.freeze({
            draftDigestSha256: draft.treeDigestSha256,
            catalogDigestSha256: snapshot.digestSha256,
          });
        },
        validateReopenedPublication: ({ slug, path }) => this.#validateFolder(slug, path),
        validateMetadataCandidate: async ({
          slug,
          currentPath,
          manifestJson,
          expectedExecutableManifestDigestSha256,
        }) => {
          try {
            const manifest = ZWidgetManifestV4.parse(JSON.parse(manifestJson));
            const executableDigest = fnWidgetExecutableManifestDigest({
              manifest,
              digestSha256: sha256,
            });
            if (
              manifest.slug !== slug
              || executableDigest !== expectedExecutableManifestDigestSha256
            ) return Object.freeze({ valid: false as const, reason: 'Metadata executable identity changed.' });
            const current = await fxScanWidgetPublishedFolder(this.#scanPortal, {
              root: await this.#root,
              slug,
              relativePath: relativeWidgetPath(await this.#widgetsRoot, currentPath),
            });
            if (
              current.health !== 'healthy'
              || current.release?.executableManifestDigestSha256
                !== expectedExecutableManifestDigestSha256
            ) return Object.freeze({ valid: false as const, reason: 'Current publication is not reusable.' });
            return Object.freeze({ valid: true as const });
          } catch (error) {
            return Object.freeze({
              valid: false as const,
              reason: error instanceof Error ? error.message : 'Metadata candidate is invalid.',
            });
          }
        },
      },
    });
  }
}

export type { TConfig as TWidgetFilesystemManagementServiceConfig };
