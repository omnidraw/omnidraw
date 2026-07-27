import { describe, expect, test } from 'bun:test';
import {
  fnReadCanvasWidgetExtension,
} from '@vibecanvas/canvas-contract';
import type {
  TCanvasCommand,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemSnapshot,
  TCanvasSnapshot,
} from '@vibecanvas/canvas-contract';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import {
  CanvasService,
  CanvasServiceError,
} from '../src/CanvasService';
import type {
  ICanvasStore,
  TCanvasStoreApplyArgs,
  TCanvasStoreApplyResult,
} from '../src/ICanvasService';

type TSceneNode = TCanvasItemSnapshot['item'];

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

const tenant = Object.freeze({
  orgId: 'org-a',
  accountId: 'account-a',
  cellId: 'cell-a',
  placementEpoch: 1,
  roles: Object.freeze(['editor']),
  capabilities: Object.freeze(['canvas:read', 'canvas:write']),
  requestId: 'request-a',
}) satisfies TTenantContext;

function rect(
  id: string,
  parentId: string | null = null,
  orderKey = id,
): TSceneNode {
  return {
    id,
    parentId,
    orderKey,
    kind: 'rect',
    transform,
    size: { width: 100, height: 60 },
  };
}

function group(
  id: string,
  parentId: string | null = null,
  orderKey = id,
): TSceneNode {
  return {
    id,
    parentId,
    orderKey,
    kind: 'group',
    transform,
  };
}

function widget(id: string, instanceId: string): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'widget-frame',
    transform,
    size: { width: 320, height: 240 },
    extensions: {
      'vibecanvas:widget': {
        schemaVersion: 1,
        type: 'widget-instance',
        instanceId,
        definitionId: 'definition-a',
        revisionId: 'revision-a',
      },
    },
  };
}

type TMemoryCanvas = {
  revision: number;
  rows: Map<string, TCanvasItemSnapshot>;
};

class MemoryCanvasStore implements ICanvasStore {
  readonly canvases = new Map<string, TMemoryCanvas>();
  readonly queryFilters: string[] = [];
  snapshotReads = 0;
  failNextApply = false;
  beforeApply:
    | ((tenant: TTenantContext, args: TCanvasStoreApplyArgs) => Promise<void>)
    | null = null;

  createCanvas(
    context: TTenantContext,
    canvasId: string,
    items: readonly TSceneNode[] = [],
  ): void {
    const rows = new Map<string, TCanvasItemSnapshot>();
    for (const item of items) {
      rows.set(item.id, {
        id: item.id,
        item: structuredClone(item),
        itemRevision: 1,
        createdAtMs: 0,
        updatedAtMs: 0,
      });
    }
    this.canvases.set(this.key(context, canvasId), { revision: 0, rows });
  }

  async getRevision(
    context: TTenantContext,
    args: Readonly<{ canvasId: string }>,
  ): Promise<number | null> {
    return this.canvases.get(this.key(context, args.canvasId))?.revision ?? null;
  }

  async getSnapshot(
    context: TTenantContext,
    args: Readonly<{ canvasId: string }>,
  ): Promise<TCanvasSnapshot | null> {
    this.snapshotReads += 1;
    const canvas = this.canvases.get(this.key(context, args.canvasId));
    if (canvas === undefined) return null;
    return {
      canvasId: args.canvasId,
      revision: canvas.revision,
      items: [...canvas.rows.values()].map((entry) => structuredClone(entry)),
    };
  }

