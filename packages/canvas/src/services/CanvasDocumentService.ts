import type {
  IInfiniteCanvasEngine,
  IResourceRegistrationOwner,
  TImageNode,
  TResourceId,
  TSceneNode,
  TSerializedSceneCommand,
} from '@omnidraw/cangine';
import type {
  IEditorHistory,
  IEditorImageImportPort,
  IEditorSceneMutationPort,
  TEditorSceneMutationReceipt,
  TEditorSceneMutationRequest,
  TPreparedImageImportRequest,
} from '@omnidraw/cangine/editor';
import {
  CANVAS_IMAGE_EXTENSION_KEY,
  CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
  CANVAS_RUNTIME_GRID_NODE_ID,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  fnReadCanvasImageExtension,
  type TCanvasCommand,
  type TCanvasEvent,
  type TCanvasImageExtensionV1,
  type TCanvasItemSnapshot,
  type TCanvasItemsChangedEvent,
  type TCanvasOperation,
  type TCanvasPrecondition,
  type TCanvasSnapshot,
} from '@vibecanvas/canvas-contract';
import { BUILTIN_THEMES } from '@vibecanvas/service-theme';
import type {
  TCanvasImagePort,
  TImageUploadFormat,
} from '../types';
import {
  fnReduceLocalDocument,
  type TLocalDocumentNodeImage,
} from './fn.local-document';
import {
  fnAuthoredCanvasNode,
  fnDiffSceneNodeStructure,
  fnDiffSceneNodes,
  fnRuntimeCanvasNode,
  fnSceneNodesEqual,
} from './fn.scene-node-diff';
import {
  fnRuntimeGridNode,
  fnRuntimeSceneSnapshot,
  type TRuntimeGridPresentation,
} from './fn.runtime-scene';

const SERVER_SCENE_SOURCE = 'vibecanvas:server';
const SNAPSHOT_SCENE_SOURCE = 'vibecanvas:snapshot';
const RUNTIME_GRID_SCENE_SOURCE = 'vibecanvas:runtime-grid';
const UNDO_SCENE_SOURCE = 'vibecanvas:undo';
const REDO_SCENE_SOURCE = 'vibecanvas:redo';
const IMAGE_PROMOTION_SOURCE = 'vibecanvas:image-promotion';
const LOCAL_HISTORY_CAPACITY = 100;
const DOCUMENT_IMAGE_RESOURCE_OWNER = 'vibecanvas:document-images';
const DOCUMENT_IMAGE_REGISTRATION_OWNER = 'vibecanvas:document-image-urls';
const SUPPORTED_IMAGE_MIME_TYPES = new Set<TImageUploadFormat>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const RESERVED_RUNTIME_NODE_IDS = new Set([
  CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
  CANVAS_RUNTIME_GRID_NODE_ID,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
]);

export type TCanvasDocumentTransport = Readonly<{
  getSnapshot(args: Readonly<{ canvasId: string }>): Promise<TCanvasSnapshot>;
  execute(command: TCanvasCommand): Promise<TCanvasItemsChangedEvent>;
  subscribe(args: Readonly<{
    canvasId: string;
    afterRevision: number;
  }>): AsyncIterable<TCanvasEvent>;
}>;

export type TCanvasDocumentServiceOptions = Readonly<{
  canvasId: string;
  transport: TCanvasDocumentTransport;
  createCommandId(): string;
  image?: TCanvasImagePort;
  runtimeGridPresentation?: TRuntimeGridPresentation;
  onError?(error: unknown): void;
  observe?(observation: TCanvasDocumentObservation): void;
}>;

export type TCanvasDocumentObservation = Readonly<{
  phase:
    | 'local-request'
    | 'local-request-rejected'
    | 'durable-plan-prepared'
    | 'projection-applied'
    | 'pending-queued'
    | 'command-dispatched'
    | 'acknowledgement-accepted'
    | 'acknowledgement-rejected'
    | 'remote-event-accepted'
    | 'pending-retired'
    | 'pending-invalidated'
    | 'recovery-scheduled'
    | 'recovery-started'
    | 'recovery-completed'
    | 'recovery-failed'
    | 'reload-started'
    | 'reload-completed'
    | 'reload-failed';
  priority: 'critical' | 'high' | 'normal' | 'low';
  transactionId?: string;
  commandId?: string;
  nodeIds?: readonly string[];
  acceptedRevision: number;
  projectedSceneRevision: number;
  pendingCount: number;
  data?: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
}>;

type THistoryEntry = Readonly<{
  before: ReadonlyMap<string, TLocalDocumentNodeImage>;
  after: ReadonlyMap<string, TLocalDocumentNodeImage>;
  coalesceKey?: string;
}>;

type TCommandPlan = Readonly<{
  operations: readonly TCanvasOperation[];
  preconditions: readonly TCanvasPrecondition[];
}>;

type TMediaGate = Readonly<{
  wait: Promise<void>;
  release(): void;
}>;

type TPendingTransaction = {
  readonly transactionId: string;
  readonly source: string;
  readonly coalesceKey?: string;
  readonly affectedNodeIds: readonly string[];
  readonly commandId: string;
  readonly mediaGate: TMediaGate | null;
  readonly ownedImageResourceIds: readonly string[];
  dispatchState: 'queued' | 'executing';
  ownedMediaCleanupScheduled: boolean;
  before: Map<string, TLocalDocumentNodeImage>;
  after: Map<string, TLocalDocumentNodeImage>;
  plan: TCommandPlan;
};

type TLocalImage = {
  readonly nodeId: string;
  readonly resourceId: TResourceId;
  readonly blob: Blob;
  readonly mimeType: TImageUploadFormat;
  durableUrl: string | null;
};

type TPreparedImport = Readonly<{
  importId: string;
  transactionId: string;
}>;

type TImagePromotion = Readonly<{
  resourceId: string;
  extension: TCanvasImageExtensionV1;
}>;

type TIndexedImageDescriptor = {
  extension: TCanvasImageExtensionV1;
  count: number;
};

type TImageDocumentIndex = Readonly<{
  nodeCounts: Map<string, number>;
  descriptorCounts: Map<string, Map<string, TIndexedImageDescriptor>>;
}>;

type TImageIndexPatch = Readonly<{
  nodeCounts: Map<string, number>;
  descriptorCounts: Map<string, Map<string, TIndexedImageDescriptor>>;
  registrationsChanged: boolean;
}>;

type TCommitOptions = Readonly<{
  persist: boolean;
  recordHistory: boolean;
  mediaGate?: TMediaGate;
  preparedImageResourceIds?: readonly string[];
}>;

type TCommitResult = Readonly<{
  receipt: TEditorSceneMutationReceipt;
  pending: TPendingTransaction | null;
}>;

class CanvasDocumentHistory implements IEditorHistory {
  readonly #capacity: number;
  readonly #perform: (entry: THistoryEntry, direction: 'undo' | 'redo') => void;
  readonly #reportError: (error: unknown) => void;
  readonly #listeners = new Set<() => void>();
  readonly #undo: THistoryEntry[] = [];
  readonly #redo: THistoryEntry[] = [];
  #attached = false;
  #destroyed = false;
  #coalesceKey: string | null = null;

  constructor(
    perform: (entry: THistoryEntry, direction: 'undo' | 'redo') => void,
    reportError: (error: unknown) => void,
    capacity = LOCAL_HISTORY_CAPACITY,
  ) {
    this.#perform = perform;
    this.#reportError = reportError;
    this.#capacity = capacity;
  }

  get canUndo(): boolean {
    return !this.#destroyed && this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return !this.#destroyed && this.#redo.length > 0;
  }

  get retainedWeight(): number {
    return this.#undo.length + this.#redo.length;
  }

