import { createHash } from 'node:crypto';
import {
  NodeWidgetCatalogFilesystem,
  NodeWidgetCatalogHash,
  PublicationReadWriteBarrier,
  WidgetFilesystemCatalog,
  type TWidgetCatalogEntry,
  type TWidgetCatalogSnapshot,
  type TWidgetCatalogCapsuleInspectionEffects,
  type TPinnedWidgetCatalogRoot,
  type TWidgetFilesystemManagementCapability,
  type TAgentEditableDraftResolution,
  type TAgentWidgetCatalogSnapshot,
  type TWidgetReferenceInput,
  type TWidgetReferenceResolution,
  type WidgetFilesystemBuildService,
} from '#backend/shell/agent';
import type {
  TWidgetFrameBounds,
  TWidgetManifestV1,
  TWidgetPlacementRef,
  TWidgetReleaseDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
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
}>;

type TWidgetFilesystemRuntimeResolution = Readonly<{
  widgetKey: string;
  catalogGeneration: number;
  catalogDigestSha256: string;
  manifest: TWidgetManifestV1;
  release: TWidgetReleaseDescriptor;
  capsuleBytes: Uint8Array;
  serverEntryBytes: Uint8Array | null;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
}>;

type TWidgetFilesystemCatalogChange = Readonly<{
  previousGeneration: number | null;
  generation: number;
  changedWidgetKeys: readonly string[];
  previewWidgetKeys: readonly string[];
}>;

type TWidgetFilesystemCatalogObservation = Readonly<{
  generation: number;
  widgetKeys: readonly string[];
}>;

