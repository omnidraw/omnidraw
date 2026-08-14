import { createHash } from 'node:crypto';
import { relative, sep } from 'node:path';
import {
  NodeWidgetFilesystemWorkspace,
  NodeWidgetPublicationFilesystem,
  WIDGET_CATALOG_CONTRACTS,
  scanWidgetCatalog,
  scanPublishedWidgetFolder,
  fnApplyWidgetDraftConfig,
  acquireWidgetRootWriterLease,
  clearStalePublicationWriterLock,
  publishAtomicPublication,
  publishWidgetMetadata,
  readPublicationWriterLock,
  type NodeWidgetCatalogFilesystem,
  type NodeWidgetCatalogHash,
  type PublicationReadWriteBarrier,
  type TPublicationEffects,
  type TWidgetCatalogCapsuleInspectionEffects,
  type TWidgetCatalogDraft,
  type TWidgetCatalogPublished,
  type TWidgetCatalogScanEffects,
  type TWidgetCatalogSnapshot,
  type TWidgetDeletionCleanupCapability,
  type TWidgetDeletionCleanupObservation,
  type TWidgetDeletionPlan,
  type TWidgetDeletionResult,
  type TWidgetDeletionSource,
  type TWidgetDraftConfig,
  type TWidgetFilesystemCatalogMutationResult,
  type TWidgetFilesystemFileEntry,
  type TWidgetFilesystemFilePreview,
  type TWidgetFilesystemManagementCapability,
  type TWidgetFilesystemConstruction,
  type WidgetFilesystemBuildService,
  type TWidgetWorkspaceDraftBuildCapture,
} from '#backend/shell/agent';
import {
  ZWidgetManifestV1,
  fnNormalizeWidgetManifestV1,
  fnNormalizeWidgetFilesystemRelativePath,
  fnWidgetExecutableManifestDigest,
} from '@omnidraw/sdk/contract';
import {
  WidgetDeletionJournalStore,
  type TWidgetDeletionJournal,
} from './WidgetDeletionJournalStore';

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
  capsule: TWidgetCatalogCapsuleInspectionEffects;
  builder: WidgetFilesystemBuildService;
  acceptedBuild: Readonly<{
    requireCurrent(
      widgetKey: string,
      signal?: AbortSignal,
    ): Promise<Readonly<{
      capture: TWidgetWorkspaceDraftBuildCapture;
      construction: TWidgetFilesystemConstruction;
    }>>;
  }>;
  validateManifestResources(manifest: import('@omnidraw/sdk/contract').TWidgetManifestV1): Promise<void>;
  createOperationToken: () => string;
  deletion?: Readonly<{
    cleanup: TWidgetDeletionCleanupCapability;
    begin(widgetKey: string): void;
    end(widgetKey: string): void;
  }>;
}>;

type TDeletionForm = TWidgetCatalogDraft | TWidgetCatalogPublished;

type TPendingDeletionPlan = Readonly<{
  public: TWidgetDeletionPlan;
  forms: readonly TDeletionForm[];
  cleanup: TWidgetDeletionCleanupObservation;
}>;

const UNSAFE_DELETION_ISSUES = new Set([
  'layout_case_collision',
  'slug_case_collision',
  'widget_entry_not_directory',
  'unsafe_path',
  'path_case_collision',
  'symlink_not_allowed',
  'special_file_not_allowed',
]);

