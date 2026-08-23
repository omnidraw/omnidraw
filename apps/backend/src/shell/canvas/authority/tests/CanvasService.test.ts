import { describe, expect, test } from 'bun:test';
import {
  CANVAS_SCENE_SCHEMA_VERSION,
  fnReadCanvasImageExtension,
  fnReadCanvasWidgetExtension,
  fnValidateCanvasItems,
} from '@omnidraw/canvas-contract';
import type {
  TCanvasCommand,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemSnapshot,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { CanvasService } from '../CanvasService';
import type {
  ICanvasStore,
  TCanvasStoreApplyArgs,
  TCanvasStoreApplyResult,
} from '../ICanvasService';

type TSceneNode = TCanvasItemSnapshot['item'];

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(id: string): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'rect',
    transform,
    size: { width: 100, height: 60 },
  };
}

function connector(id: string, fromId: string, toId: string): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'connector',
    transform,
    from: { type: 'node', nodeId: fromId, anchor: 'right' },
    to: { type: 'node', nodeId: toId, anchor: 'left' },
    routing: { type: 'straight' },
    stroke: {
      width: 2,
      paint: {
        type: 'solid',
        color: { space: 'srgb', r: 0, g: 0, b: 0, a: 1 },
      },
    },
  };
}

function attachedConnector(id: string, fromId: string, toId: string): TSceneNode {
  return {
    ...connector(id, fromId, toId),
    from: {
      type: 'node', nodeId: fromId, anchor: 'auto',
      attachment: { mode: 'inside', fixedPoint: { x: 0.75, y: 0.5 } },
    },
    to: {
      type: 'node', nodeId: toId, anchor: 'auto',
      attachment: { mode: 'orbit', fixedPoint: { x: 0, y: 0.5 } },
    },
    routing: { type: 'orthogonal', cornerRadius: 8 },
    fixedSegments: [{
      id: 'middle-leg', start: { x: 40, y: 30 }, end: { x: 120, y: 30 },
    }],
    endMarker: { shape: 'arrow', size: 12, filled: true },
  };
}

function image(id: string, resourceId: string, url: string): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'image',
    transform,
    resourceId,
    size: { width: 80, height: 60 },
    extensions: {
      'omnidraw:image': {
        schemaVersion: 1,
        url,
        mimeType: 'image/png',
      },
    },
  };
}

function widget(id: string, instanceId: string, widgetKey = 'counter'): TSceneNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'widget-frame',
    transform,
    size: { width: 320, height: 240 },
    extensions: {
      'omnidraw:widget': {
        schemaVersion: 1,
        type: 'widget-instance',
        instanceId,
        widgetKey,
      },
    },
  };
}

function previewWidget(id: string, instanceId: string, widgetKey = 'counter'): TSceneNode {
  return {
    ...widget(id, instanceId, widgetKey),
    title: 'Preview: Counter',
    extensions: {
      'omnidraw:widget': {
        schemaVersion: 1,
        type: 'widget-preview',
        instanceId,
        widgetKey,
      },
    },
  };
}

type TMemoryCanvas = {
  revision: number;
  rows: Map<string, TCanvasItemSnapshot>;
};

const CREATED_AT_SEC = '2026-08-04T00:00:00Z';
const UPDATED_AT_SEC = '2026-08-04T00:00:01Z';

class MemoryCanvasStore implements ICanvasStore {
  readonly canvases = new Map<string, TMemoryCanvas>();
  readonly queryFilters: string[] = [];
  failNextApply = false;
  applyGate: Promise<void> | null = null;
  onApplyStarted: (() => void) | null = null;
  readonly commandResults = new Map<string, Extract<TCanvasStoreApplyResult, { status: 'committed' }>>();

  async getCommandResult(args: Readonly<{ canvasId: string; commandId: string }>) {
    return structuredClone(this.commandResults.get(`${args.canvasId}\u0000${args.commandId}`) ?? null);
  }

  createCanvas(canvasId: string, items: readonly TSceneNode[] = []): void {
    const rows = new Map<string, TCanvasItemSnapshot>();
    for (const item of items) {
      rows.set(item.id, {
        id: item.id,
        item: structuredClone(item),
        itemRevision: 1,
        createdAtSec: CREATED_AT_SEC,
        updatedAtSec: CREATED_AT_SEC,
      });
    }
    this.canvases.set(canvasId, { revision: 0, rows });
  }

  async getRevision(args: Readonly<{ canvasId: string }>): Promise<number | null> {
    return this.canvases.get(args.canvasId)?.revision ?? null;
  }

