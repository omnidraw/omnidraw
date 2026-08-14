import { createHash } from 'node:crypto';
import { constants, watch, type FSWatcher } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type NodeWidgetFilesystemWorkspace,
  type TWidgetFilesystemConstruction,
  type TWidgetFilesystemPortableBuild,
  type TWidgetFilesystemSignedConstruction,
  type TWidgetWorkspaceDraftBuildCapture,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import {
  WIDGET_BUILD_RECEIPT_MAX_BYTES,
  WIDGET_BUILD_RECEIPT_PATH,
  fnCanonicalizeWidgetBuildReceipt,
  fnNormalizeWidgetFilesystemRelativePath,
  fnWidgetBuildReceiptIdentityMatches,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  parseWidgetBuildReceiptJson,
  type TWidgetBuildReceipt,
  type TWidgetBuildReceiptOutput,
} from '@omnidraw/sdk/contract';
import {
  fnWidgetBuildGenerationDiagnostic,
  fnWidgetBuildGenerationPollOrder,
  fnWidgetBuildReceiptOutputsMatch,
  type TWidgetBuildGenerationDiagnostic,
} from './fn.widget-build-generation';

const ACTIVE_POLL_INTERVAL_MS = 750;
const RECENT_DRAFT_RETENTION_MS = 30_000;
const MAX_POLLS_PER_TICK = 16;
const HOST_BUILD_STAGE_PREFIX = 'preview-build-';
const HOST_BUILD_PROJECTION_MARKER = 'projection.json';
const HOST_BUILD_PROJECTION_FORMAT = 'omnidraw.preview-build-projection.v1';
const HOST_BUILD_COMMIT_MARKER = 'commit.json';
const HOST_BUILD_COMMIT_FORMAT = 'omnidraw.preview-build-commit.v1';
const HOST_BUILD_MARKER_MAX_BYTES = 512;

type TMarkerIdentity = Readonly<{
  device: number;
  inode: number;
  byteSize: number;
  modifiedAtMs: number;
  changedAtMs: number;
}>;

export type TAcceptedWidgetBuildGeneration = Readonly<{
  widgetKey: string;
  generation: number;
  receipt: TWidgetBuildReceipt;
  capture: TWidgetWorkspaceDraftBuildCapture;
  construction: TWidgetFilesystemConstruction;
  signed: TWidgetFilesystemSignedConstruction;
  acceptedAtMs: number;
}>;

export type TWidgetBuildGenerationPhase =
  | 'unbuilt'
  | 'build_required'
  | 'building'
  | 'validating'
  | 'ready'
  | 'rejected';

export type TWidgetBuildGenerationView = Readonly<{
  widgetKey: string;
  phase: TWidgetBuildGenerationPhase;
  acceptedGeneration: number | null;
  acceptedBuildIdentity: string | null;
  current: boolean;
  diagnostics: readonly TWidgetBuildGenerationDiagnostic[];
}>;

type TWidgetBuildGenerationEvent = Readonly<{
  widgetKey: string;
  generation: number;
  buildIdentity: string;
}>;

type TCatalogPort = Readonly<{
  refresh(): Promise<unknown>;
  notifyBuildGenerationChanged(widgetKey: string): void;
}>;

type TConfig = Readonly<{
  widgetsRoot: string;
  workspace: Promise<Pick<NodeWidgetFilesystemWorkspace, 'captureDraftBuildInput'>>;
  catalog: TCatalogPort;
  builder: WidgetFilesystemBuildService;
  sdkVersion: string;
  createId: () => string;
  now: () => number;
  scheduleInterval: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  cancelInterval: (timer: ReturnType<typeof setInterval>) => void;
  mutationAdmission?: Readonly<{ assertAllowed(widgetKey: string): void }>;
}>;

type TEntry = {
  widgetKey: string;
  phase: TWidgetBuildGenerationPhase;
  accepted: TAcceptedWidgetBuildGeneration | null;
  diagnostics: readonly TWidgetBuildGenerationDiagnostic[];
  lastMarker: TMarkerIdentity | null;
  activeCount: number;
  recentUntilMs: number;
  watcher: FSWatcher | null;
  observeTail: Promise<void>;
  nextPollAtMs: number;
  recovered: boolean;
};

