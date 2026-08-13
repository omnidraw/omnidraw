import { createHash } from 'node:crypto';
import { constants, watch, type FSWatcher } from 'node:fs';
import {
  lstat,
  open,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  NodeWidgetFilesystemWorkspace,
  type TWidgetFilesystemConstruction,
  type TWidgetFilesystemSignedConstruction,
  type TWidgetWorkspaceDraftBuildCapture,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import {
  WIDGET_BUILD_RECEIPT_MAX_BYTES,
  WIDGET_BUILD_RECEIPT_PATH,
  fnWidgetBuildReceiptIdentityMatches,
  fnWidgetManifestV1Digest,
  fnWidgetPortableExecutableInputDigest,
  fnWidgetPortableSourceDigest,
  parseWidgetBuildReceiptJson,
  type TWidgetBuildReceipt,
  type TWidgetBuildReceiptOutput,
} from '#backend/core/widget-domain';
import {
  fnWidgetBuildGenerationDiagnostic,
  fnWidgetBuildGenerationPollOrder,
  fnWidgetBuildReceiptOutputsMatch,
  type TWidgetBuildGenerationDiagnostic,
} from './fn.widget-build-generation';
import { runProcess } from './WidgetNpmDistributionBuild';

const ACTIVE_POLL_INTERVAL_MS = 750;
const RECENT_DRAFT_RETENTION_MS = 30_000;
const MAX_POLLS_PER_TICK = 16;
const MANUAL_BUILD_TIMEOUT_MS = 120_000;
const MANUAL_BUILD_OUTPUT_MAX_BYTES = 1_024 * 1_024;

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
  catalog: TCatalogPort;
  builder: WidgetFilesystemBuildService;
  sdkVersion: string;
  now: () => number;
  scheduleInterval: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  cancelInterval: (timer: ReturnType<typeof setInterval>) => void;
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
  readonly #workspace: Promise<NodeWidgetFilesystemWorkspace>;
  readonly #entries = new Map<string, TEntry>();
  readonly #listeners = new Set<(event: TWidgetBuildGenerationEvent) => void>();
  readonly #now: () => number;
  #generation = 0;
  #pollCursor = 0;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #closed = false;

  constructor(config: TConfig) {
    this.#config = config;
    this.#workspace = NodeWidgetFilesystemWorkspace.open({ rootPath: config.widgetsRoot });
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

  async rebuild(widgetKey: string, signal?: AbortSignal): Promise<TAcceptedWidgetBuildGeneration> {
    const release = this.activate(widgetKey);
    const entry = this.#entry(widgetKey);
    entry.phase = 'building';
    entry.diagnostics = Object.freeze([]);
    try {
      await runProcess('npm', ['run', 'build'], {
        cwd: join(this.#config.widgetsRoot, 'drafts', widgetKey),
        timeoutMs: MANUAL_BUILD_TIMEOUT_MS,
        maxOutputBytes: MANUAL_BUILD_OUTPUT_MAX_BYTES,
        ...(signal === undefined ? {} : { signal }),
      });
      entry.lastMarker = null;
      await this.#observe(entry, true);
      if ((entry.phase as TWidgetBuildGenerationPhase) !== 'ready') {
        throw generationError(
          'BUILD_IMPORT_FAILED',
          entry.diagnostics[0]?.message ?? 'Portable build output was rejected by host validation.',
        );
      }
      return await this.requireCurrent(widgetKey, signal);
    } catch (error) {
      if ((entry.phase as TWidgetBuildGenerationPhase) !== 'ready') entry.phase = 'rejected';
      entry.diagnostics = Object.freeze([fnWidgetBuildGenerationDiagnostic(error)]);
      throw error;
    } finally {
      release();
    }
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pollTimer !== null) this.#config.cancelInterval(this.#pollTimer);
    this.#pollTimer = null;
    for (const entry of this.#entries.values()) entry.watcher?.close();
    await Promise.all([...this.#entries.values()].map((entry) => entry.observeTail.catch(() => undefined)));
    this.#listeners.clear();
    this.#entries.clear();
    this.#pollCursor = 0;
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
      const construction = await this.#config.builder.construct({
        manifest: capture.manifest,
        files: capture.files,
        workspaceKey: `generation_${entry.widgetKey}`,
      });
      const signed = await this.#config.builder.sign(construction, 'preview');
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
        return;
      }
      this.#generation += 1;
      entry.accepted = Object.freeze({
        widgetKey: entry.widgetKey,
        generation: this.#generation,
        receipt,
        capture: confirmedCapture,
        construction,
        signed,
        acceptedAtMs: this.#now(),
      });
      entry.phase = 'ready';
      await this.#config.catalog.refresh();
      this.#config.catalog.notifyBuildGenerationChanged(entry.widgetKey);
      const event = Object.freeze({
        widgetKey: entry.widgetKey,
        generation: this.#generation,
        buildIdentity: receipt.buildIdentity,
      });
      for (const listener of [...this.#listeners]) listener(event);
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
    const phase = entry.accepted !== null && !current && entry.phase !== 'building' && entry.phase !== 'validating'
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