type TWidgetFilesystemRuntimeCatalogConfig = Readonly<{
  widgetsRoot: string;
  capsule: TWidgetCatalogCapsuleInspectionEffects;
  barrier: PublicationReadWriteBarrier;
  filesystem: NodeWidgetCatalogFilesystem;
  hash: NodeWidgetCatalogHash;
  management?: Readonly<{
    builder: WidgetFilesystemBuildService;
    acceptedBuild: Readonly<{
      requireCurrent(
        widgetKey: string,
        signal?: AbortSignal,
      ): Promise<Readonly<{
        capture: import('#backend/shell/agent').TWidgetWorkspaceDraftBuildCapture;
        construction: import('#backend/shell/agent').TWidgetFilesystemConstruction;
      }>>;
    }>;
    createOperationToken: () => string;
  }>;
  buildGenerations?: Readonly<{
    view(widgetKey: string): Promise<Readonly<{
      phase: 'unbuilt' | 'build_required' | 'building' | 'validating' | 'ready' | 'rejected';
      acceptedGeneration: number | null;
      current: boolean;
    }>>;
  }>;
  resources?: Readonly<{
    getResource(resourceId: string): Promise<Readonly<{
      id: string;
      kind: 'kv' | 'secretStore' | 'db';
      status: string;
    }> | null>;
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
  readonly #buildGenerations: TWidgetFilesystemRuntimeCatalogConfig['buildGenerations'];
  readonly #resources: TWidgetFilesystemRuntimeCatalogConfig['resources'];
  readonly #listeners = new Set<(event: TWidgetFilesystemCatalogChange) => void>();
  #startPromise: Promise<void> | null = null;
  #eventGeneration = 0;

  constructor(config: TWidgetFilesystemRuntimeCatalogConfig) {
    this.#filesystem = config.filesystem;
    this.#hash = config.hash;
    this.#barrier = config.barrier;
    this.#buildGenerations = config.buildGenerations;
    this.#resources = config.resources;
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
          acceptedBuild: config.management.acceptedBuild,
          validateManifestResources: (manifest) => this.#validateManifestResources(manifest),
          createOperationToken: config.management.createOperationToken,
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
      const previousGeneration = this.#eventGeneration === 0
        ? null
        : this.#eventGeneration;
      this.#eventGeneration += 1;
      const event = Object.freeze({
        previousGeneration,
        generation: this.#eventGeneration,
        changedWidgetKeys: changed,
        previewWidgetKeys: Object.freeze([]),
      });
      for (const listener of [...this.#listeners]) listener(event);
    }
    return next;
  }

  subscribe(listener: (event: TWidgetFilesystemCatalogChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async resolveWidgetReferences(
    references: readonly TWidgetReferenceInput[],
  ): Promise<TWidgetReferenceResolution> {
    if (references.length > 16) {
      throw errorWithCode('A prompt can mention at most 16 widgets.', 'WIDGET_REFERENCE_AMBIGUOUS');
    }
    const deduplicated = references.filter((reference, index) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reference.name)) {
        throw errorWithCode('Widget reference key is invalid.', 'WIDGET_REFERENCE_STALE');
      }
      return references.findIndex((candidate) => (
        candidate.name === reference.name && candidate.source === reference.source
      )) === index;
    });
    const snapshot = await this.refresh();
    const resolved = await Promise.all(deduplicated.map(async (reference) => {
      const entry = snapshot.entries[reference.name];
      if (entry === undefined) {
        throw errorWithCode('The mentioned widget no longer exists.', 'WIDGET_REFERENCE_STALE');
      }
      const selected = reference.source === 'draft' ? entry.draft : entry.published;
      if (selected === null) {
        throw errorWithCode(
          reference.source === 'draft'
            ? 'The mentioned widget has no editable draft.'
            : 'The mentioned widget publication no longer exists.',
          reference.source === 'draft'
            ? 'WIDGET_DRAFT_UNAVAILABLE'
            : 'WIDGET_REFERENCE_STALE',
        );
      }
      if (selected.health !== 'healthy' || selected.manifest === null) {
        throw errorWithCode('The mentioned widget variant is unhealthy.', 'WIDGET_REFERENCE_UNHEALTHY');
      }
      if (selected.manifest.slug !== reference.name) {
        throw errorWithCode('The mentioned widget identity is ambiguous.', 'WIDGET_REFERENCE_AMBIGUOUS');
      }
      const editable = entry.draft?.health === 'healthy' && entry.draft.manifest !== null
        ? entry.draft
        : null;
      const build = editable === null
        ? null
        : await this.#buildGenerations?.view(reference.name) ?? {
            phase: 'unbuilt' as const,
            acceptedGeneration: null,
            current: false,
          };
      return Object.freeze({
        widgetKey: reference.name,
        requestedVariant: reference.source,
        displayName: selected.manifest.name,
        health: 'healthy' as const,
        draftAvailable: editable !== null,
        publicationAvailable: entry.published?.health === 'healthy',
        requirements: Object.freeze((selected.manifest.resources ?? []).map((requirement) => Object.freeze({
          slot: requirement.slot,
          kind: requirement.kind,
          effect: requirement.effect,
          required: requirement.required === true,
        }))),
        editableDraft: editable === null || build === null
          ? null
          : Object.freeze({
              name: editable.manifest!.name,
              slug: editable.manifest!.slug,
              treeDigestSha256: editable.treeDigestSha256,
              buildPhase: build.phase,
              acceptedGeneration: build.acceptedGeneration,
              acceptedCurrent: build.current,
            }),
      });
    }));
    return Object.freeze({
      catalogGeneration: snapshot.generation,
      catalogDigestSha256: snapshot.digestSha256,
      references: Object.freeze(resolved),
    });
  }

  async assertWidgetReferenceResolutionCurrent(
    resolution: TWidgetReferenceResolution,
  ): Promise<void> {
    const current = await this.resolveWidgetReferences(
      resolution.references.map((reference) => Object.freeze({
        name: reference.widgetKey,
        source: reference.requestedVariant,
      })),
    );
    if (
      current.catalogDigestSha256 !== resolution.catalogDigestSha256
      || JSON.stringify(current.references) !== JSON.stringify(resolution.references)
    ) throw errorWithCode(
      'Widget reference changed while its editable target was mounted.',
      'WIDGET_REFERENCE_STALE',
    );
  }

  async agentCatalog(): Promise<TAgentWidgetCatalogSnapshot> {
    const snapshot = await this.refresh();
    return Object.freeze({
      catalogGeneration: snapshot.generation,
      catalogDigestSha256: snapshot.digestSha256,
      entries: Object.freeze(Object.values(snapshot.entries).map((entry) => {
        const manifest = entry.draft?.manifest ?? entry.published?.manifest;
        const draftProblem = entry.draft?.health === 'unhealthy'
          ? 'WIDGET_DRAFT_UNHEALTHY'
          : null;
        const publishedProblem = entry.published?.health === 'unhealthy'
          ? 'WIDGET_PUBLICATION_UNHEALTHY'
          : null;
        return Object.freeze({
          widgetKey: entry.slug,
          displayName: manifest?.name ?? entry.slug,
          kind: manifest === null || manifest === undefined ? null : 'widget' as const,
          hasDraft: entry.draft !== null,
          hasPublished: entry.published !== null,
          draftHealth: entry.draft?.health ?? null,
          publishedHealth: entry.published?.health ?? null,
          problemCode: draftProblem ?? publishedProblem,
        });
      }).sort((left, right) => left.displayName.localeCompare(right.displayName, 'en-US')
        || left.widgetKey.localeCompare(right.widgetKey, 'en-US'))),
    });
  }

  async ensureAgentEditableDraft(args: Readonly<{
    name: string;
  }>): Promise<TAgentEditableDraftResolution> {
    const requested = args.name.normalize('NFKC').trim();
    if (requested.length < 1 || requested.length > 120) {
      throw errorWithCode('Widget name is invalid.', 'WIDGET_LOAD_INPUT_INVALID');
    }
    const snapshot = await this.refresh();
    const folded = requested.toLocaleLowerCase('en-US');
    const matches = Object.values(snapshot.entries).filter((entry) => {
      const names = new Set([
        entry.slug,
        entry.draft?.manifest?.name,
        entry.published?.manifest?.name,
      ].filter((value): value is string => typeof value === 'string'));
      return [...names].some((value) => (
        value === requested || value.toLocaleLowerCase('en-US') === folded
      ));
    });
    if (matches.length === 0) {
      throw errorWithCode(`Widget '${requested}' was not found.`, 'WIDGET_LOAD_NOT_FOUND');
    }
    if (matches.length !== 1) {
      throw errorWithCode(
        `Widget name '${requested}' is ambiguous. Load it by its exact widget key.`,
        'WIDGET_LOAD_AMBIGUOUS',
      );
    }
    const selected = matches[0]!;
    if (selected.draft !== null) {
      if (selected.draft.health !== 'healthy' || selected.draft.manifest === null) {
        throw errorWithCode(
          `Widget '${selected.slug}' has an unhealthy draft. Repair or remove that draft before loading it.`,
          'WIDGET_DRAFT_UNHEALTHY',
        );
      }
      return Object.freeze({
        widgetKey: selected.slug,
        displayName: selected.draft.manifest.name,
        slug: selected.slug,
        treeDigestSha256: selected.draft.treeDigestSha256,
        sourceDecision: 'existing-draft' as const,
        materialized: false,
      });
    }
    if (selected.published?.health !== 'healthy' || selected.published.manifest === null) {
      throw errorWithCode(
        `Widget '${selected.slug}' has no healthy editable or published form.`,
        'WIDGET_LOAD_UNHEALTHY',
      );
    }
    if (this.#management === null) {
      throw errorWithCode(
        'Published widget source materialization is unavailable.',
        'WIDGET_MANAGEMENT_UNAVAILABLE',
      );
    }
    const result = await this.#management.materializePublishedDraft({
      widgetKey: selected.slug,
      expectedCatalogDigestSha256: snapshot.digestSha256,
    });
    const draft = result.snapshot.entries[selected.slug]?.draft;
    if (draft?.health !== 'healthy' || draft.manifest === null) {
      throw errorWithCode(
        'Materialized widget draft did not become healthy.',
        'WIDGET_DRAFT_UNHEALTHY',
      );
    }
    return Object.freeze({
      widgetKey: selected.slug,
      displayName: draft.manifest.name,
      slug: selected.slug,
      treeDigestSha256: draft.treeDigestSha256,
      sourceDecision: 'materialized-publication' as const,
      materialized: true,
    });
  }

  async assertAgentEditableDraftCurrent(
    resolution: TAgentEditableDraftResolution,
  ): Promise<void> {
    const current = await this.refresh();
    const draft = current.entries[resolution.widgetKey]?.draft;
    if (
      draft?.health !== 'healthy'
      || draft.manifest === null
      || draft.manifest.name !== resolution.displayName
      || draft.manifest.slug !== resolution.slug
      || draft.treeDigestSha256 !== resolution.treeDigestSha256
    ) throw errorWithCode(
      'Widget draft changed while it was being loaded.',
      'WIDGET_CATALOG_CHANGED',
    );
  }

  notifyBuildGenerationChanged(widgetKey: string): void {
    const previousGeneration = this.#eventGeneration === 0
      ? null
      : this.#eventGeneration;
    this.#eventGeneration += 1;
    const event = Object.freeze({
      previousGeneration,
      generation: this.#eventGeneration,
      changedWidgetKeys: Object.freeze([]),
      previewWidgetKeys: Object.freeze([widgetKey]),
    });
    for (const listener of [...this.#listeners]) listener(event);
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
      generation: this.#eventGeneration,
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

  async resolvePlacement(args: Readonly<{
    reference: Extract<TWidgetPlacementRef, Readonly<{ source: 'published' }>>;
  }>): Promise<TWidgetFilesystemPlacementDescriptor> {
    const snapshot = this.current();
    if (args.reference.catalogGeneration !== snapshot.generation) {
      throw errorWithCode('Widget catalog generation changed.', 'WIDGET_CATALOG_CHANGED');
    }
    const entry = snapshot.entries[args.reference.widgetKey];
    if (!entry?.placeable || entry.published?.health !== 'healthy') {
      throw errorWithCode('Published widget is missing or unhealthy.', 'WIDGET_MISSING');
    }
    if (entry.published.manifest === null) {
      throw errorWithCode('Published widget manifest is unavailable.', 'WIDGET_MISSING');
    }
    await this.#validateManifestResources(entry.published.manifest);
    if (this.current() !== snapshot) {
      throw errorWithCode('Widget catalog generation changed.', 'WIDGET_CATALOG_CHANGED');
    }
    return Object.freeze({
      kind: 'published' as const,
      reference: Object.freeze({ ...args.reference }),
      widgetKey: args.reference.widgetKey,
      catalogGeneration: snapshot.generation,
      bounds: DEFAULT_WIDGET_BOUNDS,
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

  async #validateManifestResources(manifest: TWidgetManifestV1): Promise<void> {
    for (const requirement of manifest.resources ?? []) {
      if (requirement.resourceId === undefined) {
        if (!requirement.required) continue;
        throw errorWithCode(
          `Required resource slot '${requirement.slot}' is unconfigured; edit omnidraw.json and rebuild.`,
          'WIDGET_RESOURCE_BINDING_REQUIRED',
        );
      }
      if (this.#resources === undefined) throw errorWithCode(
        `Resource validation is unavailable for slot '${requirement.slot}'.`,
        'WIDGET_RESOURCE_BINDING_STALE',
      );
      const resource = await this.#resources.getResource(requirement.resourceId);
      if (resource === null || resource.id !== requirement.resourceId) throw errorWithCode(
        `Resource slot '${requirement.slot}' references an unavailable local resource.`,
        'WIDGET_RESOURCE_BINDING_STALE',
      );
      if (resource.status !== 'ready') throw errorWithCode(
        `Resource slot '${requirement.slot}' is not ready.`,
        'WIDGET_RESOURCE_NOT_READY',
      );
      if (resource.kind !== requirement.kind) throw errorWithCode(
        `Resource slot '${requirement.slot}' has the wrong resource kind.`,
        'WIDGET_RESOURCE_KIND_MISMATCH',
      );
    }
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