type TRebuildOperation = {
  readonly controller: AbortController;
  readonly promise: Promise<TAcceptedWidgetBuildGeneration>;
  waiters: number;
  settled: boolean;
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameMarker(left: TMarkerIdentity | null, right: TMarkerIdentity): boolean {
  return left !== null
    && left.device === right.device
    && left.inode === right.inode
    && left.byteSize === right.byteSize
    && left.modifiedAtMs === right.modifiedAtMs
    && left.changedAtMs === right.changedAtMs;
}

function markerIdentity(value: Awaited<ReturnType<typeof lstat>>): TMarkerIdentity {
  return Object.freeze({
    device: Number(value.dev),
    inode: Number(value.ino),
    byteSize: Number(value.size),
    modifiedAtMs: Number(value.mtimeMs),
    changedAtMs: Number(value.ctimeMs),
  });
}

function markerMatches(
  expected: TMarkerIdentity,
  value: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return value.isFile()
    && !value.isSymbolicLink()
    && sameMarker(expected, markerIdentity(value));
}

function generationError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Process-owned authority for host-validated portable build generations.
 * Filesystem events reduce latency; one bounded active-draft poll loop is the
 * correctness fallback. Accepted bytes remain immutable when later edits make
 * the current repository build-required.
 */
export class WidgetBuildGenerationService {
  readonly name = 'widget-build-generation';
  readonly #config: TConfig;
  readonly #workspace: Promise<Pick<NodeWidgetFilesystemWorkspace, 'captureDraftBuildInput'>>;
  readonly #entries = new Map<string, TEntry>();
  readonly #rebuilds = new Map<string, TRebuildOperation>();
  readonly #listeners = new Set<(event: TWidgetBuildGenerationEvent) => void>();
  readonly #now: () => number;
  #generation = 0;
  #pollCursor = 0;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #closed = false;

  constructor(config: TConfig) {
    this.#config = config;
    this.#workspace = config.workspace;
    this.#now = config.now;
  }

  start(): void {
    if (this.#closed || this.#pollTimer !== null) return;
    this.#pollTimer = this.#config.scheduleInterval(() => this.#poll(), ACTIVE_POLL_INTERVAL_MS);
    this.#pollTimer.unref();
  }

  activate(widgetKey: string): () => void {
    const entry = this.#entry(widgetKey);
    entry.activeCount += 1;
    entry.recentUntilMs = this.#now() + RECENT_DRAFT_RETENTION_MS;
    entry.nextPollAtMs = 0;
    this.#ensureWatcher(entry);
    this.#scheduleObserve(entry, false);
    return () => {
      entry.activeCount = Math.max(0, entry.activeCount - 1);
      entry.recentUntilMs = this.#now() + RECENT_DRAFT_RETENTION_MS;
    };
  }

  subscribe(listener: (event: TWidgetBuildGenerationEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async view(widgetKey: string): Promise<TWidgetBuildGenerationView> {
    const entry = this.#entry(widgetKey);
    await this.#observe(entry, false);
    if (entry.accepted === null) return this.#view(entry, false);
    const current = await this.#acceptedIsCurrent(entry.accepted).catch(() => false);
    return this.#view(entry, current);
  }

  accepted(widgetKey: string): TAcceptedWidgetBuildGeneration | null {
    return this.#entries.get(widgetKey)?.accepted ?? null;
  }

  async requireCurrent(
    widgetKey: string,
    signal?: AbortSignal,
  ): Promise<TAcceptedWidgetBuildGeneration> {
    const release = this.activate(widgetKey);
    try {
      if (signal?.aborted) throw generationError('ABORT_ERR', 'Build generation request was cancelled.');
      const entry = this.#entry(widgetKey);
      await this.#observe(entry, false);
      if (entry.accepted === null) {
        throw generationError(
          entry.phase === 'validating' ? 'BUILD_PENDING' : 'BUILD_REQUIRED',
          'The widget has no accepted build for its current files.',
        );
      }
      if (!await this.#acceptedIsCurrent(entry.accepted)) {
        throw generationError('BUILD_REQUIRED', 'Widget source changed — build required.');
      }
      return entry.accepted;
    } finally {
      release();
    }
  }

  /** Reuses an exact current generation or joins/runs the shared host build. */
  async ensureCurrent(
    widgetKey: string,
    signal?: AbortSignal,
  ): Promise<TAcceptedWidgetBuildGeneration> {
    try {
      return await this.requireCurrent(widgetKey, signal);
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error
        ? error.code
        : null;
      if (code !== 'BUILD_REQUIRED' && code !== 'BUILD_PENDING') throw error;
      return this.rebuild(widgetKey, signal);
    }
  }

  async rebuild(widgetKey: string, signal?: AbortSignal): Promise<TAcceptedWidgetBuildGeneration> {
    this.#config.mutationAdmission?.assertAllowed(widgetKey);
    if (signal?.aborted) throw generationError('ABORT_ERR', 'Build generation request was cancelled.');
    const current = this.#rebuilds.get(widgetKey);
    if (current !== undefined) return this.#joinRebuild(current, signal);

    const entry = this.#entry(widgetKey);
    const controller = new AbortController();
    const release = this.activate(widgetKey);
    let operation!: TRebuildOperation;
    const promise = entry.observeTail
      .then(() => this.#runHostBuild(entry, controller.signal))
      .catch((error) => {
        if ((entry.phase as TWidgetBuildGenerationPhase) !== 'ready') entry.phase = 'rejected';
        entry.diagnostics = Object.freeze([fnWidgetBuildGenerationDiagnostic(error)]);
        throw error;
      })
      .finally(() => {
        operation.settled = true;
        if (this.#rebuilds.get(widgetKey) === operation) this.#rebuilds.delete(widgetKey);
        release();
      });
    operation = { controller, promise, waiters: 0, settled: false };
    this.#rebuilds.set(widgetKey, operation);
    entry.observeTail = promise.then(() => undefined, () => undefined);
    return this.#joinRebuild(operation, signal);
  }

  #joinRebuild(
    operation: TRebuildOperation,
    signal?: AbortSignal,
  ): Promise<TAcceptedWidgetBuildGeneration> {
    operation.waiters += 1;
    let completed = false;
    const joined = new Promise<TAcceptedWidgetBuildGeneration>((resolve, reject) => {
      const finish = (): boolean => {
        if (completed) return false;
        completed = true;
        signal?.removeEventListener('abort', cancel);
        return true;
      };
      const cancel = () => {
        if (finish()) reject(generationError('ABORT_ERR', 'Build generation request was cancelled.'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      operation.promise.then(
        (accepted) => {
          if (finish()) resolve(accepted);
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
    return joined.finally(() => {
      operation.waiters = Math.max(0, operation.waiters - 1);
      if (!operation.settled && operation.waiters === 0) {
        operation.controller.abort('all-callers-cancelled');
      }
    });
  }

  async #runHostBuild(
    entry: TEntry,
    signal: AbortSignal,
  ): Promise<TAcceptedWidgetBuildGeneration> {
    if (this.#closed) throw generationError('ABORT_ERR', 'Widget build generation service is stopped.');
    this.#assertActive(signal);
    await this.#recoverHostBuildStages(entry);
    entry.phase = 'building';
    entry.diagnostics = Object.freeze([]);
    const workspace = await this.#workspace;
    const capture = await workspace.captureDraftBuildInput({
      slug: entry.widgetKey,
      signal,
    });
    const built = await this.#config.builder.buildPortable({
      manifest: capture.manifest,
      files: capture.files,
      workspaceKey: `generation_${entry.widgetKey}`,
      signal,
      reportProgress: (phase) => {
        entry.phase = phase === 'validating' ? 'validating' : 'building';
      },
    });
    this.#assertActive(signal);
    entry.phase = 'validating';
    this.#assertPortableBuild(built);
    const signed = await this.#config.builder.sign(built.construction, 'preview');
    this.#assertActive(signal);
    const confirmedCapture = await workspace.captureDraftBuildInput({
      slug: entry.widgetKey,
      signal,
    });
    this.#assertReceiptMatchesCapture(built.receipt, confirmedCapture);
    const projected = await this.#projectPortableBuild(entry, built, signal);
    entry.lastMarker = projected.marker;
    return this.#acceptGeneration(entry, {
      receipt: built.receipt,
      capture: projected.capture,
      construction: built.construction,
      signed,
    });
  }

  #assertPortableBuild(built: TWidgetFilesystemPortableBuild): void {
    if (
      built.receipt.sdkVersion !== this.#config.sdkVersion
      || !fnWidgetBuildReceiptIdentityMatches({
        receipt: built.receipt,
        digestSha256: sha256,
      })
    ) throw generationError(
      'BUILD_RECEIPT_INVALID',
      'Host build returned an invalid receipt identity or SDK version.',
    );
    const outputs = built.distFiles.map((file) => Object.freeze({
      path: file.path,
      byteSize: file.bytes.byteLength,
      sha256: sha256(file.bytes),
    })).sort((left, right) => left.path.localeCompare(right.path));
    if (!fnWidgetBuildReceiptOutputsMatch({
      receipt: built.receipt,
      observedOutputs: outputs,
    })) throw generationError(
      'BUILD_OUTPUT_MISMATCH',
      'Host build output does not match its portable receipt.',
    );
  }

  async #projectPortableBuild(
    entry: TEntry,
    built: TWidgetFilesystemPortableBuild,
    signal: AbortSignal,
  ): Promise<Readonly<{
    marker: TMarkerIdentity;
    capture: TWidgetWorkspaceDraftBuildCapture;
  }>> {
    const operationId = this.#config.createId();
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(operationId)) {
      throw new TypeError('Widget build operation ID is invalid.');
    }
    const stageRoot = join(
      this.#config.widgetsRoot,
      '.staging',
      `${HOST_BUILD_STAGE_PREFIX}${entry.widgetKey}-${operationId}`,
    );
    const stagedDist = join(stageRoot, 'dist');
    await mkdir(stageRoot, { recursive: false, mode: 0o700 });
    let preserveStageForRecovery = false;
    try {
      await mkdir(stagedDist, { recursive: false, mode: 0o700 });
      for (const file of built.distFiles) {
        this.#assertActive(signal);
        if (
          fnNormalizeWidgetFilesystemRelativePath(file.path) !== file.path
          || !file.path.startsWith('dist/')
          || file.path === WIDGET_BUILD_RECEIPT_PATH
        ) {
          throw generationError('BUILD_OUTPUT_INVALID', 'Host build returned an unsafe output path.');
        }
        const destination = join(stageRoot, ...file.path.split('/'));
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 });
        await this.#syncFile(destination);
      }
      const receiptPath = join(stageRoot, ...WIDGET_BUILD_RECEIPT_PATH.split('/'));
      await writeFile(
        receiptPath,
        `${fnCanonicalizeWidgetBuildReceipt(built.receipt)}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      await this.#syncFile(receiptPath);
      await this.#syncDirectory(stagedDist);
      this.#assertActive(signal);

      const liveDist = join(
        this.#config.widgetsRoot,
        'drafts',
        entry.widgetKey,
        'dist',
      );
      const draftRoot = dirname(liveDist);
      const backup = join(stageRoot, 'previous-dist');
      const projectionMarkerPath = join(stageRoot, HOST_BUILD_PROJECTION_MARKER);
      const commitMarkerPath = join(stageRoot, HOST_BUILD_COMMIT_MARKER);
      const existing = await lstat(liveDist).catch((error) => (
        error?.code === 'ENOENT' ? null : Promise.reject(error)
      ));
      let previousMoved = false;
      let projected = false;
      if (existing !== null) {
        if (!existing.isDirectory() || existing.isSymbolicLink()) {
          throw generationError('BUILD_OUTPUT_INVALID', 'Existing widget dist is not a real directory.');
        }
      }
      await writeFile(projectionMarkerPath, `${JSON.stringify({
        format: HOST_BUILD_PROJECTION_FORMAT,
        widgetKey: entry.widgetKey,
        buildIdentity: built.receipt.buildIdentity,
        previousDist: existing !== null,
      })}\n`, { flag: 'wx', mode: 0o600 });
      await this.#syncFile(projectionMarkerPath);
      await this.#syncDirectory(stageRoot);
      if (existing !== null) {
        await rename(liveDist, backup);
        previousMoved = true;
      }
      const rollback = async (): Promise<void> => {
        if (projected) await rm(liveDist, { recursive: true, force: true });
        if (previousMoved) await rename(backup, liveDist);
        await this.#syncDirectory(draftRoot);
      };
      try {
        this.#assertActive(signal);
        await rename(stagedDist, liveDist);
        projected = true;
        // Projection remains reversible until output verification, source
        // recapture, and the durable commit marker all complete.
        await this.#syncDirectory(draftRoot);
      } catch (error) {
        try {
          await rollback();
        } catch (rollbackError) {
          preserveStageForRecovery = true;
          entry.recovered = false;
          throw Object.assign(new Error('Widget build projection rollback requires recovery.', {
            cause: rollbackError,
          }), { code: 'BUILD_ROLLBACK_FAILED' });
        }
        throw error;
      }
      let projectedMarker: TMarkerIdentity;
      let projectedCapture: TWidgetWorkspaceDraftBuildCapture;
      try {
        const projectedReceiptPath = join(
          liveDist,
          WIDGET_BUILD_RECEIPT_PATH.slice('dist/'.length),
        );
        const marker = await this.#readStableFile(
          projectedReceiptPath,
          WIDGET_BUILD_RECEIPT_MAX_BYTES,
          1,
        );
        projectedMarker = marker.identity;
        const observedOutputs = await this.#observeOutputs(entry.widgetKey);
        if (!fnWidgetBuildReceiptOutputsMatch({
          receipt: built.receipt,
          observedOutputs,
        })) throw generationError(
          'BUILD_OUTPUT_MISMATCH',
          'Atomically projected build output does not match its receipt.',
        );
        const workspace = await this.#workspace;
        projectedCapture = await workspace.captureDraftBuildInput({
          slug: entry.widgetKey,
          signal,
        });
        this.#assertReceiptMatchesCapture(built.receipt, projectedCapture);
        this.#assertActive(signal);
        await writeFile(commitMarkerPath, `${JSON.stringify({
          format: HOST_BUILD_COMMIT_FORMAT,
          widgetKey: entry.widgetKey,
          buildIdentity: built.receipt.buildIdentity,
        })}\n`, { flag: 'wx', mode: 0o600 });
        await this.#syncFile(commitMarkerPath);
        await this.#syncDirectory(stageRoot);
      } catch (error) {
        try {
          await rollback();
        } catch (rollbackError) {
          preserveStageForRecovery = true;
          entry.recovered = false;
          throw Object.assign(new Error('Widget build verification rollback requires recovery.', {
            cause: rollbackError,
          }), { code: 'BUILD_ROLLBACK_FAILED' });
        }
        throw error;
      }
      if (existing !== null) {
        await rm(backup, { recursive: true, force: true }).catch(() => {
          preserveStageForRecovery = true;
          entry.recovered = false;
        });
      }
      return Object.freeze({ marker: projectedMarker, capture: projectedCapture });
    } finally {
      if (!preserveStageForRecovery) {
        await rm(stageRoot, { recursive: true, force: true });
      }
    }
  }

  async retire(widgetKey: string): Promise<void> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(widgetKey)) {
      throw new TypeError('Widget build generation key is invalid.');
    }
    const rebuild = this.#rebuilds.get(widgetKey);
    rebuild?.controller.abort('widget-deleted');
    if (rebuild !== undefined) await rebuild.promise.catch(() => undefined);
    const entry = this.#entries.get(widgetKey);
    entry?.watcher?.close();
    if (entry !== undefined) await entry.observeTail.catch(() => undefined);
    this.#entries.delete(widgetKey);
    await this.#config.builder.closeWorkspace(`generation_${widgetKey}`);
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pollTimer !== null) this.#config.cancelInterval(this.#pollTimer);
    this.#pollTimer = null;
    for (const rebuild of this.#rebuilds.values()) rebuild.controller.abort('service-stopped');
    await Promise.allSettled([...this.#rebuilds.values()].map((rebuild) => rebuild.promise));
    const entries = [...this.#entries.values()];
    for (const entry of entries) entry.watcher?.close();
    await Promise.all(entries.map((entry) => entry.observeTail.catch(() => undefined)));
    await Promise.all(entries.map((entry) => (
      this.#config.builder.closeWorkspace(`generation_${entry.widgetKey}`)
    )));
    this.#listeners.clear();
    this.#rebuilds.clear();
    this.#entries.clear();
    this.#pollCursor = 0;
  }

  #assertActive(signal: AbortSignal): void {
    if (signal.aborted || this.#closed) {
      throw generationError('ABORT_ERR', 'Widget build generation was cancelled.');
    }
  }

  async #syncFile(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #syncDirectory(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #committedStageMatchesLive(
    entry: TEntry,
    stageRoot: string,
    liveDist: string,
  ): Promise<boolean> {
    try {
      const live = await lstat(liveDist);
      if (!live.isDirectory() || live.isSymbolicLink()) return false;
      const marker = await this.#readStableFile(
        join(stageRoot, HOST_BUILD_COMMIT_MARKER),
        HOST_BUILD_MARKER_MAX_BYTES,
        1,
      );
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(marker.bytes)) as unknown;
      if (
        value === null
        || typeof value !== 'object'
        || Array.isArray(value)
        || !('format' in value)
        || value.format !== HOST_BUILD_COMMIT_FORMAT
        || !('widgetKey' in value)
        || value.widgetKey !== entry.widgetKey
        || !('buildIdentity' in value)
        || typeof value.buildIdentity !== 'string'
        || !/^[0-9a-f]{64}$/.test(value.buildIdentity)
      ) return false;
      const receiptFile = await this.#readStableFile(
        join(liveDist, WIDGET_BUILD_RECEIPT_PATH.slice('dist/'.length)),
        WIDGET_BUILD_RECEIPT_MAX_BYTES,
        1,
      );
      const receipt = parseWidgetBuildReceiptJson(
        new TextDecoder('utf-8', { fatal: true }).decode(receiptFile.bytes),
      );
      if (
        receipt.sdkVersion !== this.#config.sdkVersion
        || receipt.buildIdentity !== value.buildIdentity
        || !fnWidgetBuildReceiptIdentityMatches({ receipt, digestSha256: sha256 })
      ) return false;
      return fnWidgetBuildReceiptOutputsMatch({
        receipt,
        observedOutputs: await this.#observeOutputs(entry.widgetKey),
      });
    } catch {
      return false;
    }
  }

  async #projectionStageStarted(entry: TEntry, stageRoot: string): Promise<boolean> {
    try {
      const marker = await this.#readStableFile(
        join(stageRoot, HOST_BUILD_PROJECTION_MARKER),
        HOST_BUILD_MARKER_MAX_BYTES,
        1,
      );
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(marker.bytes)) as unknown;
      return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && 'format' in value
        && value.format === HOST_BUILD_PROJECTION_FORMAT
        && 'widgetKey' in value
        && value.widgetKey === entry.widgetKey
        && 'buildIdentity' in value
        && typeof value.buildIdentity === 'string'
        && /^[0-9a-f]{64}$/.test(value.buildIdentity)
        && 'previousDist' in value
        && typeof value.previousDist === 'boolean';
    } catch {
      return false;
    }
  }

  async #recoverHostBuildStages(entry: TEntry): Promise<void> {
    if (entry.recovered) return;
    const stagingRoot = join(this.#config.widgetsRoot, '.staging');
    const prefix = `${HOST_BUILD_STAGE_PREFIX}${entry.widgetKey}-`;
    const candidates = (await readdir(stagingRoot, { withFileTypes: true }))
      .filter((candidate) => candidate.name.startsWith(prefix));
    const liveDist = join(
      this.#config.widgetsRoot,
      'drafts',
      entry.widgetKey,
      'dist',
    );
    for (const candidate of candidates) {
      const stageRoot = join(stagingRoot, candidate.name);
      if (!candidate.isDirectory() || candidate.isSymbolicLink()) {
        throw generationError('BUILD_STAGING_INVALID', 'Widget build staging entry is unsafe.');
      }
      const backup = join(stageRoot, 'previous-dist');
      const stagedDist = join(stageRoot, 'dist');
      const [live, previous, staged, projectionMarker, commitMarker] = await Promise.all([
        lstat(liveDist).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error)),
        lstat(backup).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error)),
        lstat(stagedDist).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error)),
        lstat(join(stageRoot, HOST_BUILD_PROJECTION_MARKER))
          .catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error)),
        lstat(join(stageRoot, HOST_BUILD_COMMIT_MARKER))
          .catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error)),
      ]);
      if (staged !== null && (!staged.isDirectory() || staged.isSymbolicLink())) {
        throw generationError('BUILD_STAGING_INVALID', 'Widget build staged output is unsafe.');
      }
      if (previous !== null && (!previous.isDirectory() || previous.isSymbolicLink())) {
        throw generationError('BUILD_STAGING_INVALID', 'Widget build backup is unsafe.');
      }
      const committed = commitMarker !== null
        && await this.#committedStageMatchesLive(entry, stageRoot, liveDist);
      const projectionStarted = projectionMarker !== null
        && await this.#projectionStageStarted(entry, stageRoot);
      if (!committed && previous !== null) {
        if (live !== null) {
          if (!live.isDirectory() || live.isSymbolicLink()) {
            throw generationError('BUILD_STAGING_INVALID', 'Projected widget build output is unsafe.');
          }
          await rm(liveDist, { recursive: true, force: true });
        }
        await rename(backup, liveDist);
        await this.#syncDirectory(dirname(liveDist));
      } else if (
        !committed
        && projectionStarted
        && previous === null
        && staged === null
        && live !== null
      ) {
        if (!live.isDirectory() || live.isSymbolicLink()) {
          throw generationError('BUILD_STAGING_INVALID', 'Projected widget build output is unsafe.');
        }
        await rm(liveDist, { recursive: true, force: true });
        await this.#syncDirectory(dirname(liveDist));
      }
      await rm(stageRoot, { recursive: true, force: true });
    }
    entry.recovered = true;
  }

  async #acceptGeneration(
    entry: TEntry,
    candidate: Readonly<{
      receipt: TWidgetBuildReceipt;
      capture: TWidgetWorkspaceDraftBuildCapture;
      construction: TWidgetFilesystemConstruction;
      signed: TWidgetFilesystemSignedConstruction;
    }>,
  ): Promise<TAcceptedWidgetBuildGeneration> {
    if (entry.accepted?.receipt.buildIdentity === candidate.receipt.buildIdentity) {
      entry.phase = 'ready';
      entry.diagnostics = Object.freeze([]);
      return entry.accepted;
    }
    this.#generation += 1;
    const accepted = Object.freeze({
      widgetKey: entry.widgetKey,
      generation: this.#generation,
      receipt: candidate.receipt,
      capture: candidate.capture,
      construction: candidate.construction,
      signed: candidate.signed,
      acceptedAtMs: this.#now(),
    });
    entry.accepted = accepted;
    entry.phase = 'ready';
    entry.diagnostics = Object.freeze([]);
    await this.#config.catalog.refresh();
    this.#config.catalog.notifyBuildGenerationChanged(entry.widgetKey);
    const event = Object.freeze({
      widgetKey: entry.widgetKey,
      generation: accepted.generation,
      buildIdentity: candidate.receipt.buildIdentity,
    });
    for (const listener of [...this.#listeners]) listener(event);
    return accepted;
  }

  #entry(widgetKey: string): TEntry {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(widgetKey)) {
      throw new TypeError('Widget build generation key is invalid.');
    }
    const existing = this.#entries.get(widgetKey);
    if (existing !== undefined) return existing;
    const entry: TEntry = {
      widgetKey,
      phase: 'unbuilt',
      accepted: null,
      diagnostics: Object.freeze([]),
      lastMarker: null,
      activeCount: 0,
      recentUntilMs: this.#now() + RECENT_DRAFT_RETENTION_MS,
      watcher: null,
      observeTail: Promise.resolve(),
      nextPollAtMs: 0,
      recovered: false,
    };
    this.#entries.set(widgetKey, entry);
    return entry;
  }

  #ensureWatcher(entry: TEntry): void {
    if (entry.watcher !== null || this.#closed) return;
    const root = join(this.#config.widgetsRoot, 'drafts', entry.widgetKey);
    try {
      entry.watcher = watch(root, { recursive: true }, () => {
        entry.recentUntilMs = this.#now() + RECENT_DRAFT_RETENTION_MS;
        entry.nextPollAtMs = 0;
        this.#scheduleObserve(entry, false);
      });
      entry.watcher.on('error', () => {
        entry.watcher?.close();
        entry.watcher = null;
      });
    } catch {
      entry.watcher = null;
    }
  }

  #poll(): void {
    if (this.#closed) return;
    const now = this.#now();
    const entries = [...this.#entries.values()];
    if (entries.length === 0) {
      this.#pollCursor = 0;
      return;
    }
    const cursor = this.#pollCursor % entries.length;
    const ordered = fnWidgetBuildGenerationPollOrder({ entries, cursor });
    let polled = 0;
    let visited = 0;
    for (const entry of ordered) {
      if (polled >= MAX_POLLS_PER_TICK) break;
      visited += 1;
      if (entry.activeCount === 0 && entry.recentUntilMs < now) {
        entry.watcher?.close();
        entry.watcher = null;
        continue;
      }
      if (entry.nextPollAtMs > now) continue;
      entry.nextPollAtMs = now + ACTIVE_POLL_INTERVAL_MS;
      polled += 1;
      this.#scheduleObserve(entry, false);
    }
    this.#pollCursor = (cursor + visited) % entries.length;
  }

  #scheduleObserve(entry: TEntry, force: boolean): void {
    entry.observeTail = entry.observeTail
      .then(() => this.#observeCandidate(entry, force))
      .catch(() => undefined);
  }

  #observe(entry: TEntry, force: boolean): Promise<void> {
    const operation = entry.observeTail.then(() => this.#observeCandidate(entry, force));
    entry.observeTail = operation.catch(() => undefined);
    return operation;
  }

  async #observeCandidate(entry: TEntry, force: boolean): Promise<void> {
    if (this.#closed) return;
    await this.#recoverHostBuildStages(entry);
    const receiptPath = join(
      this.#config.widgetsRoot,
      'drafts',
      entry.widgetKey,
      ...WIDGET_BUILD_RECEIPT_PATH.split('/'),
    );
    const marker = await this.#readStableFile(receiptPath, WIDGET_BUILD_RECEIPT_MAX_BYTES, 1)
      .catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
    if (marker === null) {
      if (entry.accepted === null && entry.phase !== 'building') entry.phase = 'unbuilt';
      return;
    }
    if (!force && sameMarker(entry.lastMarker, marker.identity)) return;
    entry.lastMarker = marker.identity;
    entry.phase = 'validating';
    entry.diagnostics = Object.freeze([]);
    try {
      const receipt = parseWidgetBuildReceiptJson(new TextDecoder('utf-8', { fatal: true }).decode(marker.bytes));
      if (
        receipt.sdkVersion !== this.#config.sdkVersion
        || !fnWidgetBuildReceiptIdentityMatches({ receipt, digestSha256: sha256 })
      ) throw generationError('BUILD_RECEIPT_INVALID', 'Build receipt identity or SDK version is not accepted.');
      const workspace = await this.#workspace;
      const capture = await workspace.captureDraftBuildInput({
        slug: entry.widgetKey,
        signal: new AbortController().signal,
      });
      this.#assertReceiptMatchesCapture(receipt, capture);
      const observedOutputs = await this.#observeOutputs(entry.widgetKey);
      if (!fnWidgetBuildReceiptOutputsMatch({
        receipt,
        observedOutputs,
      })) throw generationError('BUILD_OUTPUT_MISMATCH', 'Build output does not match its receipt.');
      const confirmedMarker = await this.#readStableFile(
        receiptPath,
        WIDGET_BUILD_RECEIPT_MAX_BYTES,
        1,
      );
      if (!sameMarker(marker.identity, confirmedMarker.identity)) {
        throw generationError('BUILD_RECEIPT_STALE', 'Build receipt changed during host validation.');
      }
      const confirmedCapture = await workspace.captureDraftBuildInput({
        slug: entry.widgetKey,
        signal: new AbortController().signal,
      });
      this.#assertReceiptMatchesCapture(receipt, confirmedCapture);
      const confirmedOutputs = await this.#observeOutputs(entry.widgetKey);
      if (!fnWidgetBuildReceiptOutputsMatch({
        receipt,
        observedOutputs: confirmedOutputs,
      })) throw generationError('BUILD_OUTPUT_MISMATCH', 'Build output changed during host validation.');
      if (entry.accepted?.receipt.buildIdentity === receipt.buildIdentity) {
        entry.phase = 'ready';
        entry.diagnostics = Object.freeze([]);
        return;
      }
      const construction = await this.#config.builder.construct({
        manifest: confirmedCapture.manifest,
        files: confirmedCapture.files,
        workspaceKey: `generation_${entry.widgetKey}`,
      });
      const signed = await this.#config.builder.sign(construction, 'preview');
      await this.#acceptGeneration(entry, {
        receipt,
        capture: confirmedCapture,
        construction,
        signed,
      });
    } catch (error) {
      entry.phase = 'rejected';
      entry.diagnostics = Object.freeze([fnWidgetBuildGenerationDiagnostic(error)]);
    }
  }

  #assertReceiptMatchesCapture(
    receipt: TWidgetBuildReceipt,
    capture: TWidgetWorkspaceDraftBuildCapture,
  ): void {
    const sourceDigestSha256 = fnWidgetPortableSourceDigest({ files: capture.files, digestSha256: sha256 });
    const manifestDigestSha256 = fnWidgetManifestV1Digest({ manifest: capture.manifest, digestSha256: sha256 });
    const executableInputDigestSha256 = fnWidgetPortableExecutableInputDigest({
      manifest: capture.manifest,
      files: capture.files,
      digestSha256: sha256,
    });
    if (
      receipt.sourceDigestSha256 !== sourceDigestSha256
      || receipt.manifestDigestSha256 !== manifestDigestSha256
      || receipt.executableInputDigestSha256 !== executableInputDigestSha256
    ) throw generationError('BUILD_STALE', 'Build receipt does not match the current widget source and manifest.');
  }

  async #acceptedIsCurrent(accepted: TAcceptedWidgetBuildGeneration): Promise<boolean> {
    const workspace = await this.#workspace;
    const capture = await workspace.captureDraftBuildInput({
      slug: accepted.widgetKey,
      signal: new AbortController().signal,
    });
    try {
      this.#assertReceiptMatchesCapture(accepted.receipt, capture);
      return true;
    } catch {
      return false;
    }
  }

  async #observeOutputs(widgetKey: string): Promise<readonly TWidgetBuildReceiptOutput[]> {
    const root = join(this.#config.widgetsRoot, 'drafts', widgetKey, 'dist');
    const outputs: TWidgetBuildReceiptOutput[] = [];
    const visit = async (directory: string, prefix: string): Promise<void> => {
      const entries = (await readdir(directory, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (relativePath === 'omnidraw.build.json') continue;
        const path = join(directory, entry.name);
        const value = await lstat(path);
        if (value.isSymbolicLink() || (!value.isDirectory() && !value.isFile())) {
          throw generationError('BUILD_OUTPUT_INVALID', 'Build output contains an unsupported filesystem entry.');
        }
        if (value.isDirectory()) {
          await visit(path, relativePath);
          continue;
        }
        const file = await this.#readStableFile(path, 4 * 1_024 * 1_024);
        outputs.push(Object.freeze({
          path: `dist/${relativePath}`,
          byteSize: file.bytes.byteLength,
          sha256: sha256(file.bytes),
        }));
      }
    };
    await visit(root, '');
    return Object.freeze(outputs.sort((left, right) => left.path.localeCompare(right.path)));
  }

  async #readStableFile(
    path: string,
    maximumBytes: number,
    minimumBytes = 0,
  ): Promise<Readonly<{ bytes: Uint8Array; identity: TMarkerIdentity }>> {
    const before = await lstat(path);
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.size < minimumBytes
      || before.size > maximumBytes
    ) throw generationError('BUILD_FILE_INVALID', 'Build file is missing, unsafe, or exceeds its byte limit.');
    const identity = markerIdentity(before);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat();
      if (!markerMatches(identity, opened)) throw generationError('BUILD_FILE_CHANGED', 'Build file changed before it was read.');
      const bytes = new Uint8Array(await handle.readFile());
      const after = await handle.stat();
      const pathAfter = await lstat(path);
      if (
        bytes.byteLength !== identity.byteSize
        || !markerMatches(identity, after)
        || !markerMatches(identity, pathAfter)
      ) throw generationError('BUILD_FILE_CHANGED', 'Build file changed while it was read.');
      return Object.freeze({ bytes, identity });
    } finally {
      await handle.close();
    }
  }

  #view(entry: TEntry, current: boolean): TWidgetBuildGenerationView {
    const phase = entry.accepted !== null
      && !current
      && entry.phase !== 'building'
      && entry.phase !== 'validating'
      && entry.phase !== 'rejected'
      ? 'build_required'
      : entry.phase;
    return Object.freeze({
      widgetKey: entry.widgetKey,
      phase,
      acceptedGeneration: entry.accepted?.generation ?? null,
      acceptedBuildIdentity: entry.accepted?.receipt.buildIdentity ?? null,
      current,
      diagnostics: entry.diagnostics,
    });
  }
}

export type {
  TConfig as TWidgetBuildGenerationServiceConfig,
  TWidgetBuildGenerationEvent,
};
