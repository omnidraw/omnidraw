import { createHash } from 'node:crypto';
import type {
  TCanvasWidgetResourceBindingV1,
} from '@omnidraw/canvas-contract';
import {
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  PublicationReadWriteBarrier,
  WidgetFilesystemCatalog,
  type TWidgetCatalogEntry,
  type TWidgetCatalogSnapshot,
  type TWidgetCatalogCapsuleInspectionPortal,
  type TPinnedWidgetCatalogRoot,
  type TWidgetFilesystemManagementCapability,
  type WidgetFilesystemBuildService,
} from '@omnidraw/service-agent';
import type {
  TWidgetFrameBounds,
  TWidgetManifestV4,
  TWidgetPlacementRef,
  TWidgetReleaseDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';
import { WidgetFilesystemManagementService } from './WidgetFilesystemManagementService';

const DEFAULT_WIDGET_BOUNDS: TWidgetFrameBounds = Object.freeze({
  width: 480,
  height: 320,
});

type TWidgetFilesystemPlacementDescriptor = Readonly<{
  kind: 'published';
  reference: Extract<TWidgetPlacementRef, Readonly<{ source: 'published' }>>;
  widgetKey: string;
  catalogGeneration: number;
  bounds: TWidgetFrameBounds;
  resourceBindings: Readonly<Record<string, TCanvasWidgetResourceBindingV1>>;
}>;

type TWidgetFilesystemRuntimeResolution = Readonly<{
  widgetKey: string;
  catalogGeneration: number;
  catalogDigestSha256: string;
  manifest: TWidgetManifestV4;
  release: TWidgetReleaseDescriptor;
  capsuleBytes: Uint8Array;
  serverEntryBytes: Uint8Array | null;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
}>;

type TWidgetFilesystemCatalogChange = Readonly<{
  previousGeneration: number | null;
  generation: number;
  changedWidgetKeys: readonly string[];
}>;

type TWidgetFilesystemCatalogObservation = Readonly<{
  generation: number;
  widgetKeys: readonly string[];
}>;

type TWidgetFilesystemRuntimeCatalogConfig = Readonly<{
  widgetsRoot: string;
  capsule: TWidgetCatalogCapsuleInspectionPortal;
  barrier?: PublicationReadWriteBarrier;
  filesystem?: NodeWidgetCatalogFilesystem;
  hash?: NodeWidgetCatalogHash;
  management?: Readonly<{
    builder: WidgetFilesystemBuildService;
    createOperationToken?: () => string;
  }>;
}>;

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function catalogEntryIdentity(entry: TWidgetCatalogEntry | undefined): string | null {
  if (entry === undefined) return null;
  return JSON.stringify([
    entry.health,
    entry.placeable,
    entry.draft === null ? null : [
      entry.draft.health,
      entry.draft.treeDigestSha256,
      entry.draft.manifestDigestSha256,
    ],
    entry.published === null ? null : [
      entry.published.health,
      entry.published.treeDigestSha256,
      entry.published.manifestDigestSha256,
      entry.published.releaseDescriptorDigestSha256,
    ],
  ]);
}

function changedWidgetKeys(
  previous: TWidgetCatalogSnapshot | null,
  next: TWidgetCatalogSnapshot,
): readonly string[] {
  const keys = new Set([
    ...Object.keys(previous?.entries ?? {}),
    ...Object.keys(next.entries),
  ]);
  const changed = [...keys]
    .filter((key) => (
      catalogEntryIdentity(previous?.entries[key]) !== catalogEntryIdentity(next.entries[key])
    ));
  if (previous !== null && previous.digestSha256 !== next.digestSha256) {
    for (const [key, entry] of Object.entries(previous.entries)) {
      if (entry.published !== null) changed.push(key);
    }
    for (const [key, entry] of Object.entries(next.entries)) {
      if (entry.published !== null) changed.push(key);
    }
  }
  return Object.freeze([...new Set(changed)].sort());
}

function normalizeResourceBindings(
  entry: TWidgetCatalogEntry,
  input: Readonly<Record<string, TCanvasWidgetResourceBindingV1>> | undefined,
): Readonly<Record<string, TCanvasWidgetResourceBindingV1>> {
  const manifest = entry.published?.manifest;
  if (manifest === null || manifest === undefined) {
    throw errorWithCode('Published widget is unavailable.', 'WIDGET_MISSING');
  }
  const requirements = new Map((manifest.resources ?? []).map((item) => [item.slot, item]));
  const bindings = input ?? {};
  const result: Record<string, TCanvasWidgetResourceBindingV1> = {};
  for (const slot of Object.keys(bindings).sort()) {
    const requirement = requirements.get(slot);
    const binding = bindings[slot];
    if (
      requirement === undefined
      || binding === undefined
      || binding.resourceId.trim().length === 0
      || (binding.allowRead && requirement.effect !== 'read' && requirement.effect !== 'read_write')
      || (binding.allowWrite && requirement.effect !== 'write' && requirement.effect !== 'read_write')
      || (!binding.allowRead && !binding.allowWrite)
    ) throw errorWithCode('Widget resource selection is invalid.', 'WIDGET_RESOURCE_SELECTION_INVALID');
    result[slot] = Object.freeze({
      resourceId: binding.resourceId,
      allowRead: binding.allowRead,
      allowWrite: binding.allowWrite,
    });
  }
  for (const requirement of requirements.values()) {
    if (requirement.required && result[requirement.slot] === undefined) {
      throw errorWithCode(
        `Widget resource slot '${requirement.slot}' requires a concrete local choice.`,
        'WIDGET_RESOURCE_SELECTION_REQUIRED',
      );
    }
  }
  return Object.freeze(result);
}

/**
 * Production filesystem authority for discovery, placement, and exact runtime
 * bytes. One immutable scan generation serves every request until refresh.
 */
export class WidgetFilesystemRuntimeCatalog {
  readonly name = 'widget-filesystem-runtime-catalog';
  readonly #filesystem: NodeWidgetCatalogFilesystem;
  readonly #hash: NodeWidgetCatalogHash;
  readonly #barrier: PublicationReadWriteBarrier;
  readonly #root: Promise<TPinnedWidgetCatalogRoot>;
  readonly #catalog: WidgetFilesystemCatalog;
  readonly #management: WidgetFilesystemManagementService | null;
  readonly #listeners = new Set<(event: TWidgetFilesystemCatalogChange) => void>();
  #startPromise: Promise<void> | null = null;

  constructor(config: TWidgetFilesystemRuntimeCatalogConfig) {
    this.#filesystem = config.filesystem ?? new NodeWidgetCatalogFilesystem();
    this.#hash = config.hash ?? new NodeWidgetCatalogHash();
    this.#barrier = config.barrier ?? new PublicationReadWriteBarrier();
    this.#root = this.#filesystem.pinRoot({ requestedPath: config.widgetsRoot });
    this.#catalog = new WidgetFilesystemCatalog({
      rootPath: config.widgetsRoot,
      filesystem: this.#filesystem,
      hash: this.#hash,
      capsule: config.capsule,
      barrier: this.#barrier,
    });
    this.#management = config.management === undefined
      ? null
      : new WidgetFilesystemManagementService({
          widgetsRoot: config.widgetsRoot,
          catalog: {
            current: () => this.current(),
            refresh: () => this.refresh(),
          },
          barrier: this.#barrier,
          filesystem: this.#filesystem,
          hash: this.#hash,
          capsule: config.capsule,
          builder: config.management.builder,
          ...(config.management.createOperationToken === undefined
            ? {}
            : { createOperationToken: config.management.createOperationToken }),
        });
  }

  start(): Promise<void> {
    if (this.#startPromise === null) {
      this.#startPromise = this.refresh().then(() => undefined);
    }
    return this.#startPromise;
  }

  async stop(): Promise<void> {
    try {
      await this.#management?.close();
    } finally {
      this.#listeners.clear();
    }
  }

  current(): TWidgetCatalogSnapshot {
    const snapshot = this.#catalog.current();
    if (snapshot === null) {
      throw errorWithCode('Widget catalog has not completed startup.', 'WIDGET_CATALOG_NOT_READY');
    }
    return snapshot;
  }

  async refresh(): Promise<TWidgetCatalogSnapshot> {
    const previous = this.#catalog.current();
    const next = await this.#catalog.refresh();
    const changed = changedWidgetKeys(previous, next);
    const shouldPublish = previous === null
      ? changed.length > 0
      : previous.digestSha256 !== next.digestSha256;
    if (shouldPublish) {
      const event = Object.freeze({
        previousGeneration: previous?.generation ?? null,
        generation: next.generation,
        changedWidgetKeys: changed,
      });
      for (const listener of [...this.#listeners]) listener(event);
    }
    return next;
  }

  subscribe(listener: (event: TWidgetFilesystemCatalogChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  saveDraftConfig(
    args: Parameters<TWidgetFilesystemManagementCapability['saveDraftConfig']>[0],
  ) {
    return this.#requireManagement().saveDraftConfig(args);
  }

  publishMetadata(
    args: Parameters<TWidgetFilesystemManagementCapability['publishMetadata']>[0],
  ) {
    return this.#requireManagement().publishMetadata(args);
  }

  buildAndPublish(
    args: Parameters<TWidgetFilesystemManagementCapability['buildAndPublish']>[0],
  ) {
    return this.#requireManagement().buildAndPublish(args);
  }

  listFiles(
    args: Parameters<TWidgetFilesystemManagementCapability['listFiles']>[0],
  ) {
    return this.#requireManagement().listFiles(args);
  }

  readFile(
    args: Parameters<TWidgetFilesystemManagementCapability['readFile']>[0],
  ) {
    return this.#requireManagement().readFile(args);
  }

  catalogObservation(): TWidgetFilesystemCatalogObservation {
    const snapshot = this.current();
    return Object.freeze({
      generation: snapshot.generation,
      widgetKeys: Object.freeze(Object.values(snapshot.entries)
        .filter((entry) => entry.published !== null)
        .map((entry) => entry.slug)
        .sort()),
    });
  }

  publishedReferences(): readonly Extract<
    TWidgetPlacementRef,
    Readonly<{ source: 'published' }>
  >[] {
    const snapshot = this.current();
    return Object.freeze(Object.values(snapshot.entries)
      .filter((entry) => entry.placeable && entry.published?.health === 'healthy')
      .map((entry) => Object.freeze({
        source: 'published' as const,
        widgetKey: entry.slug,
        catalogGeneration: snapshot.generation,
      })));
  }

  resolvePlacement(args: Readonly<{
    reference: Extract<TWidgetPlacementRef, Readonly<{ source: 'published' }>>;
    resourceBindings?: Readonly<Record<string, TCanvasWidgetResourceBindingV1>>;
  }>): TWidgetFilesystemPlacementDescriptor {
    const snapshot = this.current();
    if (args.reference.catalogGeneration !== snapshot.generation) {
      throw errorWithCode('Widget catalog generation changed.', 'WIDGET_CATALOG_CHANGED');
    }
    const entry = snapshot.entries[args.reference.widgetKey];
    if (!entry?.placeable || entry.published?.health !== 'healthy') {
      throw errorWithCode('Published widget is missing or unhealthy.', 'WIDGET_MISSING');
    }
    return Object.freeze({
      kind: 'published' as const,
      reference: Object.freeze({ ...args.reference }),
      widgetKey: args.reference.widgetKey,
      catalogGeneration: snapshot.generation,
      bounds: DEFAULT_WIDGET_BOUNDS,
      resourceBindings: normalizeResourceBindings(entry, args.resourceBindings),
    });
  }

  async resolveRuntime(
    widgetKey: string,
  ): Promise<TWidgetFilesystemRuntimeResolution> {
    try {
      return await this.#barrier.withRead(async () => {
      const captured = this.current();
      const entry = captured.entries[widgetKey];
      const published = entry?.published;
      if (
        !entry?.placeable
        || published?.health !== 'healthy'
        || published.manifest === null
        || published.release === null
      ) throw errorWithCode('Published widget is missing or unhealthy.', 'WIDGET_MISSING');

      const root = await this.#root;
      const bytesByPath = new Map<string, Uint8Array>();
      for (const expected of published.release.files) {
        const bytes = await this.#filesystem.readFile(root, {
          relativePath: `${published.relativePath}/${expected.path}`,
          maxBytes: expected.byteSize,
        });
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (bytes.byteLength !== expected.byteSize || digest !== expected.sha256) {
          throw errorWithCode('Published widget bytes changed after catalog scan.', 'WIDGET_MISSING');
        }
        bytesByPath.set(expected.path, bytes);
      }
      for (const selected of ['omnidraw.json', 'release.json'] as const) {
        const observed = published.files.find((file) => file.path === selected);
        if (observed === undefined) {
          throw errorWithCode('Published widget metadata is missing.', 'WIDGET_MISSING');
        }
        const bytes = await this.#filesystem.readFile(root, {
          relativePath: `${published.relativePath}/${selected}`,
          maxBytes: observed.byteSize,
        });
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (bytes.byteLength !== observed.byteSize || digest !== observed.sha256) {
          throw errorWithCode('Published widget metadata changed after catalog scan.', 'WIDGET_MISSING');
        }
      }
      const current = this.current();
      const finalEntry = current.entries[widgetKey]?.published;
      if (
        current !== captured
        || finalEntry?.health !== 'healthy'
        || finalEntry.treeDigestSha256 !== published.treeDigestSha256
        || finalEntry.releaseDescriptorDigestSha256 !== published.releaseDescriptorDigestSha256
      ) throw errorWithCode('Widget catalog generation changed.', 'WIDGET_CATALOG_CHANGED');
      const capsuleBytes = bytesByPath.get(published.release.capsule.path);
      if (capsuleBytes === undefined) {
        throw errorWithCode('Published Capsule artifact is missing.', 'WIDGET_MISSING');
      }
      const serverEntryBytes = published.release.server === null
        ? null
        : bytesByPath.get(published.release.server.entry);
      if (published.release.server !== null && serverEntryBytes === undefined) {
        throw errorWithCode('Published server entry is missing.', 'WIDGET_MISSING');
      }
      return Object.freeze({
        widgetKey,
        catalogGeneration: captured.generation,
        catalogDigestSha256: captured.digestSha256,
        manifest: published.manifest,
        release: published.release,
        capsuleBytes: new Uint8Array(capsuleBytes),
        serverEntryBytes: serverEntryBytes === null
          ? null
          : new Uint8Array(serverEntryBytes!),
        functionDescriptors: Object.freeze([...(published.functions ?? [])]),
      });
      });
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error
        ? error.code
        : null;
      if (
        code === 'WIDGET_MISSING'
        || code === 'WIDGET_CATALOG_CHANGED'
        || code === 'WIDGET_CATALOG_NOT_READY'
      ) throw error;
      throw errorWithCode('Published widget files are missing or unreadable.', 'WIDGET_MISSING');
    }
  }

  isRuntimeResolutionCurrent(
    resolution: Pick<
      TWidgetFilesystemRuntimeResolution,
      'widgetKey' | 'catalogGeneration' | 'catalogDigestSha256'
    >,
  ): boolean {
    const current = this.#catalog.current();
    return current !== null
      && current.generation === resolution.catalogGeneration
      && current.digestSha256 === resolution.catalogDigestSha256
      && current.entries[resolution.widgetKey]?.published?.health === 'healthy';
  }

  #requireManagement(): TWidgetFilesystemManagementCapability {
    if (this.#management === null) {
      throw errorWithCode(
        'Widget filesystem management is not configured.',
        'WIDGET_MANAGEMENT_UNAVAILABLE',
      );
    }
    return this.#management;
  }
}

export type {
  TWidgetFilesystemCatalogChange,
  TWidgetFilesystemCatalogObservation,
  TWidgetFilesystemPlacementDescriptor,
  TWidgetFilesystemRuntimeCatalogConfig,
  TWidgetFilesystemRuntimeResolution,
};