function errorWithCode(message: string, code: string, cause?: unknown): Error {
  return Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code },
  );
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
  readonly #scanEffects: TWidgetCatalogScanEffects;
  readonly #publication: Promise<TPublicationEffects>;
  readonly #deletionStore: Promise<WidgetDeletionJournalStore>;
  readonly #createOperationToken: () => string;
  readonly #pendingDeletionPlans = new Map<string, TPendingDeletionPlan>();
  #closePromise: Promise<void> | null = null;

  constructor(config: TConfig) {
    this.#config = config;
    this.#createOperationToken = config.createOperationToken;
    this.#workspace = NodeWidgetFilesystemWorkspace.open({ rootPath: config.widgetsRoot });
    this.#widgetsRoot = this.#workspace.then((workspace) => workspace.rootPath);
    this.#root = config.filesystem.pinRoot({ requestedPath: config.widgetsRoot });
    this.#scanEffects = Object.freeze({
      filesystem: config.filesystem,
      hash: config.hash,
      capsule: config.capsule,
      contracts: WIDGET_CATALOG_CONTRACTS,
    });
    this.#publication = this.#createPublicationEffects();
    this.#deletionStore = WidgetDeletionJournalStore.open(config.widgetsRoot);
  }

  async planDeletion(args: Readonly<{
    widgetKey: string;
    source: TWidgetDeletionSource;
  }>): Promise<TWidgetDeletionPlan> {
    const deletion = this.#requireDeletion();
    const snapshot = await this.#config.catalog.refresh();
    const forms = this.#deletionForms(snapshot, args.widgetKey, args.source);
    const deleteDraft = forms.some((form) => form.kind === 'draft');
    const cleanup = this.#normalizeCleanup(await deletion.cleanup.observe({
      widgetKey: args.widgetKey,
      source: args.source,
      deleteDraft,
    }));
    const planToken = this.#operationToken();
    const previewPlacementCount = cleanup.placements.filter((item) => (
      item.type === 'widget-preview'
    )).length;
    const publishedPlacementCount = cleanup.placements.length - previewPlacementCount;
    const plan = Object.freeze({
      planToken,
      widgetKey: args.widgetKey,
      source: args.source,
      catalogDigestSha256: snapshot.digestSha256,
      pairedDraftPresent: args.source === 'published'
        && forms.some((form) => form.kind === 'draft'),
      placementCount: cleanup.placements.length,
      previewPlacementCount,
      publishedPlacementCount,
      chatMountCount: cleanup.mounts.length,
      resourcesPreserved: true as const,
    });
    this.#pendingDeletionPlans.set(planToken, Object.freeze({
      public: plan,
      forms: Object.freeze([...forms]),
      cleanup,
    }));
    while (this.#pendingDeletionPlans.size > 128) {
      const oldest = this.#pendingDeletionPlans.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#pendingDeletionPlans.delete(oldest);
    }
    return plan;
  }

  async commitDeletion(args: Readonly<{
    planToken: string;
    operationId: string;
    signal?: AbortSignal;
  }>): Promise<TWidgetDeletionResult> {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(args.planToken)) {
      throw errorWithCode('Widget deletion plan token is invalid.', 'WIDGET_DELETION_STALE_PLAN');
    }
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(args.operationId)) {
      throw new TypeError('Widget deletion operation ID is invalid.');
    }
    const store = await this.#deletionStore;
    let pending = this.#pendingDeletionPlans.get(args.planToken) ?? null;
    let journal = (await store.list()).find((candidate) => (
      candidate.plan.planToken === args.planToken
    )) ?? null;
    if (journal?.phase === 'committed') {
      if (journal.operationId !== args.operationId || journal.result === null) {
        throw errorWithCode('Widget deletion operation identity changed.', 'WIDGET_DELETION_STALE_PLAN');
      }
      return journal.result;
    }
    if (journal !== null && journal.operationId !== args.operationId) {
      throw errorWithCode('Widget deletion operation identity changed.', 'WIDGET_DELETION_STALE_PLAN');
    }
    if (pending === null && journal === null) {
      throw errorWithCode(
        'Widget deletion plan is missing or expired; review the current source again.',
        'WIDGET_DELETION_STALE_PLAN',
      );
    }
    if (args.signal?.aborted) throw errorWithCode('Widget deletion was cancelled.', 'ABORT_ERR');

    const plan = pending?.public ?? journal!.plan;
    const effects = await this.#publication;
    const lease = await acquireWidgetRootWriterLease(effects, {
      widgetRoot: await this.#widgetsRoot,
      operationToken: args.operationId,
      ownerToken: args.operationId,
      purpose: 'delete',
    });
    const deletion = this.#requireDeletion();
    deletion.begin(plan.widgetKey);
    let operationError: unknown;
    try {
      if (journal === null) {
        pending = pending!;
        await this.#assertPendingPlanCurrent(pending);
        journal = Object.freeze({
          format: 'omnidraw.widget-deletion.v1' as const,
          plan,
          operationId: args.operationId,
          phase: 'prepared' as const,
          forms: Object.freeze(pending.forms.map((form) => Object.freeze({
            source: form.kind,
            relativePath: form.relativePath,
            treeDigestSha256: form.treeDigestSha256,
            trashName: `${plan.widgetKey}.${plan.planToken}.${form.kind}.deleted`,
          }))),
          placements: pending.cleanup.placements,
          mounts: pending.cleanup.mounts,
          completedPlacementKeys: Object.freeze([]),
          completedMountPaths: Object.freeze([]),
          result: null,
        });
        await store.create(journal);
      }
      const result = await this.#resumeDeletion(journal, args.signal);
      this.#pendingDeletionPlans.delete(args.planToken);
      return result;
    } catch (error) {
      operationError = error;
      if (journal !== null && this.#errorCode(error) === 'WIDGET_DELETION_STALE_PLAN') {
        const sourceMoved = (await Promise.all(
          journal.forms.map((form) => store.trashExists(form.trashName)),
        )).some(Boolean);
        if (!sourceMoved) {
          await store.discardPrepared(journal);
          this.#pendingDeletionPlans.delete(args.planToken);
          throw error;
        }
      }
      if (journal !== null) {
        throw errorWithCode(
          'Widget deletion is durably pending recovery; retry the same confirmed operation.',
          'WIDGET_DELETION_RECOVERY_PENDING',
          error,
        );
      }
      if (this.#errorCode(error) === 'WIDGET_DELETION_STALE_PLAN') {
        this.#pendingDeletionPlans.delete(args.planToken);
      }
      throw error;
    } finally {
      deletion.end(plan.widgetKey);
      try {
        await lease.release();
      } catch (releaseError) {
        if (operationError === undefined) throw releaseError;
      }
    }
  }

  async recoverDeletions(): Promise<void> {
    const store = await this.#deletionStore;
    const journals = await store.list();
    const effects = await this.#publication;
    const widgetsRoot = await this.#widgetsRoot;
    const writerLock = await readPublicationWriterLock(effects, { widgetRoot: widgetsRoot });
    if (writerLock !== null && writerLock.record.purpose === 'delete') {
      const matchingJournal = journals.find((journal) => (
        writerLock.record.ownerToken === journal.operationId
      ));
      if (matchingJournal === undefined) {
        throw errorWithCode(
          'A deletion writer lock has no matching durable journal.',
          'WIDGET_DELETION_RECOVERY_PENDING',
        );
      }
      await clearStalePublicationWriterLock(effects, {
        widgetRoot: widgetsRoot,
        expectedSerializedLock: writerLock.serialized,
        operationToken: matchingJournal.operationId,
        confirmation: 'explicitly-confirmed-no-live-writer',
      });
    }
    for (const journal of journals) {
      if (journal.phase === 'committed') {
        for (const form of journal.forms) {
          await store.purgeTrash(form.trashName);
        }
        continue;
      }
      await this.commitDeletion({
        planToken: journal.plan.planToken,
        operationId: journal.operationId,
      });
    }
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
    const nextManifest = ZWidgetManifestV1.parse(
      fnApplyWidgetDraftConfig(draft.manifest, args.config),
    );
    const token = this.#operationToken();
    const effects = await this.#publication;
    const lease = await acquireWidgetRootWriterLease(effects, {
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
    if (
      published.manifest === null
      || JSON.stringify(fnNormalizeWidgetManifestV1(draft.manifest).resources ?? [])
        !== JSON.stringify(fnNormalizeWidgetManifestV1(published.manifest).resources ?? [])
    ) {
      throw errorWithCode(
        'Resource bindings changed; use Build and Publish.',
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
    await publishWidgetMetadata(await this.#publication, {
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
    const signal = args.signal ?? new AbortController().signal;
    const accepted = await this.#config.acceptedBuild.requireCurrent(args.widgetKey, signal);
    const capture = accepted.capture;
    if (capture.manifestDigestSha256 !== args.expectedManifestDigestSha256) {
      throw errorWithCode('Widget draft manifest changed.', 'WIDGET_MANIFEST_CONFLICT');
    }
    if (capture.fileSetDigestSha256 !== draft.treeDigestSha256) {
      throw errorWithCode('Widget draft source changed.', 'WIDGET_CATALOG_CHANGED');
    }
    await this.#config.validateManifestResources(capture.manifest);
    const prepared = await this.#config.builder.preparePublication({
      manifest: capture.manifest,
      construction: accepted.construction,
    });
    const token = this.#operationToken();
    await publishAtomicPublication(await this.#publication, {
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

  async #resumeDeletion(
    initial: TWidgetDeletionJournal,
    signal?: AbortSignal,
  ): Promise<TWidgetDeletionResult> {
    const store = await this.#deletionStore;
    const deletion = this.#requireDeletion();
    let journal = initial;
    if (journal.phase === 'committed') return journal.result!;

    await this.#config.barrier.withWrite(async () => {
      if (journal.phase === 'prepared') {
        const observedCleanup = this.#normalizeCleanup(await deletion.cleanup.observe({
          widgetKey: journal.plan.widgetKey,
          source: journal.plan.source,
          deleteDraft: journal.forms.some((form) => form.source === 'draft'),
        }));
        if (JSON.stringify(observedCleanup) !== JSON.stringify({
          placements: journal.placements,
          mounts: journal.mounts,
        })) throw errorWithCode(
          'Widget placements or chat mounts changed after deletion was confirmed.',
          'WIDGET_DELETION_STALE_PLAN',
        );
        const snapshot = await this.#scanCurrent();
        for (const expected of journal.forms) {
          if (await store.trashExists(expected.trashName)) continue;
          const entry = snapshot.entries[journal.plan.widgetKey];
          const current = expected.source === 'draft' ? entry?.draft : entry?.published;
          if (
            current === null
            || current === undefined
            || current.relativePath !== expected.relativePath
            || current.treeDigestSha256 !== expected.treeDigestSha256
          ) throw errorWithCode(
            'Widget source changed after deletion was confirmed.',
            'WIDGET_DELETION_STALE_PLAN',
          );
          this.#assertDeletionFormSafe(current, journal.plan.widgetKey);
        }
        for (const form of journal.forms) {
          if (signal?.aborted) throw errorWithCode('Widget deletion was cancelled.', 'ABORT_ERR');
          await store.moveSource({
            widgetKey: journal.plan.widgetKey,
            planToken: journal.plan.planToken,
            source: form.source,
            relativePath: form.relativePath,
            trashName: form.trashName,
          });
        }
        journal = Object.freeze({ ...journal, phase: 'sources-moved' as const });
        await store.update(journal);
      }

      if (journal.forms.some((form) => form.source === 'draft')) {
        await deletion.cleanup.retireDraft(journal.plan.widgetKey);
      }
      if (journal.phase !== 'cleanup') {
        journal = Object.freeze({ ...journal, phase: 'cleanup' as const });
        await store.update(journal);
      }

      const completedPlacements = new Set(journal.completedPlacementKeys);
      for (const placement of journal.placements) {
        if (signal?.aborted) throw errorWithCode('Widget deletion was cancelled.', 'ABORT_ERR');
        const key = WidgetDeletionJournalStore.placementKey(placement);
        if (completedPlacements.has(key)) continue;
        await deletion.cleanup.removePlacement({
          operationId: journal.operationId,
          widgetKey: journal.plan.widgetKey,
          placement,
        });
        completedPlacements.add(key);
        journal = Object.freeze({
          ...journal,
          completedPlacementKeys: Object.freeze([...completedPlacements].sort()),
        });
        await store.update(journal);
      }

      const completedMounts = new Set(journal.completedMountPaths);
      for (const mount of journal.mounts) {
        if (signal?.aborted) throw errorWithCode('Widget deletion was cancelled.', 'ABORT_ERR');
        if (completedMounts.has(mount.relativePath)) continue;
        await deletion.cleanup.removeMount({
          widgetKey: journal.plan.widgetKey,
          mount,
        });
        completedMounts.add(mount.relativePath);
        journal = Object.freeze({
          ...journal,
          completedMountPaths: Object.freeze([...completedMounts].sort()),
        });
        await store.update(journal);
      }
    });

    // Install one coherent catalog observation only after every planned
    // cross-authority effect has converged and while admission remains fenced.
    const snapshot = await this.#config.catalog.refresh();
    const result = Object.freeze({
      status: 'committed' as const,
      operationId: journal.operationId,
      widgetKey: journal.plan.widgetKey,
      source: journal.plan.source,
      generation: snapshot.generation,
      catalogDigestSha256: snapshot.digestSha256,
      removedPlacementCount: journal.placements.length,
      removedChatMountCount: journal.mounts.length,
      resourcesPreserved: true as const,
    });
    journal = Object.freeze({ ...journal, phase: 'committed' as const, result });
    await store.update(journal);
    for (const form of journal.forms) {
      await store.purgeTrash(form.trashName).catch(() => undefined);
    }
    return result;
  }

  async #assertPendingPlanCurrent(pending: TPendingDeletionPlan): Promise<void> {
    const snapshot = await this.#config.catalog.refresh();
    if (snapshot.digestSha256 !== pending.public.catalogDigestSha256) {
      throw errorWithCode(
        'Widget catalog changed after deletion was reviewed.',
        'WIDGET_DELETION_STALE_PLAN',
      );
    }
    const forms = this.#deletionForms(
      snapshot,
      pending.public.widgetKey,
      pending.public.source,
    );
    if (JSON.stringify(forms.map(this.#formIdentity)) !== JSON.stringify(
      pending.forms.map(this.#formIdentity),
    )) throw errorWithCode(
      'Widget source changed after deletion was reviewed.',
      'WIDGET_DELETION_STALE_PLAN',
    );
    const cleanup = this.#normalizeCleanup(await this.#requireDeletion().cleanup.observe({
      widgetKey: pending.public.widgetKey,
      source: pending.public.source,
      deleteDraft: pending.forms.some((form) => form.kind === 'draft'),
    }));
    if (JSON.stringify(cleanup) !== JSON.stringify(pending.cleanup)) {
      throw errorWithCode(
        'Widget placements or chat mounts changed after deletion was reviewed.',
        'WIDGET_DELETION_STALE_PLAN',
      );
    }
  }

  #deletionForms(
    snapshot: TWidgetCatalogSnapshot,
    widgetKey: string,
    source: TWidgetDeletionSource,
  ): readonly TDeletionForm[] {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(widgetKey)) {
      throw errorWithCode('Widget deletion key is unsafe.', 'WIDGET_DELETION_UNSAFE_PATH');
    }
    const entry = snapshot.entries[widgetKey];
    const selected = source === 'draft' ? entry?.draft : entry?.published;
    if (selected === null || selected === undefined) {
      throw errorWithCode('The exact widget source was not found.', 'WIDGET_DELETION_NOT_FOUND');
    }
    const forms = source === 'draft'
      ? [selected]
      : [selected, ...(entry?.draft === null || entry?.draft === undefined ? [] : [entry.draft])];
    for (const form of forms) this.#assertDeletionFormSafe(form, widgetKey);
    return Object.freeze(forms);
  }

  #assertDeletionFormSafe(form: TDeletionForm, widgetKey: string): void {
    const expected = `${form.kind === 'draft' ? 'drafts' : 'published'}/${widgetKey}`;
    if (
      form.slug !== widgetKey
      || form.relativePath !== expected
      || form.issues.some((issue) => UNSAFE_DELETION_ISSUES.has(issue.code))
    ) throw errorWithCode(
      'Widget source is not a safe direct child of its configured root.',
      'WIDGET_DELETION_UNSAFE_PATH',
    );
  }

  #normalizeCleanup(value: TWidgetDeletionCleanupObservation): TWidgetDeletionCleanupObservation {
    if (value.placements.length > 20_000 || value.mounts.length > 20_000) {
      throw errorWithCode('Widget deletion blast radius exceeds its bounded limit.', 'WIDGET_DELETION_TOO_LARGE');
    }
    const placements = [...value.placements].sort((left, right) => (
      left.canvasId.localeCompare(right.canvasId)
      || left.itemId.localeCompare(right.itemId)
    ));
    const mounts = [...value.mounts].sort((left, right) => (
      left.relativePath.localeCompare(right.relativePath)
    ));
    if (
      new Set(placements.map(WidgetDeletionJournalStore.placementKey)).size !== placements.length
      || new Set(mounts.map((mount) => mount.relativePath)).size !== mounts.length
    ) throw errorWithCode('Widget deletion cleanup identities are ambiguous.', 'WIDGET_DELETION_UNSAFE_PATH');
    return Object.freeze({
      placements: Object.freeze(placements.map((item) => Object.freeze({ ...item }))),
      mounts: Object.freeze(mounts.map((item) => Object.freeze({ ...item }))),
    });
  }

  #formIdentity = (form: TDeletionForm) => Object.freeze({
    kind: form.kind,
    slug: form.slug,
    relativePath: form.relativePath,
    treeDigestSha256: form.treeDigestSha256,
  });

  #requireDeletion(): NonNullable<TConfig['deletion']> {
    if (this.#config.deletion === undefined) {
      throw errorWithCode(
        'Widget deletion authority is unavailable.',
        'WIDGET_MANAGEMENT_UNAVAILABLE',
      );
    }
    return this.#config.deletion;
  }

  #errorCode(error: unknown): string | null {
    return error !== null && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string'
      ? error.code
      : null;
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
    return scanWidgetCatalog(this.#scanEffects, {
      root: await this.#root,
      generation: 1,
    });
  }

  async #validateFolder(slug: string, path: string) {
    const scanned = await scanPublishedWidgetFolder(this.#scanEffects, {
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

  async #createPublicationEffects(): Promise<TPublicationEffects> {
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
            const manifest = ZWidgetManifestV1.parse(JSON.parse(manifestJson));
            const executableDigest = fnWidgetExecutableManifestDigest({
              manifest,
              digestSha256: sha256,
            });
            if (
              manifest.slug !== slug
              || executableDigest !== expectedExecutableManifestDigestSha256
            ) return Object.freeze({ valid: false as const, reason: 'Metadata executable identity changed.' });
            const current = await scanPublishedWidgetFolder(this.#scanEffects, {
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