  async queryItems(
    context: TTenantContext,
    query: TCanvasItemQuery,
  ): Promise<TCanvasItemPage> {
    this.queryFilters.push(query.filter.type);
    const canvas = this.canvases.get(this.key(context, query.canvasId));
    if (canvas === undefined) return { items: [], nextCursor: null };
    let rows = [...canvas.rows.values()];
    if (query.filter.type === 'ids') {
      const ids = new Set(query.filter.ids);
      rows = rows.filter((row) => ids.has(row.id));
    } else if (query.filter.type === 'kind') {
      const filter = query.filter;
      rows = rows.filter((row) => row.item.kind === filter.kind);
    } else if (query.filter.type === 'parent') {
      const filter = query.filter;
      rows = rows.filter((row) => row.item.parentId === filter.parentId);
    } else if (query.filter.type === 'widget-instance') {
      const filter = query.filter;
      rows = rows.filter((row) => {
        const extension = fnReadCanvasWidgetExtension(row.item);
        return extension?.type === 'widget-instance'
          && extension.instanceId === filter.instanceId;
      });
    } else if (query.filter.type === 'widget-definition') {
      const filter = query.filter;
      rows = rows.filter((row) => {
        const extension = fnReadCanvasWidgetExtension(row.item);
        return extension?.type === 'widget-instance'
          && extension.definitionId === filter.definitionId
          && (
            filter.revisionId === undefined
            || extension.revisionId === filter.revisionId
          );
      });
    }
    rows.sort((left, right) => (
      query.filter.type === 'parent'
        ? left.item.orderKey.localeCompare(right.item.orderKey)
          || left.id.localeCompare(right.id)
        : left.id.localeCompare(right.id)
    ));
    return {
      items: rows.map((entry) => structuredClone(entry)),
      nextCursor: null,
    };
  }

  async applyMutations(
    context: TTenantContext,
    args: TCanvasStoreApplyArgs,
  ): Promise<TCanvasStoreApplyResult> {
    await this.beforeApply?.(context, args);
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error('injected pre-commit failure');
    }
    const canvas = this.canvases.get(this.key(context, args.canvasId));
    if (canvas === undefined) return { status: 'revision-conflict', revision: null };
    if (canvas.revision !== args.expectedCanvasRevision) {
      return { status: 'revision-conflict', revision: canvas.revision };
    }

    const nextRows = new Map(
      [...canvas.rows].map(([id, row]) => [id, structuredClone(row)]),
    );
    const changedItems: TCanvasItemSnapshot[] = [];
    const deletedItemIds: string[] = [];
    for (const mutation of args.mutations) {
      if (mutation.type === 'insert') {
        if (nextRows.has(mutation.item.id)) throw new Error('duplicate insert');
        const snapshot: TCanvasItemSnapshot = {
          id: mutation.item.id,
          item: structuredClone(mutation.item),
          itemRevision: 1,
          createdAtMs: args.nowMs,
          updatedAtMs: args.nowMs,
        };
        nextRows.set(snapshot.id, snapshot);
        changedItems.push(structuredClone(snapshot));
        continue;
      }
      if (mutation.type === 'delete') {
        const current = nextRows.get(mutation.itemId);
        if (current?.itemRevision !== mutation.expectedItemRevision) {
          throw new Error('item revision conflict');
        }
        nextRows.delete(mutation.itemId);
        deletedItemIds.push(mutation.itemId);
        continue;
      }
      const current = nextRows.get(mutation.item.id);
      if (current?.itemRevision !== mutation.expectedItemRevision) {
        throw new Error('item revision conflict');
      }
      const snapshot: TCanvasItemSnapshot = {
        id: mutation.item.id,
        item: structuredClone(mutation.item),
        itemRevision: current.itemRevision + 1,
        createdAtMs: current.createdAtMs,
        updatedAtMs: args.nowMs,
      };
      nextRows.set(snapshot.id, snapshot);
      changedItems.push(structuredClone(snapshot));
    }
    canvas.rows = nextRows;
    canvas.revision += 1;
    return {
      status: 'committed',
      revision: canvas.revision,
      changedItems,
      deletedItemIds,
    };
  }

  private key(context: TTenantContext, canvasId: string): string {
    return `${context.orgId}:${canvasId}`;
  }
}

class InstrumentedScaleStore implements ICanvasStore {
  revision = 0;
  row: TCanvasItemSnapshot;
  readonly totalRows: number;
  snapshotReads = 0;
  rowsRead = 0;
  rowsWritten = 0;
  jsonBytesRead = 0;
  jsonBytesWritten = 0;

  constructor(totalRows: number) {
    this.totalRows = totalRows;
    this.row = {
      id: 'target',
      item: rect('target'),
      itemRevision: 1,
      createdAtMs: 0,
      updatedAtMs: 0,
    };
  }

  async getRevision(): Promise<number> {
    return this.revision;
  }

  async getSnapshot(): Promise<TCanvasSnapshot> {
    this.snapshotReads += 1;
    return {
      canvasId: 'canvas-scale',
      revision: this.revision,
      items: [structuredClone(this.row)],
    };
  }