  attach(): void {
    if (this.#destroyed) return;
    this.#attached = true;
  }

  detach(): void {
    this.#attached = false;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  beginCoalescing(key: string): void {
    this.#coalesceKey = key;
  }

  endCoalescing(key?: string): void {
    if (key === undefined || key === this.#coalesceKey) this.#coalesceKey = null;
  }

  undo(): boolean {
    if (!this.#attached || !this.canUndo) return false;
    const entry = this.#undo.at(-1)!;
    this.#perform(entry, 'undo');
    this.#undo.pop();
    this.#redo.push(entry);
    this.#notify();
    return true;
  }

  redo(): boolean {
    if (!this.#attached || !this.canRedo) return false;
    const entry = this.#redo.at(-1)!;
    this.#perform(entry, 'redo');
    this.#redo.pop();
    this.#undo.push(entry);
    this.#notify();
    return true;
  }

  clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#coalesceKey = null;
    this.#notify();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#attached = false;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#listeners.clear();
  }

  record(entry: THistoryEntry): void {
    if (this.#destroyed) return;
    const coalesceKey = entry.coalesceKey ?? this.#coalesceKey ?? undefined;
    const previous = this.#undo.at(-1);
    if (coalesceKey !== undefined && previous?.coalesceKey === coalesceKey) {
      const before = new Map(previous.before);
      const after = new Map(previous.after);
      for (const [id, node] of entry.before) {
        if (!before.has(id)) before.set(id, node);
      }
      for (const [id, node] of entry.after) after.set(id, node);
      for (const [id, node] of [...before]) {
        if (!fnSceneNodesEqual(node, after.get(id) ?? null)) continue;
        before.delete(id);
        after.delete(id);
      }
      if (before.size === 0) {
        this.#undo.pop();
      } else {
        this.#undo[this.#undo.length - 1] = {
          before,
          after,
          coalesceKey,
        };
      }
    } else {
      this.#undo.push({ ...entry, coalesceKey });
      while (this.#undo.length > this.#capacity) this.#undo.shift();
    }
    this.#redo.length = 0;
    this.#notify();
  }

  promoteImages(promotions: ReadonlyMap<string, TImagePromotion>): void {
    const rewrite = (
      images: ReadonlyMap<string, TLocalDocumentNodeImage>,
    ): ReadonlyMap<string, TLocalDocumentNodeImage> => {
      const next = new Map(images);
      for (const [nodeId, node] of next) {
        if (node?.kind !== 'image') continue;
        const promotion = promotions.get(node.resourceId);
        if (promotion === undefined) continue;
        next.set(nodeId, withImageExtension(node, promotion.extension));
      }
      return next;
    };
    const rewriteEntry = (entry: THistoryEntry): THistoryEntry => ({
      ...entry,
      before: rewrite(entry.before),
      after: rewrite(entry.after),
    });
    for (let index = 0; index < this.#undo.length; index += 1) {
      this.#undo[index] = rewriteEntry(this.#undo[index]!);
    }
    for (let index = 0; index < this.#redo.length; index += 1) {
      this.#redo[index] = rewriteEntry(this.#redo[index]!);
    }
  }

  referencesResource(resourceId: string): boolean {
    const references = (entry: THistoryEntry): boolean => (
      nodeImagesReferenceResource(entry.before, resourceId)
      || nodeImagesReferenceResource(entry.after, resourceId)
    );
    return this.#undo.some(references) || this.#redo.some(references);
  }

  overlaps(nodeIds: ReadonlySet<string>): boolean {
    const overlapsImages = (
      images: ReadonlyMap<string, TLocalDocumentNodeImage>,
    ): boolean => {
      for (const nodeId of images.keys()) {
        if (nodeIds.has(nodeId)) return true;
      }
      return false;
    };
    const overlapsEntry = (entry: THistoryEntry): boolean => (
      overlapsImages(entry.before) || overlapsImages(entry.after)
    );
    return this.#undo.some(overlapsEntry) || this.#redo.some(overlapsEntry);
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#reportError(error);
      }
    }
  }
}

/**
 * Current-session local document authority and durable CanvasService client.
 * Cangine receives exactly one projection after this service accepts a local
 * mutation; server work remains serialized and asynchronous.
 */
export class CanvasDocumentService
  implements IEditorSceneMutationPort, IEditorImageImportPort {
  readonly history: IEditorHistory;
  readonly #history: CanvasDocumentHistory;
  readonly #canvasId: string;
  readonly #transport: TCanvasDocumentTransport;
  readonly #createCommandId: () => string;
  readonly #image: TCanvasImagePort | null;
  readonly #onError: (error: unknown) => void;
  readonly #observeDocument: ((observation: TCanvasDocumentObservation) => void) | null;
  readonly #acceptedItems = new Map<string, TCanvasItemSnapshot>();
  readonly #pendingByTransactionId = new Map<string, TPendingTransaction>();
  readonly #pendingByCommandId = new Map<string, TPendingTransaction>();
  readonly #seenTransactionIds = new Set<string>();
  readonly #seenImportIds = new Set<string>();
  readonly #acceptedCommandIds = new Set<string>();
  readonly #localImages = new Map<TResourceId, TLocalImage>();
  readonly #activeImports = new Map<string, TPreparedImport>();
  readonly #inFlightTransactions = new Set<TPendingTransaction>();
  readonly #mediaTasks = new Set<Promise<void>>();
  #imageNodeCounts = new Map<string, number>();
  #imageDescriptorCounts = new Map<
    string,
    Map<string, TIndexedImageDescriptor>
  >();
  #optimisticNodes: ReadonlyMap<string, TSceneNode> = new Map();
  #engine: IInfiniteCanvasEngine | null = null;
  #resourceRegistrations: IResourceRegistrationOwner | null = null;
  #acceptedRevision = 0;
  #projectionRevision = 0;
  #disposed = false;
  #committing = false;
  #recoveryPending = false;
  #reloading = false;
  #outboxGeneration = 0;
  #generation = 0;
  #commandTail: Promise<void> = Promise.resolve();
  #recoveryTask: Promise<void> | null = null;
  #eventIterator: AsyncIterator<TCanvasEvent> | null = null;
  #runtimeGridPresentation: TRuntimeGridPresentation;

  constructor(options: TCanvasDocumentServiceOptions) {
    this.#canvasId = options.canvasId;
    this.#transport = options.transport;
    this.#createCommandId = options.createCommandId;
    this.#image = options.image ?? null;
    this.#runtimeGridPresentation = options.runtimeGridPresentation
      ?? {
        visible: true,
        minorColor: BUILTIN_THEMES[0]!.colors.canvasGridMinor,
        majorColor: BUILTIN_THEMES[0]!.colors.canvasGridMajor,
      };
    this.#onError = options.onError ?? (() => undefined);
    this.#observeDocument = options.observe ?? null;
    this.#history = new CanvasDocumentHistory(
      (entry, direction) => {
        this.#performHistory(entry, direction);
      },
      (error) => this.#reportError(error),
    );
    this.history = this.#history;
  }

  get revision(): number {
    return this.#acceptedRevision;
  }

  get projectedSceneRevision(): number {
    return this.#projectionRevision;
  }

  get pendingTransactionCount(): number {
    return this.#pendingByTransactionId.size;
  }

  get canvasId(): string {
    return this.#canvasId;
  }

  item(itemId: string): TCanvasItemSnapshot | null {
    return this.#acceptedItems.get(itemId) ?? null;
  }

  items(): readonly TCanvasItemSnapshot[] {
    return Object.freeze([...this.#acceptedItems.values()]);
  }

  node(nodeId: string): Readonly<TSceneNode> | null {
    return this.#optimisticNodes.get(nodeId) ?? null;
  }

  async start(engine: IInfiniteCanvasEngine): Promise<void> {
    if (this.#disposed) throw new Error('Canvas document service is disposed.');
    if (this.#engine) throw new Error('Canvas document service is already started.');
    this.#engine = engine;
    try {
      this.#resourceRegistrations = engine.resources.createRegistrationOwner(
        DOCUMENT_IMAGE_REGISTRATION_OWNER,
      );
      await this.#reload(true);
    } catch (error) {
      try {
        this.#resourceRegistrations?.destroy();
      } catch (destroyError) {
        this.#reportError(destroyError);
      }
      this.#resourceRegistrations = null;
      this.#engine = null;
      throw error;
    }
    const generation = ++this.#generation;
    void this.#consumeEvents(generation);
  }

  setRuntimeGridPresentation(
    presentation: TRuntimeGridPresentation,
  ): boolean {
    if (this.#disposed) {
      throw new RangeError('Canvas document service is disposed.');
    }
    const engine = this.#engine;
    if (engine === null) {
      throw new RangeError('Canvas document service is not started.');
    }
    if (this.#committing) {
      throw new RangeError('Canvas document reconciliation is in progress.');
    }
    const nextGridNode = fnRuntimeGridNode({ grid: presentation });
    if (this.#recoveryPending || this.#reloading) {
      const changed = !fnSceneNodesEqual(
        fnRuntimeGridNode({ grid: this.#runtimeGridPresentation }),
        nextGridNode,
      );
      this.#runtimeGridPresentation = presentation;
      return changed;
    }
    if (fnSceneNodesEqual(
      this.#optimisticNodes.get(CANVAS_RUNTIME_GRID_NODE_ID) ?? null,
      nextGridNode,
    )) {
      this.#runtimeGridPresentation = presentation;
      return false;
    }
    this.#projectSceneCommands(
      [{ type: 'upsert', node: nextGridNode }],
      RUNTIME_GRID_SCENE_SOURCE,
    );
    if (!(this.#optimisticNodes instanceof Map)) throw new TypeError(
      'Canvas optimistic document storage is not mutable.',
    );
    this.#optimisticNodes.set(nextGridNode.id, nextGridNode);
    this.#runtimeGridPresentation = presentation;
    return true;
  }

  commit(
    request: TEditorSceneMutationRequest,
  ): TEditorSceneMutationReceipt {
    return this.#commitMutation(request, {
      persist: true,
      recordHistory: true,
    }).receipt;
  }

  allocateIdentity(args: Readonly<{
    importId: string;
    index: number;
    mimeType: string;
  }>): Readonly<{ nodeId: string; resourceId: string }> {
    this.#assertReadyForCommit();
    const mimeType = supportedImageMimeType(args.mimeType);
    void mimeType;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const nodeId = `image:${this.#createCommandId()}`;
      const resourceId = `image-resource:${this.#createCommandId()}`;
      if (
        !this.#optimisticNodes.has(nodeId)
        && this.#engine!.resources.state(resourceId) === null
      ) {
        return Object.freeze({ nodeId, resourceId });
      }
    }
    throw new RangeError('Unable to allocate an unused image identity.');
  }

  commitPrepared(
    request: TPreparedImageImportRequest,
  ): TEditorSceneMutationReceipt {
    this.#assertReadyForCommit();
    if (this.#image === null) {
      throw new Error('Canvas image persistence is unavailable.');
    }
    assertIdentifier(request.importId, 'prepared image import ID');
    if (this.#seenImportIds.has(request.importId)) {
      throw new RangeError(`Duplicate prepared image import ID '${request.importId}'.`);
    }
    if (!Array.isArray(request.images) || request.images.length === 0) {
      throw new RangeError('Prepared image import requires at least one image.');
    }

    const commandNodes = new Map<string, Readonly<TImageNode>>();
    const reorderCommands: Array<Extract<
      TSerializedSceneCommand,
      Readonly<{ type: 'reorder' }>
    >> = [];
    for (const command of request.mutation.commands) {
      if (command.type === 'reorder') {
        reorderCommands.push(command);
        continue;
      }
      if (command.type !== 'upsert' || command.node.kind !== 'image') {
        throw new RangeError(
          'Prepared image mutations may contain only image upserts and sibling reorders.',
        );
      }
      if (commandNodes.has(command.node.id)) {
        throw new RangeError(
          `Prepared image mutation repeats node '${command.node.id}'.`,
        );
      }
      commandNodes.set(command.node.id, command.node);
    }
    if (commandNodes.size !== request.images.length) {
      throw new RangeError(
        'Prepared image entries and image upserts must correspond one-to-one.',
      );
    }
    const preparedParentIds = new Set(
      [...commandNodes.values()].map((node) => node.parentId),
    );
    for (const command of reorderCommands) {
      const existing = this.#optimisticNodes.get(command.nodeId);
      if (
        existing === undefined
        || !preparedParentIds.has(existing.parentId)
        || commandNodes.has(command.nodeId)
      ) {
        throw new RangeError(
          `Prepared image reorder '${command.nodeId}' is not an existing sibling.`,
        );
      }
    }
    const staged: TLocalImage[] = [];
    const nodeIds = new Set<string>();
    const resourceIds = new Set<string>();
    for (const image of request.images) {
      const commandNode = commandNodes.get(image.node.id);
      if (
        commandNode === undefined
        || commandNode.resourceId !== image.node.resourceId
        || !fnSceneNodesEqual(commandNode, image.node)
      ) {
        throw new RangeError(
          `Prepared image '${image.node.id}' does not match its mutation command.`,
        );
      }
      if (nodeIds.has(image.node.id)) {
        throw new RangeError(
          `Duplicate prepared image node ID '${image.node.id}'.`,
        );
      }
      if (this.#optimisticNodes.has(image.node.id)) {
        throw new RangeError(
          `Prepared image node ID '${image.node.id}' already exists.`,
        );
      }
      if (
        resourceIds.has(image.node.resourceId)
        || this.#localImages.has(image.node.resourceId)
        || this.#imageNodeCounts.has(image.node.resourceId)
      ) {
        throw new RangeError(
          `Duplicate prepared image resource ID '${image.node.resourceId}'.`,
        );
      }
      nodeIds.add(image.node.id);
      resourceIds.add(image.node.resourceId);
      staged.push({
        nodeId: image.node.id,
        resourceId: image.node.resourceId,
        blob: image.blob,
        mimeType: supportedImageMimeType(image.mimeType),
        durableUrl: null,
      });
    }

    const retained: string[] = [];
    const mediaGate = createMediaGate();
    try {
      for (const image of staged) {
        this.#engine!.resources.retain(
          image.resourceId,
          DOCUMENT_IMAGE_RESOURCE_OWNER,
        );
        retained.push(image.resourceId);
        this.#localImages.set(image.resourceId, image);
      }
      const committed = this.#commitMutation(request.mutation, {
        persist: true,
        recordHistory: true,
        mediaGate,
        preparedImageResourceIds: [...resourceIds],
      });
      const pending = committed.pending;
      if (pending === null) {
        throw new Error('Prepared image mutation did not create a pending command.');
      }
      this.#seenImportIds.add(request.importId);
      this.#activeImports.set(request.importId, {
        importId: request.importId,
        transactionId: pending.transactionId,
      });
      this.#schedulePreparedUpload(request.importId, pending, staged);
      return committed.receipt;
    } catch (error) {
      for (const resourceId of retained.reverse()) {
        this.#releaseLocalImage(resourceId, false);
      }
      mediaGate.release();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#outboxGeneration += 1;
    const queuedOwnedMedia = [...this.#pendingByTransactionId.values()]
      .filter((pending) => pending.dispatchState === 'queued');
    this.#invalidatePending();
    for (const pending of queuedOwnedMedia) {
      void this.#deletePendingOwnedMedia(pending);
    }
    const iterator = this.#eventIterator;
    this.#eventIterator = null;
    try {
      const closing = iterator?.return?.();
      void closing?.catch(() => undefined);
    } catch {
      // A hostile iterator must not prevent bounded local teardown.
    }
    this.#history.destroy();
    try {
      this.#resourceRegistrations?.destroy();
    } catch (error) {
      this.#reportError(error);
    }
    this.#resourceRegistrations = null;
    for (const resourceId of [...this.#localImages.keys()]) {
      this.#releaseLocalImage(resourceId, false);
    }
    this.#acceptedItems.clear();
    this.#optimisticNodes = new Map();
    this.#imageNodeCounts.clear();
    this.#imageDescriptorCounts.clear();
    this.#engine = null;
  }

  #commitMutation(
    request: TEditorSceneMutationRequest,
    options: TCommitOptions,
  ): TCommitResult {
    this.#observe({
      phase: 'local-request',
      priority: 'critical',
      transactionId: request.transactionId,
      nodeIds: request.affectedNodeIds,
      data: {
        source: request.source,
        commandCount: request.commands.length,
        basisSceneRevision: request.basisSceneRevision,
      },
    });
    try {
      return this.#performCommitMutation(request, options);
    } catch (error) {
      this.#observe({
        phase: 'local-request-rejected',
        priority: 'critical',
        transactionId: request.transactionId,
        nodeIds: request.affectedNodeIds,
        data: {
          errorName: error instanceof Error ? error.name : 'Error',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  #performCommitMutation(
    request: TEditorSceneMutationRequest,
    options: TCommitOptions,
  ): TCommitResult {
    this.#assertReadyForCommit();
    assertIdentifier(request.transactionId, 'editor transaction ID');
    assertIdentifier(request.source, 'editor mutation source');
    if (this.#seenTransactionIds.has(request.transactionId)) {
      throw new RangeError(`Duplicate editor transaction ID '${request.transactionId}'.`);
    }
    if (
      request.basisSceneRevision !== this.#projectionRevision
      || request.basisSceneRevision !== this.#engine!.scene.revision
    ) {
      throw new RangeError(
        `Stale editor transaction basis ${request.basisSceneRevision}; `
          + `document and engine are at ${this.#projectionRevision} and `
          + `${this.#engine!.scene.revision}.`,
      );
    }
    this.#assertAuthoredMutation(request);

    this.#committing = true;
    let pending: TPendingTransaction | null = null;
    const previousNodes = this.#optimisticNodes;
    try {
      if (!(previousNodes instanceof Map)) {
        throw new TypeError('Canvas optimistic document storage is not mutable.');
      }
      const reduction = fnReduceLocalDocument(previousNodes, request);
      this.#assertPersistableImages(
        reduction.after,
        new Set(options.preparedImageResourceIds ?? []),
      );
      const imageIndexPatch = this.#stageImageIndexChanges(
        reduction.before,
        reduction.after,
      );
      const plan = this.#planFromNodes(reduction.before, reduction.after);
      if (plan.operations.length === 0) {
        throw new RangeError('Editor transaction has no durable canvas operation.');
      }
      this.#observe({
        phase: 'durable-plan-prepared',
        priority: 'critical',
        transactionId: request.transactionId,
        nodeIds: reduction.affectedNodeIds,
        data: {
          operationCount: plan.operations.length,
          preconditionCount: plan.preconditions.length,
          operationTypes: plan.operations.map((operation) => operation.type),
        },
      });
      const historyEntry: THistoryEntry = {
        before: new Map(reduction.before),
        after: new Map(reduction.after),
        ...(request.coalesceKey === undefined
          ? {}
          : { coalesceKey: request.coalesceKey }),
      };
      if (options.persist) {
        const commandId = this.#createCommandId();
        assertIdentifier(commandId, 'canvas command ID');
        if (
          this.#pendingByCommandId.has(commandId)
          || this.#acceptedCommandIds.has(commandId)
        ) {
          throw new RangeError(`Duplicate canvas command ID '${commandId}'.`);
        }
        pending = {
          transactionId: request.transactionId,
          source: request.source,
          ...(request.coalesceKey === undefined
            ? {}
            : { coalesceKey: request.coalesceKey }),
          affectedNodeIds: Object.freeze([...reduction.affectedNodeIds]),
          commandId,
          before: new Map(reduction.before),
          after: new Map(reduction.after),
          plan,
          mediaGate: options.mediaGate ?? null,
          ownedImageResourceIds: Object.freeze([
            ...(options.preparedImageResourceIds ?? []),
          ]),
          dispatchState: 'queued',
          ownedMediaCleanupScheduled: false,
        };
      }

      this.#optimisticNodes = reduction.nodes;
      if (pending !== null) {
        this.#installPending(pending);
        this.#observe({
          phase: 'pending-queued',
          priority: 'critical',
          transactionId: pending.transactionId,
          commandId: pending.commandId,
          nodeIds: pending.affectedNodeIds,
        });
      }
      try {
        this.#engine!.scene.apply([...request.commands], {
          source: request.source,
          ...(request.coalesceKey === undefined
            ? {}
            : { coalesceKey: request.coalesceKey }),
        });
      } catch (error) {
        this.#optimisticNodes = previousNodes;
        if (pending !== null) this.#retirePending(pending);
        throw error;
      }

      const expectedRevision = request.basisSceneRevision + 1;
      if (this.#engine!.scene.revision !== expectedRevision) {
        this.#optimisticNodes = previousNodes;
        if (pending !== null) this.#retirePending(pending);
        this.#scheduleRecovery();
        throw new RangeError(
          'Canvas scene projection did not produce exactly one successor revision.',
        );
      }
      this.#projectionRevision = expectedRevision;
      this.#observe({
        phase: 'projection-applied',
        priority: 'critical',
        transactionId: request.transactionId,
        ...(pending === null ? {} : { commandId: pending.commandId }),
        nodeIds: reduction.affectedNodeIds,
        data: {
          source: request.source,
          successorRevision: expectedRevision,
        },
      });
      for (const [nodeId, node] of reduction.after) {
        if (node === null) previousNodes.delete(nodeId);
        else previousNodes.set(nodeId, node);
      }
      this.#optimisticNodes = previousNodes;
      this.#applyImageIndexPatch(imageIndexPatch);
      if (imageIndexPatch.registrationsChanged) {
        try {
          this.#syncDurableResources();
        } catch (error) {
          this.#scheduleRecovery(error);
          throw error;
        }
      }
      this.#seenTransactionIds.add(request.transactionId);
      if (pending !== null) this.#enqueuePending(pending);
      if (options.recordHistory) this.#history.record(historyEntry);
      this.#releaseOrphanLocalImages(true);
      return Object.freeze({
        receipt: Object.freeze({ projectedSceneRevision: expectedRevision }),
        pending,
      });
    } finally {
      this.#committing = false;
    }
  }

  #assertPersistableImages(
    after: ReadonlyMap<string, TLocalDocumentNodeImage>,
    preparedResourceIds: ReadonlySet<string>,
  ): void {
    for (const node of after.values()) {
      if (node?.kind !== 'image' || fnReadCanvasImageExtension(node) !== null) {
        continue;
      }
      const coveredByPreparedImport = (
        preparedResourceIds.has(node.resourceId)
        && this.#localImages.get(node.resourceId)?.durableUrl === null
      );
      const coveredByPendingImport = [...this.#pendingByTransactionId.values()]
        .some((pending) => (
          pending.mediaGate !== null
          && pending.ownedImageResourceIds.includes(node.resourceId)
          && this.#localImages.get(node.resourceId)?.durableUrl === null
        ));
      if (coveredByPreparedImport || coveredByPendingImport) continue;
      throw new RangeError(
        `Image node '${node.id}' has no durable Vibecanvas image descriptor.`,
      );
    }
  }

  #performHistory(
    entry: THistoryEntry,
    direction: 'undo' | 'redo',
  ): void {
    const desired = direction === 'undo' ? entry.before : entry.after;
    const planned = this.#commandsForNodeImages(desired);
    const request: TEditorSceneMutationRequest = {
      transactionId: `history:${this.#createCommandId()}`,
      basisSceneRevision: this.#projectionRevision,
      source: direction === 'undo' ? UNDO_SCENE_SOURCE : REDO_SCENE_SOURCE,
      commands: planned.commands,
      affectedNodeIds: planned.affectedNodeIds,
    };
    this.#commitMutation(request, {
      persist: true,
      recordHistory: false,
    });
  }

  #commandsForNodeImages(
    desired: ReadonlyMap<string, TLocalDocumentNodeImage>,
  ): Readonly<{
    commands: readonly TSerializedSceneCommand[];
    affectedNodeIds: readonly string[];
  }> {
    const upserts: TSerializedSceneCommand[] = [];
    const removals: TSerializedSceneCommand[] = [];
    const affectedNodeIds: string[] = [];
    for (const nodeId of [...desired.keys()].sort(codePointCompare)) {
      const target = desired.get(nodeId) ?? null;
      const current = this.#optimisticNodes.get(nodeId) ?? null;
      if (fnSceneNodesEqual(current, target)) continue;
      affectedNodeIds.push(nodeId);
      if (target === null) {
        removals.push({
          type: 'remove',
          nodeId,
          descendants: 'remove',
        });
      } else {
        upserts.push({ type: 'upsert', node: target });
      }
    }
    const commands = Object.freeze([...upserts, ...removals]);
    if (commands.length === 0) {
      throw new RangeError('History step has no local document change.');
    }
    return Object.freeze({
      commands,
      affectedNodeIds: Object.freeze(affectedNodeIds),
    });
  }

  #planFromNodes(
    before: ReadonlyMap<string, TLocalDocumentNodeImage>,
    after: ReadonlyMap<string, TLocalDocumentNodeImage>,
  ): TCommandPlan {
    const operations: TCanvasOperation[] = [];
    const preconditions: TCanvasPrecondition[] = [];
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const previousRuntime = before.get(id) ?? null;
      const nextRuntime = after.get(id) ?? null;
      const previous = previousRuntime === null
        ? null
        : fnAuthoredCanvasNode(previousRuntime);
      const next = nextRuntime === null
        ? null
        : fnAuthoredCanvasNode(nextRuntime);
      if (fnSceneNodesEqual(previous, next)) continue;
      if (previous === null && next !== null) {
        operations.push({ type: 'insert', item: next });
        preconditions.push({ type: 'item-absent', itemId: id });
        continue;
      }
      if (previous !== null && next === null) {
        operations.push({ type: 'delete', itemId: id });
        continue;
      }
      if (previous === null || next === null) continue;
      if (previous.id !== id || next.id !== id) {
        throw new TypeError(`Canvas transaction '${id}' contains a mismatched node ID.`);
      }
      const structure = fnDiffSceneNodeStructure(previous, next);
      if (structure.parentChanged) {
        operations.push({
          type: 'reparent',
          itemId: id,
          parentId: next.parentId,
          ...(structure.orderChanged ? { orderKey: next.orderKey } : {}),
        });
      } else if (structure.orderChanged) {
        operations.push({
          type: 'reorder',
          itemId: id,
          orderKey: next.orderKey,
        });
      }
      const diff = fnDiffSceneNodes(previous, next);
      if (diff.patches.length === 0) continue;
      operations.push({ type: 'patch', itemId: id, patches: diff.patches });
      preconditions.push(...diff.preconditions);
    }
    return Object.freeze({
      operations: Object.freeze(operations),
      preconditions: Object.freeze(preconditions),
    });
  }

  #installPending(pending: TPendingTransaction): void {
    if (
      this.#pendingByTransactionId.has(pending.transactionId)
      || this.#pendingByCommandId.has(pending.commandId)
      || this.#acceptedCommandIds.has(pending.commandId)
    ) {
      throw new RangeError('Pending canvas transaction IDs must be unique.');
    }
    this.#pendingByTransactionId.set(pending.transactionId, pending);
    this.#pendingByCommandId.set(pending.commandId, pending);
  }

  #retirePending(pending: TPendingTransaction): void {
    if (this.#pendingByTransactionId.get(pending.transactionId) === pending) {
      this.#pendingByTransactionId.delete(pending.transactionId);
    }
    if (this.#pendingByCommandId.get(pending.commandId) === pending) {
      this.#pendingByCommandId.delete(pending.commandId);
    }
    pending.mediaGate?.release();
    this.#observe({
      phase: 'pending-retired',
      priority: 'critical',
      transactionId: pending.transactionId,
      commandId: pending.commandId,
      nodeIds: pending.affectedNodeIds,
    });
  }

  #enqueuePending(pending: TPendingTransaction): void {
    const outboxGeneration = this.#outboxGeneration;
    const operation = async (): Promise<void> => {
      if (pending.mediaGate !== null) await pending.mediaGate.wait;
      if (this.#disposed) {
        await this.#deletePendingOwnedMedia(pending);
        return;
      }
      if (
        outboxGeneration !== this.#outboxGeneration
        || this.#pendingByTransactionId.get(pending.transactionId) !== pending
      ) return;
      pending.dispatchState = 'executing';
      this.#inFlightTransactions.add(pending);
      try {
        const command = this.#commandForPending(pending);
        this.#observe({
          phase: 'command-dispatched',
          priority: 'critical',
          transactionId: pending.transactionId,
          commandId: pending.commandId,
          nodeIds: pending.affectedNodeIds,
          data: {
            baseRevision: command.baseRevision,
            operationCount: command.operations.length,
          },
        });
        const event = await this.#transport.execute(command);
        if (this.#disposed) {
          this.#inFlightTransactions.delete(pending);
          return;
        }
        if (
          outboxGeneration !== this.#outboxGeneration
          || this.#pendingByTransactionId.get(pending.transactionId) !== pending
        ) {
          await this.#acceptLateCommittedEvent(event);
        } else {
          try {
            this.#acceptEvent(event, pending);
          } catch (error) {
            this.#observe({
              phase: 'acknowledgement-rejected',
              priority: 'critical',
              transactionId: pending.transactionId,
              commandId: pending.commandId,
              nodeIds: pending.affectedNodeIds,
              data: {
                errorMessage: error instanceof Error
                  ? error.message
                  : String(error),
              },
            });
            this.#scheduleRecovery(error);
            await (this.#recoveryTask ?? Promise.resolve());
          }
        }
        this.#inFlightTransactions.delete(pending);
        this.#releaseOrphanLocalImages(true);
      } catch (error) {
        this.#observe({
          phase: 'acknowledgement-rejected',
          priority: 'critical',
          transactionId: pending.transactionId,
          commandId: pending.commandId,
          nodeIds: pending.affectedNodeIds,
          data: {
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
        if (this.#disposed) {
          this.#inFlightTransactions.delete(pending);
          await this.#deletePendingOwnedMedia(pending);
          return;
        }
        if (outboxGeneration === this.#outboxGeneration) {
          this.#scheduleRecovery(error);
        }
        await (this.#recoveryTask ?? Promise.resolve());
        this.#inFlightTransactions.delete(pending);
        this.#releaseOrphanLocalImages(true);
      }
    };
    this.#commandTail = this.#commandTail.then(operation, operation);
  }

  async #acceptLateCommittedEvent(
    event: TCanvasItemsChangedEvent,
  ): Promise<void> {
    await (this.#recoveryTask ?? Promise.resolve());
    if (this.#disposed) return;
    try {
      this.#acceptEvent(event, null);
    } catch (error) {
      this.#scheduleRecovery(error);
      await (this.#recoveryTask ?? Promise.resolve());
    }
  }

  async #deletePendingOwnedMedia(
    pending: TPendingTransaction,
  ): Promise<void> {
    if (pending.ownedMediaCleanupScheduled) return;
    pending.ownedMediaCleanupScheduled = true;
    const ownedResources = new Set(pending.ownedImageResourceIds);
    const urls = new Set<string>();
    for (const node of pending.after.values()) {
      if (node?.kind !== 'image' || !ownedResources.has(node.resourceId)) continue;
      const extension = fnReadCanvasImageExtension(node);
      if (extension !== null) urls.add(extension.url);
    }
    await this.#deleteUploadedUrls([...urls]);
  }

  #commandForPending(pending: TPendingTransaction): TCanvasCommand {
    const preconditions = [...pending.plan.preconditions];
    const revisionGuarded = new Set(
      preconditions
        .filter((entry) => entry.type === 'item-revision')
        .map((entry) => entry.itemId),
    );
    for (const entry of pending.plan.operations) {
      if (
        entry.type !== 'delete'
        && entry.type !== 'replace'
        && entry.type !== 'reparent'
        && entry.type !== 'reorder'
      ) continue;
      const itemId = entry.type === 'replace' ? entry.item.id : entry.itemId;
      if (revisionGuarded.has(itemId)) continue;
      const item = this.#acceptedItems.get(itemId);
      if (!item) {
        throw new Error(
          `Canvas item '${itemId}' is missing an authoritative revision guard.`,
        );
      }
      preconditions.push({
        type: 'item-revision',
        itemId,
        itemRevision: item.itemRevision,
      });
      revisionGuarded.add(itemId);
    }
    return {
      commandId: pending.commandId,
      canvasId: this.#canvasId,
      baseRevision: this.#acceptedRevision,
      operations: pending.plan.operations,
      preconditions,
    };
  }

  #acceptEvent(
    event: TCanvasItemsChangedEvent,
    expectedPending: TPendingTransaction | null,
  ): void {
    if (event.canvasId !== this.#canvasId) {
      throw new Error(`Received an event for unexpected canvas '${event.canvasId}'.`);
    }
    if (event.revision <= this.#acceptedRevision) {
      if (
        expectedPending !== null
        && this.#pendingByTransactionId.get(expectedPending.transactionId)
          === expectedPending
      ) {
        throw new Error(
          `Canvas command '${expectedPending.commandId}' returned a stale acknowledgement.`,
        );
      }
      return;
    }
    if (this.#acceptedCommandIds.has(event.commandId)) {
      throw new Error(
        `Canvas command '${event.commandId}' was replayed at a new revision.`,
      );
    }
    if (event.revision !== this.#acceptedRevision + 1) {
      throw new Error(
        `Canvas revision gap: expected ${this.#acceptedRevision + 1}, `
          + `received ${event.revision}.`,
      );
    }

    const pending = this.#pendingByCommandId.get(event.commandId) ?? null;
    if (expectedPending !== null && pending !== expectedPending) {
      throw new Error(
        `Canvas command '${expectedPending.commandId}' returned `
          + `unexpected acknowledgement '${event.commandId}'.`,
      );
    }
    const changedIds = this.#eventTargetIds(event);
    if (pending !== null) {
      const expectedIds = [...pending.affectedNodeIds].sort(codePointCompare);
      const receivedIds = [...changedIds].sort(codePointCompare);
      if (
        expectedIds.length !== receivedIds.length
        || expectedIds.some((nodeId, index) => nodeId !== receivedIds[index])
      ) {
        throw new Error(
          `Canvas acknowledgement '${event.commandId}' does not match `
            + 'the pending mutation targets.',
        );
      }
    }
    const projectedDeletionIds = this.#projectedDeletionIds(event);
    const projectedEffectIds = new Set([
      ...changedIds,
      ...projectedDeletionIds,
    ]);
    const explicitDeletedIds = new Set(event.deletedItemIds);
    for (const nodeId of projectedDeletionIds) {
      if (
        explicitDeletedIds.has(nodeId)
        || changedIds.has(nodeId)
        || !this.#acceptedItems.has(nodeId)
      ) continue;
      throw new Error(
        `Canvas event '${event.commandId}' omits an attached descendant `
          + `'${nodeId}' from its structural result.`,
      );
    }
    const conflictingIds = pending === null
      ? projectedEffectIds
      : new Set(
        [...projectedEffectIds].filter((nodeId) => !changedIds.has(nodeId)),
      );
    if (this.#pendingOverlaps(conflictingIds, pending)) {
      throw new Error('A remote canvas event overlaps an unresolved local mutation.');
    }
    if (
      pending === null
      && this.#history.overlaps(
        this.#historyEffectIds(event, projectedEffectIds),
      )
    ) {
      this.#history.clear();
    }

    for (const item of event.changedItems) this.#acceptedItems.set(item.id, item);
    for (const itemId of event.deletedItemIds) this.#acceptedItems.delete(itemId);
    this.#acceptedRevision = event.revision;
    this.#acceptedCommandIds.add(event.commandId);
    this.#observe({
      phase: pending === null
        ? 'remote-event-accepted'
        : 'acknowledgement-accepted',
      priority: 'critical',
      ...(pending === null ? {} : { transactionId: pending.transactionId }),
      commandId: event.commandId,
      nodeIds: [...changedIds],
      data: {
        revision: event.revision,
        changedCount: event.changedItems.length,
        deletedCount: event.deletedItemIds.length,
      },
    });
    if (pending !== null) this.#retirePending(pending);

    const protectedIds = this.#pendingAffectedIds();
    const nextNodes = new Map(this.#optimisticNodes);
    const commands: TSerializedSceneCommand[] = [];
    for (const item of event.changedItems) {
      if (protectedIds.has(item.id)) continue;
      const next = fnRuntimeCanvasNode(item.item);
      const current = nextNodes.get(item.id) ?? null;
      if (fnSceneNodesEqual(current, next)) continue;
      nextNodes.set(item.id, next);
      commands.push({ type: 'upsert', node: next });
    }
    const projectedDeletionRoots = event.deletedItemIds.filter(
      (itemId) => !protectedIds.has(itemId),
    );
    const appliedDeletionIds = this.#projectedDeletionIds({
      ...event,
      deletedItemIds: projectedDeletionRoots,
    }, nextNodes);
    for (const itemId of appliedDeletionIds) {
      if (!nextNodes.has(itemId)) continue;
      nextNodes.delete(itemId);
    }
    for (const itemId of projectedDeletionRoots) {
      if (
        !this.#optimisticNodes.has(itemId)
      ) continue;
      commands.push({
        type: 'remove',
        nodeId: itemId,
        descendants: 'remove',
      });
    }
    const nextImageIndex = this.#buildImageDocumentIndex(nextNodes);
    this.#syncDurableResources(nextImageIndex);
    this.#optimisticNodes = nextNodes;
    this.#imageNodeCounts = nextImageIndex.nodeCounts;
    this.#imageDescriptorCounts = nextImageIndex.descriptorCounts;
    if (commands.length > 0) {
      this.#projectSceneCommands(commands);
    }
    this.#releaseOrphanLocalImages(true);
  }

  #eventTargetIds(event: TCanvasItemsChangedEvent): Set<string> {
    const result = new Set<string>();
    for (const snapshot of event.changedItems) {
      if (snapshot.id !== snapshot.item.id || result.has(snapshot.id)) {
        throw new Error(
          `Canvas event '${event.commandId}' contains an invalid changed item.`,
        );
      }
      result.add(snapshot.id);
    }
    for (const itemId of event.deletedItemIds) {
      if (result.has(itemId)) {
        throw new Error(
          `Canvas event '${event.commandId}' contains a duplicate item target.`,
        );
      }
      result.add(itemId);
    }
    return result;
  }

  #projectedDeletionIds(
    event: TCanvasItemsChangedEvent,
    nodes: ReadonlyMap<string, TSceneNode> = this.#optimisticNodes,
  ): Set<string> {
    const result = new Set(event.deletedItemIds);
    const children = new Map<string, string[]>();
    for (const node of nodes.values()) {
      if (node.parentId === null) continue;
      const siblings = children.get(node.parentId);
      if (siblings === undefined) children.set(node.parentId, [node.id]);
      else siblings.push(node.id);
    }
    const work = [...event.deletedItemIds];
    while (work.length > 0) {
      const nodeId = work.pop()!;
      for (const childId of children.get(nodeId) ?? []) {
        if (result.has(childId)) continue;
        result.add(childId);
        work.push(childId);
      }
    }
    return result;
  }

  #historyEffectIds(
    event: TCanvasItemsChangedEvent,
    directEffectIds: ReadonlySet<string>,
  ): Set<string> {
    const result = new Set(directEffectIds);
    const incomingParents = new Map(
      event.changedItems.map((snapshot) => {
        const node = fnRuntimeCanvasNode(snapshot.item);
        return [node.id, node.parentId] as const;
      }),
    );
    const addAncestors = (
      nodeId: string,
      useIncomingParents: boolean,
    ): void => {
      const traversed = new Set<string>([nodeId]);
      let currentId = nodeId;
      while (true) {
        const parentId = (
          useIncomingParents && incomingParents.has(currentId)
            ? incomingParents.get(currentId)
            : this.#optimisticNodes.get(currentId)?.parentId
        );
        if (
          parentId === null
          || parentId === undefined
          || traversed.has(parentId)
        ) return;
        result.add(parentId);
        traversed.add(parentId);
        currentId = parentId;
      }
    };
    for (const nodeId of directEffectIds) {
      addAncestors(nodeId, false);
      addAncestors(nodeId, true);
    }
    return result;
  }

  #projectSceneCommands(
    commands: readonly TSerializedSceneCommand[],
    source = SERVER_SCENE_SOURCE,
  ): void {
    if (this.#committing) {
      throw new RangeError('Cannot reconcile the scene during a local commit.');
    }
    if (
      this.#engine === null
      || this.#engine.scene.revision !== this.#projectionRevision
    ) {
      throw new RangeError('Canvas scene projection is not synchronized.');
    }
    const expectedRevision = this.#projectionRevision + 1;
    this.#engine.scene.apply([...commands], { source });
    if (this.#engine.scene.revision !== expectedRevision) {
      throw new RangeError(
        'Accepted canvas projection did not produce exactly one revision.',
      );
    }
    this.#projectionRevision = expectedRevision;
  }

  #pendingAffectedIds(): Set<string> {
    const result = new Set<string>();
    for (const pending of this.#pendingByTransactionId.values()) {
      for (const nodeId of pending.affectedNodeIds) result.add(nodeId);
    }
    return result;
  }

  #pendingOverlaps(
    nodeIds: ReadonlySet<string>,
    except: TPendingTransaction | null,
  ): boolean {
    for (const pending of this.#pendingByTransactionId.values()) {
      if (pending === except) continue;
      if (pending.affectedNodeIds.some((nodeId) => nodeIds.has(nodeId))) {
        return true;
      }
    }
    return false;
  }

  #schedulePreparedUpload(
    importId: string,
    pending: TPendingTransaction,
    images: readonly TLocalImage[],
  ): void {
    const operation = this.#uploadPreparedImport(importId, pending, images);
    this.#mediaTasks.add(operation);
    void operation.then(
      () => this.#mediaTasks.delete(operation),
      (error) => {
        this.#mediaTasks.delete(operation);
        this.#reportError(error);
        this.#scheduleRecovery();
      },
    );
  }

  async #uploadPreparedImport(
    importId: string,
    pending: TPendingTransaction,
    images: readonly TLocalImage[],
  ): Promise<void> {
    const uploaded: Array<Readonly<{
      image: TLocalImage;
      url: string;
    }>> = [];
    try {
      for (const image of images) {
        const data = new Uint8Array(await image.blob.arrayBuffer());
        const result = await this.#image!.uploadImage({
          data,
          mime_type: image.mimeType,
        });
        if (
          typeof result.url !== 'string'
          || result.url.trim().length === 0
        ) {
          throw new TypeError('Canvas image upload returned an invalid URL.');
        }
        uploaded.push({ image, url: result.url });
      }
      if (
        this.#disposed
        || this.#activeImports.get(importId)?.transactionId
          !== pending.transactionId
        || this.#pendingByTransactionId.get(pending.transactionId) !== pending
      ) {
        await this.#deleteUploadedUrls(uploaded.map((entry) => entry.url));
        return;
      }

      const promotions = new Map<string, TImagePromotion>();
      const commands: TSerializedSceneCommand[] = [];
      for (const entry of uploaded) {
        const matchingNodes = [...this.#optimisticNodes.values()].filter(
          (node): node is TImageNode => (
            node.kind === 'image'
            && node.resourceId === entry.image.resourceId
          ),
        );
        if (matchingNodes.length === 0) {
          throw new Error(
            `Pending image '${entry.image.nodeId}' was removed before upload completed.`,
          );
        }
        const extension: TCanvasImageExtensionV1 = {
          schemaVersion: 1,
          url: entry.url,
          mimeType: entry.image.mimeType,
        };
        promotions.set(entry.image.resourceId, {
          resourceId: entry.image.resourceId,
          extension,
        });
        for (const node of matchingNodes) {
          commands.push({
            type: 'upsert',
            node: withImageExtension(node, extension),
          });
        }
      }

      const affectedNodeIds = Object.freeze(
        commands
          .filter((command) => command.type === 'upsert')
          .map((command) => command.node.id)
          .sort(codePointCompare),
      );
      this.#commitMutation({
        transactionId: `image-promotion:${this.#createCommandId()}`,
        basisSceneRevision: this.#projectionRevision,
        source: IMAGE_PROMOTION_SOURCE,
        commands,
        affectedNodeIds,
      }, {
        persist: false,
        recordHistory: false,
      });
      this.#promotePendingImages(promotions);
      this.#history.promoteImages(promotions);
      for (const entry of uploaded) {
        entry.image.durableUrl = entry.url;
      }
      this.#activeImports.delete(importId);
      pending.mediaGate?.release();
    } catch (error) {
      const uploadedUrls = uploaded.map((entry) => entry.url);
      void this.#deleteUploadedUrls(uploadedUrls);
      if (!this.#disposed) {
        this.#activeImports.delete(importId);
        this.#reportError(error);
        this.#scheduleRecovery();
      }
    }
  }

  #promotePendingImages(
    promotions: ReadonlyMap<string, TImagePromotion>,
  ): void {
    const rewrite = (
      images: Map<string, TLocalDocumentNodeImage>,
    ): void => {
      for (const [nodeId, node] of images) {
        if (node?.kind !== 'image') continue;
        const promotion = promotions.get(node.resourceId);
        if (promotion === undefined) continue;
        images.set(nodeId, withImageExtension(node, promotion.extension));
      }
    };
    for (const pending of this.#pendingByTransactionId.values()) {
      rewrite(pending.before);
      rewrite(pending.after);
      pending.plan = this.#planFromNodes(pending.before, pending.after);
    }
  }

  async #deleteUploadedUrls(urls: readonly string[]): Promise<void> {
    if (this.#image === null) return;
    await Promise.all(urls.map(async (url) => {
      try {
        await this.#image!.deleteImage({ url });
      } catch {
        // Deletion is best effort; a failed cleanup must not strand recovery.
      }
    }));
  }

  #scheduleRecovery(cause?: unknown): void {
    if (cause !== undefined) this.#reportError(cause);
    if (this.#recoveryPending || this.#disposed) return;
    this.#observe({
      phase: 'recovery-scheduled',
      priority: 'critical',
      data: {
        errorMessage: cause instanceof Error
          ? cause.message
          : cause === undefined ? '' : String(cause),
      },
    });
    this.#recoveryPending = true;
    this.#outboxGeneration += 1;
    this.#invalidatePending();
    this.#commandTail = Promise.resolve();
    const task = this.#reloadUntilRecovered();
    this.#recoveryTask = task;
    void task.then(() => {
      if (this.#recoveryTask === task) this.#recoveryTask = null;
    });
  }

  async #reloadUntilRecovered(): Promise<void> {
    while (!this.#disposed && this.#recoveryPending) {
      this.#observe({ phase: 'recovery-started', priority: 'critical' });
      try {
        await this.#reload(true);
        this.#recoveryPending = false;
        this.setRuntimeGridPresentation(this.#runtimeGridPresentation);
        this.#observe({ phase: 'recovery-completed', priority: 'critical' });
        return;
      } catch (error) {
        if (this.#disposed) return;
        this.#recoveryPending = true;
        this.#observe({
          phase: 'recovery-failed',
          priority: 'critical',
          data: {
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
        this.#reportError(error);
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  #invalidatePending(): void {
    const invalidated = [...this.#pendingByTransactionId.values()];
    for (const pending of this.#pendingByTransactionId.values()) {
      pending.mediaGate?.release();
    }
    this.#pendingByTransactionId.clear();
    this.#pendingByCommandId.clear();
    this.#activeImports.clear();
    this.#history.clear();
    for (const pending of invalidated) {
      this.#observe({
        phase: 'pending-invalidated',
        priority: 'critical',
        transactionId: pending.transactionId,
        commandId: pending.commandId,
        nodeIds: pending.affectedNodeIds,
      });
    }
  }

  async #reload(clearHistory: boolean): Promise<void> {
    if (this.#reloading) {
      throw new RangeError('Canvas reconciliation is already in progress.');
    }
    this.#reloading = true;
    this.#observe({
      phase: 'reload-started',
      priority: 'high',
      data: { clearHistory },
    });
    try {
      const snapshot = await this.#transport.getSnapshot({ canvasId: this.#canvasId });
      if (this.#disposed) return;
      if (this.#committing) {
        throw new RangeError('Cannot reload the canvas during a local commit.');
      }
      const engine = this.#engine;
      if (engine === null) return;

      const acceptedItems = new Map(
        snapshot.items.map((item) => [item.id, item]),
      );
      const projectedSnapshot = fnRuntimeSceneSnapshot({
        authoredNodes: snapshot.items.map((item) => item.item),
        grid: this.#runtimeGridPresentation,
      });
      const optimisticNodes = new Map(
        projectedSnapshot.nodes.map((node) => [node.id, node]),
      );
      const nextImageIndex = this.#buildImageDocumentIndex(optimisticNodes);

      const previousRevision = this.#acceptedRevision;
      const previousItems = new Map(this.#acceptedItems);
      const previousNodes = this.#optimisticNodes;
      const previousImageIndex: TImageDocumentIndex = {
        nodeCounts: this.#imageNodeCounts,
        descriptorCounts: this.#imageDescriptorCounts,
      };
      try {
        this.#syncDurableResources(nextImageIndex);
        this.#acceptedRevision = snapshot.revision;
        this.#acceptedItems.clear();
        for (const [id, item] of acceptedItems) this.#acceptedItems.set(id, item);
        this.#optimisticNodes = optimisticNodes;
        this.#imageNodeCounts = nextImageIndex.nodeCounts;
        this.#imageDescriptorCounts = nextImageIndex.descriptorCounts;
        engine.scene.replace(projectedSnapshot, { source: SNAPSHOT_SCENE_SOURCE });
        this.#projectionRevision = engine.scene.revision;
      } catch (error) {
        this.#acceptedRevision = previousRevision;
        this.#acceptedItems.clear();
        for (const [id, item] of previousItems) this.#acceptedItems.set(id, item);
        this.#optimisticNodes = previousNodes;
        this.#imageNodeCounts = previousImageIndex.nodeCounts;
        this.#imageDescriptorCounts = previousImageIndex.descriptorCounts;
        try {
          this.#syncDurableResources(previousImageIndex);
        } catch (restoreError) {
          this.#reportError(restoreError);
        }
        throw error;
      }
      if (clearHistory) this.#history.clear();
      this.#releaseOrphanLocalImages(true);
      this.#observe({
        phase: 'reload-completed',
        priority: 'high',
        data: {
          clearHistory,
          itemCount: this.#acceptedItems.size,
        },
      });
    } catch (error) {
      this.#observe({
        phase: 'reload-failed',
        priority: 'critical',
        data: {
          clearHistory,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      this.#reloading = false;
    }
  }

  #buildImageDocumentIndex(
    nodes: ReadonlyMap<string, TSceneNode>,
  ): TImageDocumentIndex {
    const index: TImageDocumentIndex = {
      nodeCounts: new Map(),
      descriptorCounts: new Map(),
    };
    for (const node of nodes.values()) {
      if (node.kind !== 'image') continue;
      adjustCount(index.nodeCounts, node.resourceId, 1);
      const extension = fnReadCanvasImageExtension(node);
      if (extension === null) continue;
      adjustDescriptorCount(
        index.descriptorCounts,
        node.resourceId,
        extension,
        1,
      );
    }
    assertCompatibleImageDescriptors(index.descriptorCounts);
    return index;
  }

  #stageImageIndexChanges(
    before: ReadonlyMap<string, TLocalDocumentNodeImage>,
    after: ReadonlyMap<string, TLocalDocumentNodeImage>,
  ): TImageIndexPatch {
    const touchedResourceIds = new Set<string>();
    for (const node of before.values()) {
      if (node?.kind === 'image') touchedResourceIds.add(node.resourceId);
    }
    for (const node of after.values()) {
      if (node?.kind === 'image') touchedResourceIds.add(node.resourceId);
    }

    const nodeCounts = new Map<string, number>();
    const descriptorCounts = new Map<
      string,
      Map<string, TIndexedImageDescriptor>
    >();
    const registeredBefore = new Map<string, string | null>();
    for (const resourceId of touchedResourceIds) {
      nodeCounts.set(resourceId, this.#imageNodeCounts.get(resourceId) ?? 0);
      descriptorCounts.set(
        resourceId,
        cloneDescriptorBucket(this.#imageDescriptorCounts.get(resourceId)),
      );
      registeredBefore.set(
        resourceId,
        this.#registeredDescriptorKey(
          resourceId,
          this.#imageDescriptorCounts.get(resourceId),
        ),
      );
    }

    const removeNode = (node: TLocalDocumentNodeImage): void => {
      if (node?.kind !== 'image') return;
      adjustCount(nodeCounts, node.resourceId, -1);
      const extension = fnReadCanvasImageExtension(node);
      if (extension !== null) {
        adjustDescriptorCount(
          descriptorCounts,
          node.resourceId,
          extension,
          -1,
        );
      }
    };
    const addNode = (node: TLocalDocumentNodeImage): void => {
      if (node?.kind !== 'image') return;
      adjustCount(nodeCounts, node.resourceId, 1);
      const extension = fnReadCanvasImageExtension(node);
      if (extension !== null) {
        adjustDescriptorCount(
          descriptorCounts,
          node.resourceId,
          extension,
          1,
        );
      }
    };
    for (const node of before.values()) removeNode(node);
    for (const node of after.values()) addNode(node);
    for (const resourceId of touchedResourceIds) {
      if (!nodeCounts.has(resourceId)) nodeCounts.set(resourceId, 0);
      if (!descriptorCounts.has(resourceId)) {
        descriptorCounts.set(resourceId, new Map());
      }
    }
    assertCompatibleImageDescriptors(descriptorCounts);

    let registrationsChanged = false;
    for (const resourceId of touchedResourceIds) {
      if (
        registeredBefore.get(resourceId)
        !== this.#registeredDescriptorKey(
          resourceId,
          descriptorCounts.get(resourceId),
        )
      ) {
        registrationsChanged = true;
        break;
      }
    }
    return {
      nodeCounts,
      descriptorCounts,
      registrationsChanged,
    };
  }

  #applyImageIndexPatch(patch: TImageIndexPatch): void {
    for (const [resourceId, count] of patch.nodeCounts) {
      if (count === 0) this.#imageNodeCounts.delete(resourceId);
      else this.#imageNodeCounts.set(resourceId, count);
    }
    for (const [resourceId, bucket] of patch.descriptorCounts) {
      if (bucket.size === 0) this.#imageDescriptorCounts.delete(resourceId);
      else this.#imageDescriptorCounts.set(resourceId, bucket);
    }
  }

  #registeredDescriptorKey(
    resourceId: string,
    bucket: ReadonlyMap<string, TIndexedImageDescriptor> | undefined,
  ): string | null {
    if (this.#localImages.has(resourceId) || bucket?.size !== 1) return null;
    return bucket.keys().next().value ?? null;
  }

  #syncDurableResources(
    index: TImageDocumentIndex = {
      nodeCounts: this.#imageNodeCounts,
      descriptorCounts: this.#imageDescriptorCounts,
    },
  ): void {
    const owner = this.#resourceRegistrations;
    if (owner === null) return;
    const claims: Array<{
      descriptor: {
        id: string;
        type: 'image';
        url: string;
        mimeType: string;
      };
    }> = [];
    assertCompatibleImageDescriptors(index.descriptorCounts);
    for (const [resourceId, bucket] of index.descriptorCounts) {
      if (this.#localImages.has(resourceId) || bucket.size === 0) continue;
      const indexed = bucket.values().next().value;
      if (indexed === undefined) continue;
      claims.push({
        descriptor: {
          id: resourceId,
          type: 'image',
          url: indexed.extension.url,
          mimeType: indexed.extension.mimeType,
        },
      });
    }
    owner.replace(claims);
  }

  #localImageReachable(resourceId: string): boolean {
    if ((this.#imageNodeCounts.get(resourceId) ?? 0) > 0) return true;
    if (this.#history.referencesResource(resourceId)) return true;
    for (const pending of this.#pendingByTransactionId.values()) {
      if (
        nodeImagesReferenceResource(pending.before, resourceId)
        || nodeImagesReferenceResource(pending.after, resourceId)
      ) return true;
    }
    for (const pending of this.#inFlightTransactions) {
      if (pending.ownedImageResourceIds.includes(resourceId)) return true;
    }
    return false;
  }

  #releaseOrphanLocalImages(deleteDurable: boolean): void {
    for (const resourceId of [...this.#localImages.keys()]) {
      if (this.#localImageReachable(resourceId)) continue;
      this.#releaseLocalImage(resourceId, deleteDurable);
    }
  }

  #releaseLocalImage(resourceId: string, deleteDurable: boolean): void {
    const image = this.#localImages.get(resourceId);
    if (image === undefined) return;
    this.#localImages.delete(resourceId);
    try {
      if (this.#engine?.resources.state(resourceId) !== null) {
        this.#engine?.resources.release(
          resourceId,
          DOCUMENT_IMAGE_RESOURCE_OWNER,
        );
      }
    } catch (error) {
      this.#reportError(error);
    }
    if (
      deleteDurable
      && image.durableUrl !== null
      && this.#image !== null
    ) {
      try {
        void this.#image.deleteImage({ url: image.durableUrl }).catch(
          (error) => this.#reportError(error),
        );
      } catch (error) {
        this.#reportError(error);
      }
    }
  }

  async #consumeEvents(generation: number): Promise<void> {
    while (!this.#disposed && generation === this.#generation) {
      if (this.#recoveryPending || this.#reloading) {
        await (this.#recoveryTask ?? Promise.resolve());
        continue;
      }
      let restartForRecovery = false;
      let iterator: AsyncIterator<TCanvasEvent> | null = null;
      try {
        const iterable = this.#transport.subscribe({
          canvasId: this.#canvasId,
          afterRevision: this.#acceptedRevision,
        });
        iterator = iterable[Symbol.asyncIterator]();
        this.#eventIterator = iterator;
        while (!this.#disposed && generation === this.#generation) {
          const next = await iterator.next();
          if (next.done) break;
          if (this.#recoveryPending || this.#reloading) {
            restartForRecovery = true;
            break;
          }
          const event = next.value;
          if (event.type === 'items-changed') {
            try {
              this.#acceptEvent(event, null);
            } catch (error) {
              if (!this.#disposed) {
                this.#scheduleRecovery(error);
                restartForRecovery = true;
              }
            }
            if (restartForRecovery) break;
            continue;
          }
          this.#scheduleRecovery();
          restartForRecovery = true;
          break;
        }
      } catch (error) {
        if (!this.#disposed && generation === this.#generation) {
          this.#reportError(error);
        }
      } finally {
        if (this.#eventIterator === iterator) this.#eventIterator = null;
        if (restartForRecovery && iterator !== null) {
          try {
            const closing = iterator.return?.();
            void closing?.catch(() => undefined);
          } catch {
            // Recovery proceeds from a fresh subscription even if close fails.
          }
        }
      }
      if (!this.#disposed && generation === this.#generation) {
        if (restartForRecovery) {
          await (this.#recoveryTask ?? Promise.resolve());
          continue;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  #reportError(error: unknown): void {
    try {
      this.#onError(error);
    } catch {
      // Error observers are isolated from document state transitions.
    }
  }

  #observe(
    observation: Omit<
      TCanvasDocumentObservation,
      | 'acceptedRevision'
      | 'projectedSceneRevision'
      | 'pendingCount'
    >,
  ): void {
    if (this.#observeDocument === null) return;
    try {
      this.#observeDocument(Object.freeze({
        ...observation,
        acceptedRevision: this.#acceptedRevision,
        projectedSceneRevision: this.#projectionRevision,
        pendingCount: this.#pendingByTransactionId.size,
      }));
    } catch {
      // Diagnostics are isolated from all document behavior.
    }
  }

  #assertReadyForCommit(): void {
    if (this.#disposed) {
      throw new RangeError('Canvas document service is disposed.');
    }
    if (this.#engine === null) {
      throw new RangeError('Canvas document service is not started.');
    }
    if (this.#committing) {
      throw new RangeError('Canvas document mutation is not reentrant.');
    }
    if (this.#recoveryPending || this.#reloading) {
      throw new RangeError('Canvas document reconciliation is in progress.');
    }
  }

  #assertAuthoredMutation(request: TEditorSceneMutationRequest): void {
    const hasRuntimeParent = request.commands.some((command) => {
      const parentId = command.type === 'upsert'
        ? command.node.parentId
        : command.type === 'reparent' ? command.parentId : null;
      return parentId === CANVAS_RUNTIME_BACKGROUND_LAYER_ID
        || parentId === CANVAS_RUNTIME_GRID_NODE_ID;
    });
    if (
      hasRuntimeParent
      || request.affectedNodeIds.some((id) => RESERVED_RUNTIME_NODE_IDS.has(id))
    ) throw new RangeError('Editor mutations cannot target runtime canvas nodes.');
  }
}

