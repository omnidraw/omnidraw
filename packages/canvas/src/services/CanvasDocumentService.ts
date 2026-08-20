import type {
  IInfiniteCanvasEngine,
  IResourceRegistrationOwner,
  TImageNode,
  TResourceId,
  TSceneNode,
  TSerializedSceneCommand,
} from '@omnidraw/cangine';
import {
  createSceneReductionState,
  reduceSerializedSceneCommands,
  sceneReductionStateSnapshot,
  type TSceneReductionState,
  type TSerializedSceneCommandReduction,
} from '@omnidraw/cangine/scene';
import type {
  IEditorHistory,
  IEditorImageImportPort,
  IEditorSceneMutationPort,
  TEditorSceneMutationReceipt,
  TEditorSceneMutationRequest,
  TPreparedImageImportRequest,
} from '@omnidraw/cangine/editor';
import {
  CanvasDocumentCodec,
  CanvasEventCodec,
  CanvasItemPageCodec,
  CanvasQueryCodec,
  CANVAS_IMAGE_EXTENSION_KEY,
  fnReadCanvasImageExtension,
  type TCanvasCommand,
  type TCanvasDocumentTransport,
  type TCanvasImageExtensionV1,
  type TCanvasItemPage,
  type TCanvasItemQuery,
  type TCanvasItemSnapshot,
  type TCanvasItemsChangedEvent,
  type TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { Deferred, Effect } from 'effect';
import type { TCanvasImagePort, TCanvasWaitPort, TImageUploadFormat } from '../types';
import {
  fnRuntimeCanvasNode,
  fnSceneNodesEqual,
} from './fn.scene-node-diff';
import {
  fnBoundedSceneChanges,
  fnSceneChangeImages,
  type TSceneNodeImage,
} from './fn.scene-reduction';
import {
  fnAuthoredSemanticCanvasNode,
} from '../fn.semantic-canvas-style';
import {
  CANVAS_RUNTIME_CONTENT_LAYER_ID,
  fnCanvasNodesToCangineSnapshot,
} from '../internal/cangine-contract-adapter';
import {
  fnAssertCompatibleImageDescriptors,
  fnBuildImageDocumentIndex,
  fnPlanCanvasOperations,
  fnPlanSceneNodeImages,
  fnStageImageIndexChanges,
  type TCanvasCommandPlan,
  type TImageDocumentIndex,
  type TImageIndexPatch,
  type TIndexedImageDescriptor,
} from './fn.document-policy';
import { CanvasSyncSupervisor } from './CanvasSyncSupervisor';

const SERVER_SCENE_SOURCE = 'omnidraw:server';
const SNAPSHOT_SCENE_SOURCE = 'omnidraw:snapshot';
const UNDO_SCENE_SOURCE = 'omnidraw:undo';
const REDO_SCENE_SOURCE = 'omnidraw:redo';
const IMAGE_PROMOTION_SOURCE = 'omnidraw:image-promotion';
const THEME_PROJECTION_SOURCE = 'omnidraw:theme-projection';
const LOCAL_HISTORY_CAPACITY = 100;
const DOCUMENT_IMAGE_RESOURCE_OWNER = 'omnidraw:document-images';
const DOCUMENT_IMAGE_REGISTRATION_OWNER = 'omnidraw:document-image-urls';
const SUPPORTED_IMAGE_MIME_TYPES = new Set<TImageUploadFormat>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
export type TCanvasDocumentServiceOptions = Readonly<{
  canvasId: string;
  transport: TCanvasDocumentTransport;
  createCommandId(): string;
  wait: TCanvasWaitPort;
  image?: TCanvasImagePort;
  projectNode?(node: TSceneNode): TSceneNode;
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
  before: ReadonlyMap<string, TSceneNodeImage>;
  after: ReadonlyMap<string, TSceneNodeImage>;
  coalesceKey?: string;
}>;

type TSceneProjection = Readonly<{
  state: TSceneReductionState;
  revision: number;
}>;

type TIncrementalSceneReduction = Extract<
  TSerializedSceneCommandReduction,
  Readonly<{ mode: 'incremental' }>
>;

type TMediaGate = Readonly<{
  wait: Effect.Effect<void>;
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
  before: Map<string, TSceneNodeImage>;
  after: Map<string, TSceneNodeImage>;
  plan: TCanvasCommandPlan;
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
      images: ReadonlyMap<string, TSceneNodeImage>,
    ): ReadonlyMap<string, TSceneNodeImage> => {
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
      images: ReadonlyMap<string, TSceneNodeImage>,
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
  #projectNode: (node: TSceneNode) => TSceneNode;
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
  readonly #authoredListeners = new Set<() => void>();
  readonly #sync: CanvasSyncSupervisor;
  #imageNodeCounts = new Map<string, number>();
  #imageDescriptorCounts = new Map<
    string,
    Map<string, TIndexedImageDescriptor>
  >();
  #optimisticNodes: ReadonlyMap<string, TSceneNode> = new Map();
  #authoredNodes: ReadonlyMap<string, TSceneNode> = new Map();
  #projection: TSceneProjection | null = null;
  #engine: IInfiniteCanvasEngine | null = null;
  #resourceRegistrations: IResourceRegistrationOwner | null = null;
  #acceptedRevision = 0;
  #disposed = false;
  #committing = false;
  #recoveryPending = false;
  #reloading = false;
  #recoveryGate: Deferred.Deferred<void> | null = null;
  constructor(options: TCanvasDocumentServiceOptions) {
    this.#canvasId = options.canvasId;
    this.#transport = options.transport;
    this.#createCommandId = options.createCommandId;
    this.#image = options.image ?? null;
    this.#projectNode = options.projectNode ?? ((node) => node);
    this.#onError = options.onError ?? (() => undefined);
    this.#observeDocument = options.observe ?? null;
    this.#sync = new CanvasSyncSupervisor({
      canvasId: this.#canvasId,
      transport: this.#transport,
      wait: options.wait,
      acceptedRevision: () => this.#acceptedRevision,
      recoveryActive: () => this.#recoveryPending || this.#reloading,
      awaitRecoveryEffect: () => this.#awaitRecoveryEffect(),
      acceptEvent: (event) => this.#acceptEvent(event, null),
      scheduleRecovery: (cause) => this.#scheduleRecovery(cause),
      reportError: (error) => this.#reportError(error),
    });
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
    return this.#projection?.revision ?? 0;
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

  authoredNode(nodeId: string): Readonly<TSceneNode> | null {
    return this.#authoredNodes.get(nodeId) ?? null;
  }

  authoredNodes(): readonly Readonly<TSceneNode>[] {
    return Object.freeze([...this.#authoredNodes.values()]);
  }

  /** Internal coherent-document signal used by renderer-neutral extensions. */
  subscribeAuthored(listener: () => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#authoredListeners.add(listener);
    return () => { this.#authoredListeners.delete(listener); };
  }

  async query(query: TCanvasItemQuery): Promise<TCanvasItemPage> {
    const admitted = CanvasQueryCodec.decode(query);
    if (admitted.canvasId !== this.#canvasId) {
      throw new RangeError(
        `Canvas query targets '${admitted.canvasId}', expected '${this.#canvasId}'.`,
      );
    }
    return CanvasItemPageCodec.decode(await this.#transport.query(admitted));
  }

  /**
   * Starts the authoritative request before an engine is available. The
   * decoded value remains inert until `start` installs it atomically.
   */
  loadInitialSnapshotEffect(): Effect.Effect<TCanvasSnapshot, unknown> {
    if (this.#disposed) {
      return Effect.fail(new Error('Canvas document service is disposed.'));
    }
    return this.#fetchSnapshotEffect();
  }

  /** Re-resolves semantic paint without changing the durable canvas revision. */
  reproject(projectNode: (node: TSceneNode) => TSceneNode): boolean {
    if (this.#disposed) {
      throw new RangeError('Canvas document service is disposed.');
    }
    const previousProjectNode = this.#projectNode;
    this.#projectNode = projectNode;
    if (
      this.#engine === null
      || this.#projection === null
      || this.#recoveryPending
      || this.#reloading
    ) {
      return false;
    }
    try {
      this.#assertReadyForCommit();
      const commands = [...this.#authoredNodes.values()]
        .map((node): TSerializedSceneCommand => ({
          type: 'upsert',
          node: projectNode(node),
        }))
        .filter((command) => (
          command.type === 'upsert'
          && !fnSceneNodesEqual(
            this.#optimisticNodes.get(command.node.id) ?? null,
            command.node,
          )
        ));
      if (commands.length === 0) return false;
      this.#projectSceneCommands(commands, THEME_PROJECTION_SOURCE);
      return true;
    } catch (error) {
      this.#projectNode = previousProjectNode;
      throw error;
    }
  }

  async start(
    engine: IInfiniteCanvasEngine,
    initialSnapshot?: TCanvasSnapshot,
  ): Promise<void> {
    if (this.#disposed) throw new Error('Canvas document service is disposed.');
    if (this.#engine) throw new Error('Canvas document service is already started.');
    this.#engine = engine;
    try {
      this.#resourceRegistrations = engine.resources.createRegistrationOwner(
        DOCUMENT_IMAGE_REGISTRATION_OWNER,
      );
      await this.#sync.run(initialSnapshot === undefined
        ? this.#reloadEffect(true)
        : Effect.try({
            try: () => this.#installSnapshot(initialSnapshot, true),
            catch: (cause) => cause,
          }));
    } catch (error) {
      try {
        this.#resourceRegistrations?.destroy();
      } catch (destroyError) {
        this.#reportError(destroyError);
      }
      this.#resourceRegistrations = null;
      this.#projection = null;
      this.#engine = null;
      throw error;
    }
    this.#sync.startEventStream();
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
    this.#sync.invalidateOutbox();
    const queuedOwnedMedia = [...this.#pendingByTransactionId.values()]
      .filter((pending) => pending.dispatchState === 'queued');
    this.#invalidatePending();
    await this.#sync.run(Effect.all(
      queuedOwnedMedia.map((pending) => this.#deletePendingOwnedMediaEffect(pending)),
      { concurrency: 'unbounded', discard: true },
    ));
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
    this.#authoredNodes = new Map();
    this.#authoredListeners.clear();
    this.#projection = null;
    this.#imageNodeCounts.clear();
    this.#imageDescriptorCounts.clear();
    this.#engine = null;
    await this.#sync.dispose();
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
      request.basisSceneRevision !== this.projectedSceneRevision
      || request.basisSceneRevision !== this.#engine!.scene.revision
    ) {
      throw new RangeError(
        `Stale editor transaction basis ${request.basisSceneRevision}; `
          + `document and engine are at ${this.projectedSceneRevision} and `
          + `${this.#engine!.scene.revision}.`,
      );
    }
    this.#assertAuthoredMutation(request);

    this.#committing = true;
    let pending: TPendingTransaction | null = null;
    try {
      const projection = this.#projection;
      if (projection === null) {
        throw new RangeError('Canvas scene projection is not initialized.');
      }
      const reduction = reduceSerializedSceneCommands(
        projection.state,
        request.commands,
      );
      if (reduction.mode !== 'incremental') {
        throw new RangeError(
          'replace-snapshot is not an incremental local document command.',
        );
      }
      const bounded = fnBoundedSceneChanges(
        reduction.changes,
        request.affectedNodeIds,
      );
      if (reduction.changes.length === 0) {
        throw new RangeError('Editor transaction has no local document change.');
      }
      const authoredBefore = new Map<string, TSceneNodeImage>();
      const authoredAfter = new Map<string, TSceneNodeImage>();
      for (const nodeId of bounded.nodeIds) {
        const previousAuthored = this.#authoredNodes.get(nodeId) ?? null;
        authoredBefore.set(nodeId, previousAuthored);
        authoredAfter.set(nodeId, fnAuthoredSemanticCanvasNode({
          previousAuthored,
          nextProjected: bounded.after.get(nodeId) ?? null,
        }));
      }
      this.#assertPersistableImages(
        authoredAfter,
        new Set(options.preparedImageResourceIds ?? []),
      );
      const imageIndexPatch = this.#stageImageIndexChanges(authoredBefore, authoredAfter);
      const plan = fnPlanCanvasOperations(authoredBefore, authoredAfter);
      if (plan.operations.length === 0) {
        throw new RangeError('Editor transaction has no durable canvas operation.');
      }
      this.#observe({
        phase: 'durable-plan-prepared',
        priority: 'critical',
        transactionId: request.transactionId,
        nodeIds: bounded.nodeIds,
        data: {
          operationCount: plan.operations.length,
          preconditionCount: plan.preconditions.length,
          operationTypes: plan.operations.map((operation) => operation.type),
        },
      });
      const historyEntry: THistoryEntry = {
        before: authoredBefore,
        after: authoredAfter,
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
          affectedNodeIds: bounded.nodeIds,
          commandId,
          before: new Map(authoredBefore),
          after: new Map(authoredAfter),
          plan,
          mediaGate: options.mediaGate ?? null,
          ownedImageResourceIds: Object.freeze([
            ...(options.preparedImageResourceIds ?? []),
          ]),
          dispatchState: 'queued',
          ownedMediaCleanupScheduled: false,
        };
      }

      try {
        this.#applySceneReduction(
          request.commands,
          reduction,
          request.source,
          request.coalesceKey,
        );
        this.#applyAuthoredNodeImages(authoredAfter);
        this.#publishAuthoredChange();
      } catch (error) {
        this.#scheduleRecovery(error);
        throw error;
      }
      const expectedRevision = request.basisSceneRevision + 1;
      this.#observe({
        phase: 'projection-applied',
        priority: 'critical',
        transactionId: request.transactionId,
        ...(pending === null ? {} : { commandId: pending.commandId }),
        nodeIds: bounded.nodeIds,
        data: {
          source: request.source,
          successorRevision: expectedRevision,
        },
      });
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
    after: ReadonlyMap<string, TSceneNodeImage>,
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
        `Image node '${node.id}' has no durable Omnidraw image descriptor.`,
      );
    }
  }

  #performHistory(
    entry: THistoryEntry,
    direction: 'undo' | 'redo',
  ): void {
    const desired = direction === 'undo' ? entry.before : entry.after;
    const planned = fnPlanSceneNodeImages({
      desired,
      current: this.#authoredNodes,
      projectNode: this.#projectNode,
    });
    const request: TEditorSceneMutationRequest = {
      transactionId: `history:${this.#createCommandId()}`,
      basisSceneRevision: this.projectedSceneRevision,
      source: direction === 'undo' ? UNDO_SCENE_SOURCE : REDO_SCENE_SOURCE,
      commands: planned.commands,
      affectedNodeIds: planned.affectedNodeIds,
    };
    this.#commitMutation(request, {
      persist: true,
      recordHistory: false,
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
    const outboxGeneration = this.#sync.outboxGeneration;
    const self = this;
    const operation = Effect.gen(function*() {
      if (pending.mediaGate !== null) {
        yield* pending.mediaGate.wait;
      }
      if (self.#disposed) {
        yield* self.#deletePendingOwnedMediaEffect(pending);
        return;
      }
      if (
        !self.#sync.isOutboxGeneration(outboxGeneration)
        || self.#pendingByTransactionId.get(pending.transactionId) !== pending
      ) return;
      pending.dispatchState = 'executing';
      self.#inFlightTransactions.add(pending);
      const command = yield* Effect.try({
        try: () => self.#commandForPending(pending),
        catch: (cause) => cause,
      });
      yield* Effect.sync(() => {
        self.#observe({
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
      });
      const rawEvent = yield* Effect.tryPromise({
        try: () => self.#transport.execute(command),
        catch: (cause) => cause,
      });
      const event = yield* Effect.try({
        try: () => CanvasEventCodec.decode(rawEvent),
        catch: (cause) => cause,
      });
      if (event.type !== 'items-changed') {
        return yield* Effect.fail(
          new TypeError('Canvas command acknowledgement must change items.'),
        );
      }
      if (self.#disposed) return;
      if (
        !self.#sync.isOutboxGeneration(outboxGeneration)
        || self.#pendingByTransactionId.get(pending.transactionId) !== pending
      ) {
        yield* self.#acceptLateCommittedEventEffect(event);
      } else {
        const accepted = yield* Effect.result(Effect.try({
          try: () => self.#acceptEvent(event, pending),
          catch: (cause) => cause,
        }));
        if (accepted._tag === 'Failure') {
          yield* Effect.sync(() => {
            self.#observe({
              phase: 'acknowledgement-rejected',
              priority: 'critical',
              transactionId: pending.transactionId,
              commandId: pending.commandId,
              nodeIds: pending.affectedNodeIds,
              data: {
                errorMessage: accepted.failure instanceof Error
                  ? accepted.failure.message
                  : String(accepted.failure),
              },
            });
            self.#scheduleRecovery(accepted.failure);
          });
          yield* self.#awaitRecoveryEffect();
        }
      }
      yield* Effect.sync(() => self.#releaseOrphanLocalImages(true));
    }).pipe(
      Effect.catch((error) => Effect.gen(function*() {
        yield* Effect.sync(() => self.#observe({
          phase: 'acknowledgement-rejected',
          priority: 'critical',
          transactionId: pending.transactionId,
          commandId: pending.commandId,
          nodeIds: pending.affectedNodeIds,
          data: {
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        }));
        if (self.#disposed) {
          yield* self.#deletePendingOwnedMediaEffect(pending);
          return;
        }
        if (self.#sync.isOutboxGeneration(outboxGeneration)) {
          yield* Effect.sync(() => self.#scheduleRecovery(error));
        }
        yield* self.#awaitRecoveryEffect();
        yield* Effect.sync(() => self.#releaseOrphanLocalImages(true));
      })),
      Effect.ensuring(Effect.sync(() => {
        self.#inFlightTransactions.delete(pending);
      })),
    );
    this.#sync.forkSerial(
      operation,
      (error) => this.#reportError(error),
    );
  }

  #acceptLateCommittedEventEffect(
    event: TCanvasItemsChangedEvent,
  ): Effect.Effect<void> {
    const self = this;
    return this.#awaitRecoveryEffect().pipe(
      Effect.andThen(Effect.suspend(() => {
        if (self.#disposed) return Effect.void;
        return Effect.try({
          try: () => self.#acceptEvent(event, null),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((error) => Effect.sync(() => {
            self.#scheduleRecovery(error);
          }).pipe(Effect.andThen(self.#awaitRecoveryEffect()))),
        );
      })),
    );
  }

  #deletePendingOwnedMediaEffect(
    pending: TPendingTransaction,
  ): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (pending.ownedMediaCleanupScheduled) return Effect.void;
      pending.ownedMediaCleanupScheduled = true;
      const ownedResources = new Set(pending.ownedImageResourceIds);
      const urls = new Set<string>();
      for (const node of pending.after.values()) {
        if (node?.kind !== 'image' || !ownedResources.has(node.resourceId)) continue;
        const extension = fnReadCanvasImageExtension(node);
        if (extension !== null) urls.add(extension.url);
      }
      return this.#deleteUploadedUrlsEffect([...urls]);
    });
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
    const projection = this.#projection;
    if (
      this.#engine === null
      || projection === null
      || this.#engine.scene.revision !== projection.revision
    ) {
      throw new RangeError('Canvas scene projection is not synchronized.');
    }
    const incomingAuthoredNodes = new Map(
      event.changedItems.map((item) => {
        const node = fnRuntimeCanvasNode(item.item);
        return [node.id, node] as const;
      }),
    );
    const eventCommands: TSerializedSceneCommand[] = [
      ...[...incomingAuthoredNodes.values()].map((node): TSerializedSceneCommand => ({
        type: 'upsert',
        node: this.#projectNode(node),
      })),
      ...event.deletedItemIds.map((itemId): TSerializedSceneCommand => ({
        type: 'remove',
        nodeId: itemId,
        descendants: 'remove',
      })),
    ];
    const eventReduction = reduceSerializedSceneCommands(
      projection.state,
      eventCommands,
    );
    if (eventReduction.mode !== 'incremental') {
      throw new RangeError('Canvas events cannot replace the retained scene.');
    }
    const eventChanges = fnSceneChangeImages(eventReduction.changes);
    const projectedEffectIds = new Set(eventChanges.nodeIds);
    for (const nodeId of eventChanges.nodeIds) {
      if (changedIds.has(nodeId) || !this.#acceptedItems.has(nodeId)) continue;
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
    const clearHistory = (
      pending === null
      && this.#history.overlaps(
        this.#historyEffectIds(event, projectedEffectIds),
      )
    );
    const protectedIds = pending === null
      ? new Set<string>()
      : this.#pendingAffectedIds(pending);
    const commands = protectedIds.size === 0
      ? eventCommands
      : eventCommands.filter((command) => {
        if (command.type === 'upsert') return !protectedIds.has(command.node.id);
        if (command.type === 'remove') return !protectedIds.has(command.nodeId);
        return true;
      });
    const reduction = commands === eventCommands
      ? eventReduction
      : reduceSerializedSceneCommands(projection.state, commands);
    if (reduction.mode !== 'incremental') {
      throw new RangeError('Canvas events cannot replace the retained scene.');
    }
    const bounded = fnSceneChangeImages(reduction.changes);
    const authoredAfter = new Map<string, TSceneNodeImage>();
    for (const command of commands) {
      if (command.type === 'upsert') {
        authoredAfter.set(
          command.node.id,
          incomingAuthoredNodes.get(command.node.id) ?? null,
        );
      } else if (command.type === 'remove') {
        authoredAfter.set(command.nodeId, null);
      }
    }
    for (const nodeId of bounded.nodeIds) {
      if (authoredAfter.has(nodeId)) continue;
      authoredAfter.set(nodeId, fnAuthoredSemanticCanvasNode({
        previousAuthored: this.#authoredNodes.get(nodeId) ?? null,
        nextProjected: bounded.after.get(nodeId) ?? null,
      }));
    }
    const authoredBefore = new Map(
      [...authoredAfter.keys()].map((nodeId) => [
        nodeId,
        this.#authoredNodes.get(nodeId) ?? null,
      ]),
    );
    const imageIndexPatch = this.#stageImageIndexChanges(
      authoredBefore,
      authoredAfter,
    );

    if (reduction.state !== projection.state) {
      this.#applySceneReduction(commands, reduction, SERVER_SCENE_SOURCE);
    }
    this.#applyAuthoredNodeImages(authoredAfter);

    for (const item of event.changedItems) this.#acceptedItems.set(item.id, item);
    for (const itemId of event.deletedItemIds) this.#acceptedItems.delete(itemId);
    this.#acceptedRevision = event.revision;
    this.#acceptedCommandIds.add(event.commandId);
    this.#applyImageIndexPatch(imageIndexPatch);
    if (imageIndexPatch.registrationsChanged) this.#syncDurableResources();
    this.#publishAuthoredChange();
    if (clearHistory) this.#history.clear();
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
  ): TIncrementalSceneReduction {
    if (this.#committing) {
      throw new RangeError('Cannot reconcile the scene during a local commit.');
    }
    const projection = this.#projection;
    if (
      this.#engine === null
      || projection === null
      || this.#engine.scene.revision !== projection.revision
    ) {
      throw new RangeError('Canvas scene projection is not synchronized.');
    }
    const reduction = reduceSerializedSceneCommands(projection.state, commands);
    if (reduction.mode !== 'incremental') {
      throw new RangeError(
        'replace-snapshot requires authoritative canvas replacement.',
      );
    }
    if (reduction.state === projection.state) return reduction;
    try {
      this.#applySceneReduction(commands, reduction, source);
    } catch (error) {
      this.#scheduleRecovery(error);
      throw error;
    }
    return reduction;
  }

  #applySceneReduction(
    commands: readonly TSerializedSceneCommand[],
    reduction: TIncrementalSceneReduction,
    source: string,
    coalesceKey?: string,
  ): void {
    const engine = this.#engine;
    const projection = this.#projection;
    if (
      engine === null
      || projection === null
      || engine.scene.revision !== projection.revision
    ) {
      throw new RangeError('Canvas scene projection is not synchronized.');
    }
    if (!(this.#optimisticNodes instanceof Map)) {
      throw new TypeError('Canvas optimistic document storage is not mutable.');
    }
    if (reduction.state === projection.state) return;

    const expectedRevision = projection.revision + 1;
    engine.scene.apply(commands, {
      source,
      ...(coalesceKey === undefined ? {} : { coalesceKey }),
    });
    if (engine.scene.revision !== expectedRevision) {
      throw new RangeError(
        'Canvas scene projection did not produce exactly one successor revision.',
      );
    }
    for (const change of reduction.changes) {
      if (
        !fnSceneNodesEqual(
          engine.scene.get(change.nodeId) as TSceneNode | null,
          change.after as TSceneNode | null,
        )
      ) {
        throw new RangeError(
          `Canvas scene projection disagrees for node '${change.nodeId}'.`,
        );
      }
    }

    this.#projection = Object.freeze({
      state: reduction.state,
      revision: expectedRevision,
    });
    for (const change of reduction.changes) {
      if (change.after === null) this.#optimisticNodes.delete(change.nodeId);
      else this.#optimisticNodes.set(change.nodeId, change.after);
    }
    for (const change of reduction.changes) {
      if (
        !fnSceneNodesEqual(
          this.#projection.state.get(change.nodeId) as TSceneNode | null,
          this.#optimisticNodes.get(change.nodeId) ?? null,
        )
      ) {
        throw new RangeError(
          `Canvas reduction state disagrees for node '${change.nodeId}'.`,
        );
      }
    }
  }

  #applyAuthoredNodeImages(
    images: ReadonlyMap<string, TSceneNodeImage>,
  ): void {
    if (!(this.#authoredNodes instanceof Map)) {
      throw new TypeError('Canvas authored document storage is not mutable.');
    }
    for (const [nodeId, node] of images) {
      if (node === null) this.#authoredNodes.delete(nodeId);
      else this.#authoredNodes.set(nodeId, node);
    }
  }

  #publishAuthoredChange(): void {
    for (const listener of [...this.#authoredListeners]) {
      try {
        listener();
      } catch (error) {
        this.#reportError(error);
      }
    }
  }

  #pendingAffectedIds(except: TPendingTransaction | null): Set<string> {
    const result = new Set<string>();
    for (const pending of this.#pendingByTransactionId.values()) {
      if (pending === except) continue;
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
    this.#sync.fork(
      this.#uploadPreparedImportEffect(importId, pending, images),
      (error) => {
        this.#reportError(error);
        this.#scheduleRecovery();
      },
    );
  }

  #uploadPreparedImportEffect(
    importId: string,
    pending: TPendingTransaction,
    images: readonly TLocalImage[],
  ): Effect.Effect<void> {
    const self = this;
    const uploaded: Array<Readonly<{
      image: TLocalImage;
      url: string;
    }>> = [];
    const uploadedUrls = (): readonly string[] => (
      uploaded.map((entry) => entry.url)
    );
    const program = Effect.gen(function*() {
      for (const image of images) {
        const buffer = yield* Effect.tryPromise({
          try: () => image.blob.arrayBuffer(),
          catch: (cause) => cause,
        });
        const result = yield* Effect.tryPromise({
          try: () => self.#image!.uploadImage({
            data: new Uint8Array(buffer),
            mime_type: image.mimeType,
          }),
          catch: (cause) => cause,
        });
        if (
          typeof result.url !== 'string'
          || result.url.trim().length === 0
        ) {
          return yield* Effect.fail(
            new TypeError('Canvas image upload returned an invalid URL.'),
          );
        }
        uploaded.push({ image, url: result.url });
      }
      if (
        self.#disposed
        || self.#activeImports.get(importId)?.transactionId
          !== pending.transactionId
        || self.#pendingByTransactionId.get(pending.transactionId) !== pending
      ) {
        self.#scheduleUploadedUrlDeletion(uploadedUrls());
        return;
      }

      const promotions = new Map<string, TImagePromotion>();
      const commands: TSerializedSceneCommand[] = [];
      for (const entry of uploaded) {
        const matchingNodes = [...self.#optimisticNodes.values()].filter(
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
      yield* Effect.try({
        try: () => self.#commitMutation({
          transactionId: `image-promotion:${self.#createCommandId()}`,
          basisSceneRevision: self.projectedSceneRevision,
          source: IMAGE_PROMOTION_SOURCE,
          commands,
          affectedNodeIds,
        }, {
          persist: false,
          recordHistory: false,
        }),
        catch: (cause) => cause,
      });
      yield* Effect.sync(() => {
        self.#promotePendingImages(promotions);
        self.#history.promoteImages(promotions);
        for (const entry of uploaded) entry.image.durableUrl = entry.url;
        self.#activeImports.delete(importId);
        pending.mediaGate?.release();
      });
    });
    return program.pipe(
      Effect.catch((error) => Effect.sync(() => {
        self.#scheduleUploadedUrlDeletion(uploadedUrls());
        if (self.#disposed) return;
        self.#activeImports.delete(importId);
        self.#reportError(error);
        self.#scheduleRecovery();
      })),
      Effect.onInterrupt(() => self.#deleteUploadedUrlsEffect(uploadedUrls())),
    );
  }

  #promotePendingImages(
    promotions: ReadonlyMap<string, TImagePromotion>,
  ): void {
    const rewrite = (
      images: Map<string, TSceneNodeImage>,
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
      pending.plan = fnPlanCanvasOperations(pending.before, pending.after);
    }
  }

  #scheduleUploadedUrlDeletion(urls: readonly string[]): void {
    if (urls.length === 0 || this.#image === null) return;
    try {
      this.#sync.fork(this.#deleteUploadedUrlsEffect(urls));
    } catch (error) {
      if (!this.#disposed) this.#reportError(error);
    }
  }

  #deleteUploadedUrlsEffect(urls: readonly string[]): Effect.Effect<void> {
    const image = this.#image;
    if (image === null || urls.length === 0) return Effect.void;
    return Effect.forEach(
      new Set(urls),
      (url) => Effect.tryPromise({
        try: () => image.deleteImage({ url }),
        catch: (cause) => cause,
      }).pipe(
        // Deletion is best effort; a failed cleanup must not strand recovery.
        Effect.catch(() => Effect.void),
      ),
      { concurrency: 'unbounded', discard: true },
    );
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
    this.#sync.invalidateOutbox();
    this.#invalidatePending();
    const gate = Deferred.makeUnsafe<void>();
    this.#recoveryGate = gate;
    this.#sync.fork(
      this.#reloadUntilRecoveredEffect().pipe(
        Effect.ensuring(Effect.sync(() => {
          Deferred.doneUnsafe(gate, Effect.void);
          if (this.#recoveryGate === gate) this.#recoveryGate = null;
        })),
      ),
      (error) => {
        if (this.#disposed) return;
        this.#recoveryPending = false;
        this.#scheduleRecovery(error);
      },
    );
  }

  #awaitRecoveryEffect(): Effect.Effect<void> {
    const gate = this.#recoveryGate;
    return gate === null || this.#disposed ? Effect.void : Deferred.await(gate);
  }

  #reloadUntilRecoveredEffect(): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (this.#disposed || !this.#recoveryPending) return Effect.void;
      this.#observe({ phase: 'recovery-started', priority: 'critical' });
      return this.#reloadEffect(true).pipe(
        Effect.tap(() => Effect.sync(() => {
          this.#recoveryPending = false;
          this.#observe({ phase: 'recovery-completed', priority: 'critical' });
        })),
        Effect.catch((error) => {
          if (this.#disposed) return Effect.void;
          return Effect.sync(() => {
            this.#recoveryPending = true;
            this.#observe({
              phase: 'recovery-failed',
              priority: 'critical',
              data: {
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            });
            this.#reportError(error);
          }).pipe(
            Effect.andThen(this.#sync.waitBeforeRetryEffect(250)),
            Effect.andThen(this.#reloadUntilRecoveredEffect()),
          );
        }),
      );
    });
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

  #reloadEffect(clearHistory: boolean): Effect.Effect<void, unknown> {
    if (this.#reloading) {
      return Effect.fail(new RangeError('Canvas reconciliation is already in progress.'));
    }
    this.#reloading = true;
    this.#observe({
      phase: 'reload-started',
      priority: 'high',
      data: { clearHistory },
    });
    return this.#fetchSnapshotEffect().pipe(
      Effect.flatMap((snapshot) => Effect.try({
        try: () => this.#installSnapshot(snapshot, clearHistory),
        catch: (cause) => cause,
      })),
      Effect.catch((error) => Effect.sync(() => {
        this.#observe({
          phase: 'reload-failed',
          priority: 'critical',
          data: {
            clearHistory,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });
      }).pipe(Effect.andThen(Effect.fail(error)))),
      Effect.ensuring(Effect.sync(() => {
        this.#reloading = false;
      })),
    );
  }

  #fetchSnapshotEffect(): Effect.Effect<TCanvasSnapshot, unknown> {
    return Effect.tryPromise({
      try: () => this.#transport.getSnapshot({ canvasId: this.#canvasId }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map((snapshot) => CanvasDocumentCodec.decode(snapshot)),
    );
  }

  #installSnapshot(snapshot: TCanvasSnapshot, clearHistory: boolean): void {
      if (this.#disposed) return;
      if (this.#committing) {
        throw new RangeError('Cannot reload the canvas during a local commit.');
      }
      const engine = this.#engine;
      if (engine === null) return;

      const acceptedItems = new Map(
        snapshot.items.map((item) => [item.id, item]),
      );
      const authoredReductionState = createSceneReductionState(
        fnCanvasNodesToCangineSnapshot(
          snapshot.items.map((item) => item.item),
        ),
      );
      const authoredSnapshot = sceneReductionStateSnapshot(authoredReductionState);
      const authoredNodes = new Map(
        authoredSnapshot.nodes
          .filter((node) => node.id !== CANVAS_RUNTIME_CONTENT_LAYER_ID)
          .map((node) => [node.id, node]),
      );
      const admittedSnapshot = {
        ...authoredSnapshot,
        nodes: authoredSnapshot.nodes.map((node) => this.#projectNode(node)),
      };
      const reductionState = createSceneReductionState(admittedSnapshot);
      const optimisticNodes = new Map(
        admittedSnapshot.nodes.map((node) => [node.id, node]),
      );
      const nextImageIndex = fnBuildImageDocumentIndex(authoredNodes);

      const previousRevision = this.#acceptedRevision;
      const previousItems = new Map(this.#acceptedItems);
      const previousNodes = this.#optimisticNodes;
      const previousAuthoredNodes = this.#authoredNodes;
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
        this.#authoredNodes = authoredNodes;
        this.#imageNodeCounts = nextImageIndex.nodeCounts;
        this.#imageDescriptorCounts = nextImageIndex.descriptorCounts;
        engine.scene.replace(admittedSnapshot, { source: SNAPSHOT_SCENE_SOURCE });
        this.#projection = Object.freeze({
          state: reductionState,
          revision: engine.scene.revision,
        });
      } catch (error) {
        this.#acceptedRevision = previousRevision;
        this.#acceptedItems.clear();
        for (const [id, item] of previousItems) this.#acceptedItems.set(id, item);
        this.#optimisticNodes = previousNodes;
        this.#authoredNodes = previousAuthoredNodes;
        this.#imageNodeCounts = previousImageIndex.nodeCounts;
        this.#imageDescriptorCounts = previousImageIndex.descriptorCounts;
        try {
          this.#syncDurableResources(previousImageIndex);
        } catch (restoreError) {
          this.#reportError(restoreError);
        }
        throw error;
      }
      this.#publishAuthoredChange();
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
  }

  #stageImageIndexChanges(
    before: ReadonlyMap<string, TSceneNodeImage>,
    after: ReadonlyMap<string, TSceneNodeImage>,
  ): TImageIndexPatch {
    return fnStageImageIndexChanges({
      before,
      after,
      current: {
        nodeCounts: this.#imageNodeCounts,
        descriptorCounts: this.#imageDescriptorCounts,
      },
      localResourceIds: new Set(this.#localImages.keys()),
    });
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
    fnAssertCompatibleImageDescriptors(index.descriptorCounts);
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
    this.#sync.fork(
      Effect.tryPromise({
        try: () => owner.preload(),
        catch: (cause) => cause,
      }),
      (error) => this.#reportError(error),
    );
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
      this.#scheduleUploadedUrlDeletion([image.durableUrl]);
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
        projectedSceneRevision: this.projectedSceneRevision,
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
    if (
      this.#projection === null
      || this.#engine.scene.revision !== this.#projection.revision
    ) {
      throw new RangeError('Canvas scene projection is not synchronized.');
    }
  }

  #assertAuthoredMutation(request: TEditorSceneMutationRequest): void {
    if (
      request.affectedNodeIds.includes(CANVAS_RUNTIME_CONTENT_LAYER_ID)
    ) {
      throw new RangeError('Editor mutations cannot target runtime canvas nodes.');
    }
  }
}

function createMediaGate(): TMediaGate {
  const deferred = Deferred.makeUnsafe<void>();
  return Object.freeze({
    wait: Deferred.await(deferred),
    release() {
      Deferred.doneUnsafe(deferred, Effect.void);
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
  images: ReadonlyMap<string, TSceneNodeImage>,
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