  async queryItems(
    _context: TTenantContext,
    query: TCanvasItemQuery,
  ): Promise<TCanvasItemPage> {
    if (query.filter.type !== 'ids') {
      throw new Error(`Scale evidence requires an indexed ID query, got ${query.filter.type}.`);
    }
    this.rowsRead += query.filter.ids.length;
    if (!query.filter.ids.includes(this.row.id)) return { items: [], nextCursor: null };
    this.jsonBytesRead += JSON.stringify(this.row.item).length;
    return { items: [structuredClone(this.row)], nextCursor: null };
  }

  async applyMutations(
    _context: TTenantContext,
    args: TCanvasStoreApplyArgs,
  ): Promise<TCanvasStoreApplyResult> {
    if (args.expectedCanvasRevision !== this.revision) {
      return { status: 'revision-conflict', revision: this.revision };
    }
    if (args.mutations.length !== 1 || args.mutations[0]?.type !== 'replace') {
      throw new Error('Scale evidence expects one bounded replacement.');
    }
    const mutation = args.mutations[0];
    this.rowsWritten += 1;
    this.jsonBytesWritten += JSON.stringify(mutation.item).length;
    this.row = {
      ...this.row,
      item: structuredClone(mutation.item),
      itemRevision: this.row.itemRevision + 1,
      updatedAtMs: args.nowMs,
    };
    this.revision += 1;
    return {
      status: 'committed',
      revision: this.revision,
      changedItems: [structuredClone(this.row)],
      deletedItemIds: [],
    };
  }
}

function service(
  store: ICanvasStore,
  options: ConstructorParameters<typeof CanvasService>[0]['options'] = {},
): CanvasService {
  let nowMs = 10;
  return new CanvasService({
    store,
    clock: { nowMs: () => nowMs++ },
    options,
  });
}

function patchCommand(
  commandId: string,
  canvasId: string,
  itemId: string,
  baseRevision: number,
  coordinate: 'x' | 'y',
  expected: number,
  value: number,
): TCanvasCommand {
  const path = ['transform', 'position', coordinate] as const;
  return {
    commandId,
    canvasId,
    baseRevision,
    operations: [{
      type: 'patch',
      itemId,
      patches: [{ type: 'set', path, value }],
    }],
    preconditions: [{
      type: 'path-value',
      itemId,
      path,
      value: expected,
    }],
  };
}

function insertCommand(
  commandId: string,
  canvasId: string,
  baseRevision: number,
  item: TSceneNode,
): TCanvasCommand {
  return {
    commandId,
    canvasId,
    baseRevision,
    operations: [{ type: 'insert', item }],
    preconditions: [{ type: 'item-absent', itemId: item.id }],
  };
}