function imageDescriptorKey(extension: TCanvasImageExtensionV1): string {
  return JSON.stringify([extension.url, extension.mimeType]);
}

function cloneDescriptorBucket(
  bucket: ReadonlyMap<string, TIndexedImageDescriptor> | undefined,
): Map<string, TIndexedImageDescriptor> {
  return new Map(
    [...(bucket ?? [])].map(([key, indexed]) => [
      key,
      { extension: indexed.extension, count: indexed.count },
    ]),
  );
}

function adjustCount(
  counts: Map<string, number>,
  resourceId: string,
  delta: 1 | -1,
): void {
  const next = (counts.get(resourceId) ?? 0) + delta;
  if (next < 0) {
    throw new RangeError(
      `Image resource '${resourceId}' has an invalid document reference count.`,
    );
  }
  if (next === 0) counts.delete(resourceId);
  else counts.set(resourceId, next);
}

function adjustDescriptorCount(
  descriptors: Map<string, Map<string, TIndexedImageDescriptor>>,
  resourceId: string,
  extension: TCanvasImageExtensionV1,
  delta: 1 | -1,
): void {
  const bucket = descriptors.get(resourceId) ?? new Map();
  const key = imageDescriptorKey(extension);
  const existing = bucket.get(key);
  const next = (existing?.count ?? 0) + delta;
  if (next < 0) {
    throw new RangeError(
      `Image resource '${resourceId}' has an invalid descriptor reference count.`,
    );
  }
  if (next === 0) bucket.delete(key);
  else bucket.set(key, { extension, count: next });
  if (bucket.size === 0) descriptors.delete(resourceId);
  else descriptors.set(resourceId, bucket);
}