  async getSnapshot(args: Readonly<{ canvasId: string }>): Promise<TCanvasSnapshot | null> {
    const canvas = this.canvases.get(args.canvasId);
    if (canvas === undefined) return null;
    return {
      schemaVersion: CANVAS_SCENE_SCHEMA_VERSION,
      canvasId: args.canvasId,
      revision: canvas.revision,
      items: [...canvas.rows.values()].map((entry) => structuredClone(entry)),
    };
  }

  async queryItems(query: TCanvasItemQuery): Promise<TCanvasItemPage> {
    this.queryFilters.push(query.filter.type);
    const canvas = this.canvases.get(query.canvasId);
    if (canvas === undefined) return { items: [], nextCursor: null };
    let rows = [...canvas.rows.values()];
    if (query.filter.type === 'ids') {
      const ids = new Set(query.filter.ids);
      rows = rows.filter((row) => ids.has(row.id));
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
    } else if (query.filter.type === 'widget-key') {
      const filter = query.filter;
      rows = rows.filter((row) => {
        const extension = fnReadCanvasWidgetExtension(row.item);
        return extension?.type === 'widget-instance'
          && extension.widgetKey === filter.widgetKey;
      });
    } else if (query.filter.type === 'kind') {
      const filter = query.filter;
      rows = rows.filter((row) => row.item.kind === filter.kind);
    }
    rows.sort((left, right) => left.id.localeCompare(right.id));
    return {
      items: rows.map((entry) => structuredClone(entry)),
      nextCursor: null,
    };
  }

  async queryImageResourceClaims(args: Readonly<{
    canvasId: string;
    resourceIds: readonly string[];
    excludeItemIds: readonly string[];
    limit: number;
  }>) {
    const canvas = this.canvases.get(args.canvasId);
    if (canvas === undefined) return [];
    const resourceIds = new Set(args.resourceIds);
    const excluded = new Set(args.excludeItemIds);
    const claims = [];
    for (const row of canvas.rows.values()) {
      if (excluded.has(row.id) || row.item.kind !== 'image') continue;
      if (!resourceIds.has(row.item.resourceId)) continue;
      const descriptor = fnReadCanvasImageExtension(row.item);
      if (descriptor === null) continue;
      claims.push({
        resourceId: row.item.resourceId,
        url: descriptor.url,
        mimeType: descriptor.mimeType,
      });
      if (claims.length >= args.limit) break;
    }
    return claims;
  }

  async applyMutations(args: TCanvasStoreApplyArgs): Promise<TCanvasStoreApplyResult> {
    this.onApplyStarted?.();
    if (this.applyGate !== null) await this.applyGate;
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error('injected pre-commit failure');
    }
    const canvas = this.canvases.get(args.canvasId);
    if (canvas === undefined) return { status: 'revision-conflict', revision: null };
    if (canvas.revision !== args.expectedCanvasRevision) {
      return { status: 'revision-conflict', revision: canvas.revision };
    }

    const changedItems: TCanvasItemSnapshot[] = [];
    const deletedItemIds: string[] = [];
    for (const mutation of args.mutations) {
      if (mutation.type === 'delete') {
        canvas.rows.delete(mutation.itemId);
        deletedItemIds.push(mutation.itemId);
        continue;
      }
      const current = canvas.rows.get(mutation.item.id);
      const snapshot: TCanvasItemSnapshot = {
        id: mutation.item.id,
        item: structuredClone(mutation.item),
        itemRevision: current === undefined ? 1 : current.itemRevision + 1,
        createdAtSec: current?.createdAtSec ?? CREATED_AT_SEC,
        updatedAtSec: UPDATED_AT_SEC,
      };
      canvas.rows.set(snapshot.id, snapshot);
      changedItems.push(structuredClone(snapshot));
    }
    canvas.revision += 1;
    const result = {
      status: 'committed',
      revision: canvas.revision,
      changedItems,
      deletedItemIds,
    } as const;
    this.commandResults.set(`${args.canvasId}\u0000${args.commandId}`, structuredClone(result));
    return result;
  }
}

