import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemId,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemSnapshot,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';

export type TCanvasStoreMutation =
  | Readonly<{
      type: 'insert';
      item: TCanvasItemSnapshot['item'];
    }>
  | Readonly<{
      type: 'replace';
      item: TCanvasItemSnapshot['item'];
      expectedItemRevision: number;
    }>
  | Readonly<{
      type: 'delete';
      itemId: TCanvasItemId;
      expectedItemRevision: number;
    }>;

export type TCanvasStoreApplyArgs = Readonly<{
  commandId: string;
  canvasId: string;
  expectedCanvasRevision: number;
  mutations: readonly TCanvasStoreMutation[];
}>;

export type TCanvasStoreApplyResult =
  | Readonly<{
      status: 'committed';
      revision: number;
      changedItems: readonly TCanvasItemSnapshot[];
      deletedItemIds: readonly TCanvasItemId[];
      duplicate?: boolean;
    }>
  | Readonly<{
      status: 'revision-conflict';
      revision: number | null;
    }>;

export type TCanvasImageResourceClaim = Readonly<{
  resourceId: string;
  url: string;
  mimeType: string;
}>;

/**
 * Persistence boundary for the authoritative service.
 *
 * The implementation must commit all mutations and the canvas revision increment
 * atomically, and return `revision-conflict` without applying any mutation when
 * `expectedCanvasRevision` is no longer current.
 */
export interface ICanvasStore {
  getCommandResult(args: Readonly<{
    canvasId: string;
    commandId: string;
  }>): Promise<Extract<TCanvasStoreApplyResult, { status: 'committed' }> | null>;
  getRevision(args: Readonly<{ canvasId: string }>): Promise<number | null>;
  getSnapshot(args: Readonly<{ canvasId: string }>): Promise<TCanvasSnapshot | null>;
  queryItems(query: TCanvasItemQuery): Promise<TCanvasItemPage>;
  queryImageResourceClaims(
    args: Readonly<{
      canvasId: string;
      resourceIds: readonly string[];
      excludeItemIds: readonly TCanvasItemId[];
      limit: number;
    }>,
  ): Promise<readonly TCanvasImageResourceClaim[]>;
  applyMutations(args: TCanvasStoreApplyArgs): Promise<TCanvasStoreApplyResult>;
}

export type TCanvasServiceOptions = Readonly<{
  maxOperations?: number;
  maxPreconditions?: number;
  maxPatchesPerOperation?: number;
  maxTouchedItems?: number;
  maxCommandBytes?: number;
  maxItemBytes?: number;
  maxJsonDepth?: number;
  maxJsonEntries?: number;
  maxPathDepth?: number;
  maxHierarchyDepth?: number;
  maxReplayEvents?: number;
  maxCommitAttempts?: number;
  queryPageSize?: number;
}>;

export type TCanvasServiceDependencies = Readonly<{
  store: ICanvasStore;
  options?: TCanvasServiceOptions;
  widgetPlacementAdmission?: Readonly<{
    assertAllowed(args: Readonly<{
      widgetKey: string;
      type: 'widget-instance' | 'widget-preview';
    }>): void | Promise<void>;
    withAdmission?<T>(
      placements: readonly Readonly<{
        widgetKey: string;
        type: 'widget-instance' | 'widget-preview';
      }>[],
      operation: () => Promise<T>,
    ): Promise<T>;
  }>;
}>;

export type TCanvasServiceMetrics = Readonly<{
  activeCanvases: number;
  cachedItems: number;
  replayEvents: number;
  subscribers: number;
  pendingCommands: number;
}>;

export type TCanvasSubscribeArgs = Readonly<{
  canvasId: string;
  afterRevision: number;
}>;

export interface ICanvasService {
  readonly name: string;
  stop(): Promise<void>;
  getSnapshot(args: Readonly<{ canvasId: string }>): Promise<TCanvasSnapshot>;
  queryItems(query: TCanvasItemQuery): Promise<TCanvasItemPage>;
  execute(command: TCanvasCommand): Promise<TCanvasItemsChangedEvent>;
  subscribe(args: TCanvasSubscribeArgs): AsyncIterable<TCanvasEvent>;
  beginDeletion(args: Readonly<{ canvasId: string }>): Promise<void>;
  abortDeletion(args: Readonly<{ canvasId: string }>): Promise<void>;
  commitDeletion(args: Readonly<{ canvasId: string }>): Promise<void>;
  release(args: Readonly<{ canvasId: string }>): Promise<void>;
  getMetrics(): TCanvasServiceMetrics;
}