function assertCompatibleImageDescriptors(
  descriptors: ReadonlyMap<
    string,
    ReadonlyMap<string, TIndexedImageDescriptor>
  >,
): void {
  for (const [resourceId, bucket] of descriptors) {
    if (bucket.size <= 1) continue;
    throw new Error(
      `Image resource '${resourceId}' has conflicting durable descriptors.`,
    );
  }
}

function createMediaGate(): TMediaGate {
  let released = false;
  let releaseWait!: () => void;
  const wait = new Promise<void>((resolve) => {
    releaseWait = resolve;
  });
  return Object.freeze({
    wait,
    release() {
      if (released) return;
      released = true;
      releaseWait();
    },
  });
}

function withImageExtension(
  node: Readonly<TImageNode>,
  extension: TCanvasImageExtensionV1,
): TImageNode {
  return {
    ...node,
    extensions: {
      ...(node.extensions ?? {}),
      [CANVAS_IMAGE_EXTENSION_KEY]: extension,
    },
  };
}

function nodeImagesReferenceResource(
  images: ReadonlyMap<string, TLocalDocumentNodeImage>,
  resourceId: string,
): boolean {
  for (const node of images.values()) {
    if (node?.kind === 'image' && node.resourceId === resourceId) return true;
  }
  return false;
}

function supportedImageMimeType(value: string): TImageUploadFormat {
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(value as TImageUploadFormat)) {
    throw new RangeError(`Unsupported canvas image MIME type '${value}'.`);
  }
  return value as TImageUploadFormat;
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 256
  ) {
    throw new RangeError(`${label} must contain 1–256 UTF-16 code units.`);
  }
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
