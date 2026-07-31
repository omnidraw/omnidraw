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
import type { IService } from '@omnidraw/runtime';
import type { TTenantContext } from '@omnidraw/tenant-core';

export type TCanvasAccess = 'read' | 'write';

export type TCanvasAccessArgs = Readonly<{
  canvasId: string;
  access: TCanvasAccess;
}>;

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
  canvasId: string;
  expectedCanvasRevision: number;
  mutations: readonly TCanvasStoreMutation[];
  nowMs: number;
}>;

export type TCanvasStoreApplyResult =
  | Readonly<{
      status: 'committed';
      revision: number;
      changedItems: readonly TCanvasItemSnapshot[];
      deletedItemIds: readonly TCanvasItemId[];
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
 * Every method must scope reads and writes to the supplied tenant. The
 * implementation must commit all mutations and the canvas revision increment
 * atomically, and return `revision-conflict` without applying any mutation when
 * `expectedCanvasRevision` is no longer current.
 */
export interface ICanvasStore {
  getRevision(
    tenant: TTenantContext,
    args: Readonly<{ canvasId: string }>,
  ): Promise<number | null>;
  getSnapshot(
    tenant: TTenantContext,
    args: Readonly<{ canvasId: string }>,
  ): Promise<TCanvasSnapshot | null>;
  queryItems(
    tenant: TTenantContext,
    query: TCanvasItemQuery,
  ): Promise<TCanvasItemPage>;
  queryImageResourceClaims(
    tenant: TTenantContext,
    args: Readonly<{
      canvasId: string;
      resourceIds: readonly string[];
      excludeItemIds: readonly TCanvasItemId[];
      limit: number;
    }>,
  ): Promise<readonly TCanvasImageResourceClaim[]>;
  applyMutations(
    tenant: TTenantContext,
    args: TCanvasStoreApplyArgs,
  ): Promise<TCanvasStoreApplyResult>;
}

export interface ICanvasClock {
  nowMs(): number;
}

export type TCanvasAuthorizer = (
  tenant: TTenantContext,
  args: TCanvasAccessArgs,
) => void | Promise<void>;

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
  clock: ICanvasClock;
  authorize?: TCanvasAuthorizer;
  options?: TCanvasServiceOptions;
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

export interface ICanvasService extends IService {
  stop(): Promise<void>;
  getSnapshot(
    tenant: TTenantContext,
    args: Readonly<{ canvasId: string }>,
  ): Promise<TCanvasSnapshot>;
  queryItems(
    tenant: TTenantContext,
    query: TCanvasItemQuery,
  ): Promise<TCanvasItemPage>;
  execute(
    tenant: TTenantContext,
    command: TCanvasCommand,
  ): Promise<TCanvasItemsChangedEvent>;
  subscribe(
    tenant: TTenantContext,
    args: TCanvasSubscribeArgs,
  ): AsyncIterable<TCanvasEvent>;
  release(
    tenant: TTenantContext,
    args: Readonly<{ canvasId: string }>,
  ): Promise<void>;
  getMetrics(tenant: TTenantContext): TCanvasServiceMetrics;
}