function service(store: ICanvasStore, maxReplayEvents = 256): CanvasService {
  return new CanvasService({ store, options: { maxReplayEvents } });
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

function patchPosition(commandId: string, coordinate: 'x' | 'y', expected: number, value: number): TCanvasCommand {
  const path = ['transform', 'position', coordinate] as const;
  return {
    commandId,
    canvasId: 'canvas-a',
    baseRevision: 0,
    operations: [{
      type: 'patch',
      itemId: 'item-a',
      patches: [{ type: 'set', path, value }],
    }],
    preconditions: [{
      type: 'path-value',
      itemId: 'item-a',
      path,
      value: expected,
    }],
  };
}

describe('CanvasService', () => {
  test('accepts disjoint stale paths and rejects a stale same-path command', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a', [rect('item-a')]);
    const canvas = service(store);

    expect((await canvas.execute(patchPosition('x', 'x', 0, 10))).revision).toBe(1);
    const second = await canvas.execute(patchPosition('y', 'y', 0, 20));
    expect(second.changedItems[0]?.item.transform.position).toEqual({ x: 10, y: 20 });
    await expect(canvas.execute(patchPosition('stale-x', 'x', 0, 30)))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    expect(store.queryFilters).toEqual(['ids']);
  });

  test('accepts a connector attached to existing canvas nodes', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a', [rect('shape-a'), rect('shape-b')]);
    const canvas = service(store);

    const result = await canvas.execute(insertCommand(
      'connector-a',
      'canvas-a',
      0,
      connector('connector-a', 'shape-a', 'shape-b'),
    ));

    expect(result.changedItems[0]?.item).toMatchObject({
      id: 'connector-a',
      kind: 'connector',
      from: { type: 'node', nodeId: 'shape-a' },
      to: { type: 'node', nodeId: 'shape-b' },
    });
  });

  test('persists target-relative endpoints and retains deterministic dangling intent after deletion', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a', [rect('shape-a'), rect('shape-b')]);
    const canvas = service(store);
    const authored = attachedConnector('arrow-a', 'shape-a', 'shape-b');

    const inserted = await canvas.execute(insertCommand(
      'insert-arrow',
      'canvas-a',
      0,
      authored,
    ));
    expect(inserted.changedItems[0]?.item).toEqual(authored);

    const deletion = await canvas.execute({
      commandId: 'delete-target',
      canvasId: 'canvas-a',
      baseRevision: 1,
      operations: [{ type: 'delete', itemId: 'shape-a' }],
      preconditions: [{ type: 'item-revision', itemId: 'shape-a', itemRevision: 1 }],
    });
    expect(deletion.deletedItemIds).toEqual(['shape-a']);

    const reloaded = await canvas.getSnapshot({ canvasId: 'canvas-a' });
    const retained = reloaded.items.find((entry) => entry.id === 'arrow-a')?.item;
    expect(retained).toEqual(authored);
    expect(fnValidateCanvasItems(reloaded.items.map((entry) => entry.item)))
      .toEqual({ valid: true, issues: [] });

    await expect(canvas.execute({
      commandId: 'rebind-missing-target',
      canvasId: 'canvas-a',
      baseRevision: 2,
      operations: [{
        type: 'replace',
        item: attachedConnector('arrow-a', 'missing-target', 'shape-b'),
      }],
      preconditions: [{ type: 'item-revision', itemId: 'arrow-a', itemRevision: 1 }],
    })).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
  });

  test('keeps widget identity stable and unique on one canvas', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a', [widget('widget-a', 'instance-a')]);
    const canvas = service(store);

    await expect(canvas.execute(insertCommand(
      'duplicate',
      'canvas-a',
      0,
      widget('widget-b', 'instance-a'),
    ))).rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(canvas.execute({
      commandId: 'replace-key',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'replace',
        item: widget('widget-a', 'instance-a', 'different-widget'),
      }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'widget-a',
        itemRevision: 1,
      }],
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('admits a fenced Preview replacement and its undo/redo as one-item transitions', async () => {
    const store = new MemoryCanvasStore();
    const preview = previewWidget('widget-a', 'preview-a');
    const published = widget('widget-a', 'published-a');
    store.createCanvas('canvas-a', [preview]);
    const admitted: string[] = [];
    let replacementAccepted = false;
    const canvas = new CanvasService({
      store,
      widgetPlacementAdmission: {
        async withAdmission(_placements, operation) { return operation(); },
        async assertAllowed(input) { admitted.push(`${input.type}:${input.widgetKey}`); },
        async assertPreviewReplacementAllowed(input) {
          admitted.push(`replace:${input.previewInstanceId}:${input.targetInstanceId}`);
        },
        async assertPreviewRestorationAllowed(input) {
          if (!replacementAccepted) throw new Error('Replacement was not accepted.');
          admitted.push(`restore:${input.targetInstanceId}:${input.previewInstanceId}`);
        },
        markPreviewReplacementAccepted(input) {
          replacementAccepted = true;
          admitted.push(`accepted:${input.previewInstanceId}:${input.targetInstanceId}`);
        },
      },
    });

    const replace = await canvas.execute({
      commandId: 'replace-preview',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{ type: 'replace', item: published }],
      preconditions: [{ type: 'item-revision', itemId: 'widget-a', itemRevision: 1 }],
    });
    expect(fnReadCanvasWidgetExtension(replace.changedItems[0]!.item)).toMatchObject({
      type: 'widget-instance',
      instanceId: 'published-a',
    });

    await canvas.execute({
      commandId: 'undo-replacement',
      canvasId: 'canvas-a',
      baseRevision: 1,
      operations: [{ type: 'replace', item: preview }],
      preconditions: [{ type: 'item-revision', itemId: 'widget-a', itemRevision: 2 }],
    });
    await canvas.execute({
      commandId: 'redo-replacement',
      canvasId: 'canvas-a',
      baseRevision: 2,
      operations: [{ type: 'replace', item: published }],
      preconditions: [{ type: 'item-revision', itemId: 'widget-a', itemRevision: 3 }],
    });
    expect(admitted).toEqual([
      'replace:preview-a:published-a',
      'accepted:preview-a:published-a',
      'restore:published-a:preview-a',
      'replace:preview-a:published-a',
      'accepted:preview-a:published-a',
    ]);
  });

  test('rejects converting an ordinary published instance into a Preview', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a', [widget('widget-a', 'published-a')]);
    const canvas = new CanvasService({
      store,
      widgetPlacementAdmission: {
        async withAdmission(_placements, operation) { return operation(); },
        async assertAllowed() {},
        async assertPreviewRestorationAllowed() {
          throw Object.assign(new Error('No accepted replacement lineage.'), {
            code: 'WIDGET_CATALOG_CHANGED',
          });
        },
      },
    });

    await expect(canvas.execute({
      commandId: 'forge-preview',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{
        type: 'replace',
        item: previewWidget('widget-a', 'forged-preview'),
      }],
      preconditions: [{ type: 'item-revision', itemId: 'widget-a', itemRevision: 1 }],
    })).rejects.toMatchObject({ code: 'WIDGET_CATALOG_CHANGED' });
  });

  test('leaves Preview durable state unchanged when replacement admission rejects catalog drift', async () => {
    const store = new MemoryCanvasStore();
    const preview = previewWidget('widget-a', 'preview-a');
    store.createCanvas('canvas-a', [preview]);
    const canvas = new CanvasService({
      store,
      widgetPlacementAdmission: {
        async withAdmission(_placements, operation) { return operation(); },
        async assertAllowed() {},
        async assertPreviewReplacementAllowed() {
          throw Object.assign(new Error('Publication changed.'), { code: 'WIDGET_CATALOG_CHANGED' });
        },
      },
    });

    await expect(canvas.execute({
      commandId: 'stale-replacement',
      canvasId: 'canvas-a',
      baseRevision: 0,
      operations: [{ type: 'replace', item: widget('widget-a', 'published-a') }],
      preconditions: [{ type: 'item-revision', itemId: 'widget-a', itemRevision: 1 }],
    })).rejects.toMatchObject({ code: 'WIDGET_CATALOG_CHANGED' });
    const snapshot = await canvas.getSnapshot({ canvasId: 'canvas-a' });
    expect(fnReadCanvasWidgetExtension(snapshot.items[0]!.item)).toMatchObject({
      type: 'widget-preview',
      instanceId: 'preview-a',
    });
  });

  test('rejects a newly resolved widget placement while deletion admission is fenced', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a');
    const admitted: string[] = [];
    const canvas = new CanvasService({
      store,
      widgetPlacementAdmission: {
        async withAdmission(placements, operation) {
          admitted.push(`fence:${placements.map((item) => item.widgetKey).join(',')}`);
          return operation();
        },
        async assertAllowed(input) {
          admitted.push(`${input.type}:${input.widgetKey}`);
          throw Object.assign(new Error('Widget deletion is in progress.'), {
            code: 'WIDGET_DELETION_BUSY',
          });
        },
      },
    });

    await expect(canvas.execute(insertCommand(
      'late-widget',
      'canvas-a',
      0,
      widget('widget-a', 'instance-a'),
    ))).rejects.toMatchObject({ code: 'WIDGET_DELETION_BUSY' });
    expect(admitted).toEqual(['fence:counter', 'widget-instance:counter']);
    expect((await canvas.getSnapshot({ canvasId: 'canvas-a' })).items).toEqual([]);
  });

  test('rejects conflicting descriptors for one durable image resource', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a', [
      image('image-a', 'resource-a', 'https://media.test/a.png'),
    ]);
    const canvas = service(store);

    await expect(canvas.execute(insertCommand(
      'image-b',
      'canvas-a',
      0,
      image('image-b', 'resource-a', 'https://media.test/b.png'),
    ))).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
  });

  test('publishes committed events and resyncs when replay history has a gap', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a');
    const canvas = service(store, 1);
    const live = canvas.subscribe({ canvasId: 'canvas-a', afterRevision: 0 })
      [Symbol.asyncIterator]();
    const next = live.next();
    const first = await canvas.execute(insertCommand('a', 'canvas-a', 0, rect('a')));
    expect(await next).toEqual({ done: false, value: first });
    await canvas.execute(insertCommand('b', 'canvas-a', 0, rect('b')));
    await live.return?.();

    const replay = canvas.subscribe({ canvasId: 'canvas-a', afterRevision: 0 })
      [Symbol.asyncIterator]();
    expect(await replay.next()).toEqual({
      done: false,
      value: { type: 'resync-required', canvasId: 'canvas-a', revision: 2 },
    });
    await replay.return?.();
  });

  test('forces resync after an unclear store failure and admits a safe retry', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a');
    const canvas = service(store);
    const command = insertCommand('a', 'canvas-a', 0, rect('a'));
    store.failNextApply = true;

    await expect(canvas.execute(command)).rejects.toMatchObject({ code: 'STORE_CONFLICT' });
    expect((await canvas.execute(command)).revision).toBe(1);
    expect((await canvas.getSnapshot({ canvasId: 'canvas-a' })).items).toHaveLength(1);
  });

  test('emits an explicit resync after authority restart when volatile replay is gone', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a');
    const beforeRestart = service(store);
    await beforeRestart.execute(insertCommand('a', 'canvas-a', 0, rect('a')));
    await beforeRestart.stop();

    const restarted = service(store);
    const events = restarted.subscribe({ canvasId: 'canvas-a', afterRevision: 0 })
      [Symbol.asyncIterator]();
    expect(await events.next()).toEqual({
      done: false,
      value: { type: 'resync-required', canvasId: 'canvas-a', revision: 1 },
    });
    await events.return?.();
    await restarted.stop();
  });

  test('serializes deletion with commands and closes subscriptions at the claimed boundary', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a');
    const canvas = service(store);
    const events = canvas.subscribe({ canvasId: 'canvas-a', afterRevision: 0 })
      [Symbol.asyncIterator]();
    const pendingEvent = events.next();
    await Promise.resolve();

    await canvas.beginDeletion({ canvasId: 'canvas-a' });
    const lateEvents = canvas.subscribe({ canvasId: 'canvas-a', afterRevision: 0 })
      [Symbol.asyncIterator]();
    await expect(lateEvents.next()).rejects.toMatchObject({ code: 'STORE_CONFLICT' });
    await expect(canvas.beginDeletion({ canvasId: 'canvas-a' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(canvas.execute(insertCommand('after-claim', 'canvas-a', 0, rect('late'))))
      .rejects.toMatchObject({ code: 'STORE_CONFLICT' });

    await canvas.abortDeletion({ canvasId: 'canvas-a' });
    const recovered = await canvas.execute(insertCommand('after-abort', 'canvas-a', 0, rect('safe')));
    expect(recovered.revision).toBe(1);
    expect(await pendingEvent).toEqual({ done: false, value: recovered });
    const pendingClose = events.next();

    await canvas.beginDeletion({ canvasId: 'canvas-a' });
    store.canvases.delete('canvas-a');
    await canvas.commitDeletion({ canvasId: 'canvas-a' });
    expect(await pendingClose).toEqual({ done: true, value: undefined });
    await expect(canvas.execute(insertCommand('after-commit', 'canvas-a', 1, rect('never'))))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('waits for an already-owned command before deletion ownership settles', async () => {
    const store = new MemoryCanvasStore();
    store.createCanvas('canvas-a');
    const canvas = service(store);
    let releaseApply!: () => void;
    let markStarted!: () => void;
    store.applyGate = new Promise<void>((resolve) => { releaseApply = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    store.onApplyStarted = markStarted;

    const command = canvas.execute(insertCommand('before-delete', 'canvas-a', 0, rect('owned')));
    await started;
    const deletion = canvas.beginDeletion({ canvasId: 'canvas-a' });
    let deletionSettled = false;
    void deletion.finally(() => { deletionSettled = true; });
    await Promise.resolve();
    expect(deletionSettled).toBe(false);

    releaseApply();
    await expect(command).resolves.toMatchObject({ commandId: 'before-delete', revision: 1 });
    await expect(deletion).resolves.toBeUndefined();
  });
});