describe('CanvasService authoritative commands', () => {
  test('keeps one-item work constant at 5k, 50k, and 100k logical rows', async () => {
    for (const totalRows of [5_000, 50_000, 100_000]) {
      const store = new InstrumentedScaleStore(totalRows);
      const canvas = service(store);
      const startedAt = performance.now();

      const event = await canvas.execute(
        tenant,
        patchCommand(
          `scale-${totalRows}`,
          'canvas-scale',
          'target',
          0,
          'x',
          0,
          1,
        ),
      );
      const elapsedMs = performance.now() - startedAt;

      expect(event.changedItems).toHaveLength(1);
      expect(store.totalRows).toBe(totalRows);
      expect(store.snapshotReads).toBe(0);
      expect(store.rowsRead).toBe(1);
      expect(store.rowsWritten).toBe(1);
      expect(store.jsonBytesRead).toBeLessThan(1_024);
      expect(store.jsonBytesWritten).toBeLessThan(1_024);
      expect(elapsedMs).toBeLessThan(250);
      await canvas.stop();
    }
  });

  test('accepts stale disjoint paths, rejects a same-path race, and stays sparse', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a', [rect('item-a')]);
    const canvas = service(store);

    const first = await canvas.execute(
      tenant,
      patchCommand('client-a:x', 'canvas-a', 'item-a', 0, 'x', 0, 10),
    );
    const disjointStale = await canvas.execute(
      tenant,
      patchCommand('client-b:y', 'canvas-a', 'item-a', 0, 'y', 0, 20),
    );

    expect(first.revision).toBe(1);
    expect(disjointStale.revision).toBe(2);
    expect(disjointStale.changedItems[0]?.item.transform.position).toEqual({
      x: 10,
      y: 20,
    });
    await expect(canvas.execute(
      tenant,
      patchCommand('client-b:x', 'canvas-a', 'item-a', 0, 'x', 0, 30),
    )).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.snapshotReads).toBe(0);
    expect(store.queryFilters).toEqual(['ids']);
    expect(canvas.getMetrics(tenant).cachedItems).toBe(1);
  });

  test('makes delete beat a stale patch and rejects a duplicate retry', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a', [rect('item-a')]);
    const canvas = service(store);
    const deletion: TCanvasCommand = {
      commandId: 'delete-a',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{ type: 'delete', itemId: 'item-a' }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'item-a',
        itemRevision: 1,
      }],
    };

    const event = await canvas.execute(tenant, deletion);
    expect(event.deletedItemIds).toEqual(['item-a']);
    await expect(canvas.execute(
      tenant,
      patchCommand('stale-patch', 'canvas-a', 'item-a', 0, 'x', 0, 2),
    )).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(canvas.execute(tenant, deletion)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await canvas.getSnapshot(tenant, { canvasId: 'canvas-a' })).items)
      .toEqual([]);
  });

  test('validates reparent, group delete, cycle, and reorder atomically', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a', [
      group('group-a'),
      rect('child-a', 'group-a'),
      group('group-b'),
    ]);
    const canvas = service(store);
    const cycle: TCanvasCommand = {
      commandId: 'cycle',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'reparent',
        itemId: 'group-a',
        parentId: 'child-a',
      }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'group-a',
        itemRevision: 1,
      }],
    };
    await expect(canvas.execute(tenant, cycle)).rejects.toMatchObject({
      code: 'INVALID_COMMAND',
    });

    const deleteGroup: TCanvasCommand = {
      commandId: 'delete-group',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{ type: 'delete', itemId: 'group-a' }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'group-a',
        itemRevision: 1,
      }],
    };
    await expect(canvas.execute(tenant, deleteGroup)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const move: TCanvasCommand = {
      commandId: 'move',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'reparent',
        itemId: 'child-a',
        parentId: 'group-b',
        orderKey: 'M',
      }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'child-a',
        itemRevision: 1,
      }],
    };
    expect((await canvas.execute(tenant, move)).revision).toBe(1);

    const reorder: TCanvasCommand = {
      commandId: 'reorder',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'reorder',
        itemId: 'child-a',
        orderKey: 'Z',
      }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'child-a',
        itemRevision: 2,
      }],
    };
    const reordered = await canvas.execute(tenant, reorder);
    expect(reordered.changedItems[0]?.item).toMatchObject({
      parentId: 'group-b',
      orderKey: 'Z',
    });
    expect((await canvas.getSnapshot(tenant, { canvasId: 'canvas-a' })).revision)
      .toBe(2);
  });

  test('enforces widget instance identity in the same transaction lane', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a', [widget('widget-a', 'instance-a')]);
    const canvas = service(store);

    await expect(canvas.execute(
      tenant,
      insertCommand(
        'duplicate-widget',
        'canvas-a',
        0,
        widget('widget-b', 'instance-a'),
      ),
    )).rejects.toMatchObject({ code: 'CONFLICT' });

    const accepted = await canvas.execute(
      tenant,
      insertCommand(
        'new-widget',
        'canvas-a',
        0,
        widget('widget-b', 'instance-b'),
      ),
    );
    expect(accepted.changedItems).toHaveLength(1);
    expect(store.queryFilters).toContain('widget-instance');
  });

  test('publishes after commit, replays a contiguous tail, and requires resync after gaps', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a');
    const canvas = service(store, { maxReplayEvents: 2 });

    const live = canvas.subscribe(tenant, {
      canvasId: 'canvas-a',
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    const liveNext = live.next();
    const first = await canvas.execute(
      tenant,
      insertCommand('insert-a', 'canvas-a', 0, rect('item-a')),
    );
    expect(await liveNext).toEqual({ done: false, value: first });
    const second = await canvas.execute(
      tenant,
      insertCommand('insert-b', 'canvas-a', 0, rect('item-b')),
    );
    await live.return?.();

    const replay = canvas.subscribe(tenant, {
      canvasId: 'canvas-a',
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    expect((await replay.next()).value).toEqual(first);
    expect((await replay.next()).value).toEqual(second);
    await replay.return?.();

    await canvas.execute(
      tenant,
      insertCommand('insert-c', 'canvas-a', 0, rect('item-c')),
    );
    const overflow = canvas.subscribe(tenant, {
      canvasId: 'canvas-a',
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    expect(await overflow.next()).toEqual({
      done: false,
      value: {
        type: 'resync-required',
        canvasId: 'canvas-a',
        revision: 3,
      },
    });
    await overflow.return?.();

    const restarted = service(store, { maxReplayEvents: 2 });
    const reconnect = restarted.subscribe(tenant, {
      canvasId: 'canvas-a',
      afterRevision: 2,
    })[Symbol.asyncIterator]();
    expect((await reconnect.next()).value).toMatchObject({
      type: 'resync-required',
      revision: 3,
    });
    await reconnect.return?.();
    await canvas.release(tenant, { canvasId: 'canvas-a' });
    expect(canvas.getMetrics(tenant)).toEqual({
      activeCanvases: 0,
      cachedItems: 0,
      replayEvents: 0,
      subscribers: 0,
      pendingCommands: 0,
    });
    await restarted.stop();
  });

  test('contains pre-commit failure and retries without publishing phantom state', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a');
    const canvas = service(store);
    const command = insertCommand('insert-a', 'canvas-a', 0, rect('item-a'));
    const subscription = canvas.subscribe(tenant, {
      canvasId: 'canvas-a',
      afterRevision: 0,
    })[Symbol.asyncIterator]();
    const nextEvent = subscription.next();
    store.failNextApply = true;

    await expect(canvas.execute(tenant, command)).rejects.toMatchObject({
      code: 'STORE_CONFLICT',
    });
    expect(await nextEvent).toEqual({
      done: false,
      value: {
        type: 'resync-required',
        canvasId: 'canvas-a',
        revision: 0,
      },
    });
    expect(canvas.getMetrics(tenant)).toMatchObject({
      cachedItems: 0,
      replayEvents: 0,
    });
    expect((await canvas.execute(tenant, command)).revision).toBe(1);
    await subscription.return?.();
  });

  test('serializes each canvas without blocking an unrelated canvas', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a');
    store.createCanvas(tenant, 'canvas-b');
    const canvas = service(store);
    let entered!: () => void;
    let unblock!: () => void;
    const enteredApply = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    store.beforeApply = async (_context, args) => {
      if (args.canvasId !== 'canvas-a') return;
      entered();
      await gate;
    };

    const pendingA = canvas.execute(
      tenant,
      insertCommand('insert-a', 'canvas-a', 0, rect('item-a')),
    );
    await enteredApply;
    const eventB = await canvas.execute(
      tenant,
      insertCommand('insert-b', 'canvas-b', 0, rect('item-b')),
    );
    expect(eventB.revision).toBe(1);
    unblock();
    expect((await pendingA).revision).toBe(1);
  });

  test('rechecks centralized authorization on every operation', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a');
    let revoked = false;
    const canvas = new CanvasService({
      store,
      clock: { nowMs: () => 1 },
      authorize: () => {
        if (revoked) {
          throw new CanvasServiceError('FORBIDDEN', 'membership revoked');
        }
      },
    });

    expect((await canvas.getSnapshot(tenant, { canvasId: 'canvas-a' })).revision)
      .toBe(0);
    revoked = true;
    await expect(canvas.execute(
      tenant,
      insertCommand('insert-a', 'canvas-a', 0, rect('item-a')),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('rejects unguarded commands and bounded candidate-item overflow', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas(tenant, 'canvas-a', [rect('item-a')]);
    const canvas = service(store, { maxItemBytes: 512 });
    await expect(canvas.execute(tenant, {
      commandId: 'unguarded',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'patch',
        itemId: 'item-a',
        patches: [{
          type: 'set',
          path: ['metadata'],
          value: { payload: 'small' },
        }],
      }],
      preconditions: [],
    })).rejects.toMatchObject({ code: 'INVALID_COMMAND' });

    const oversized = {
      ...rect('large-item'),
      metadata: { payload: 'x'.repeat(1_000) },
    } as TSceneNode;
    await expect(canvas.execute(
      tenant,
      insertCommand('oversized', 'canvas-a', 0, oversized),
    )).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect((await canvas.getSnapshot(tenant, { canvasId: 'canvas-a' })).revision)
      .toBe(0);
  });
});
