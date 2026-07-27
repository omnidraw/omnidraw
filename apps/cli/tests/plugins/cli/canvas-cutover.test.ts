import { describe, expect, test } from 'bun:test';
import type {
  TCanvasCommand,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from '@vibecanvas/canvas-contract';
import { parseCanvasSubcommandArgs } from '../../../src/plugins/cli/cmds/canvas-argv';
import { runCanvasAddCommand } from '../../../src/plugins/cli/cmds/cmd.add.canvas';
import { runCanvasDeleteCommand } from '../../../src/plugins/cli/cmds/cmd.delete.canvas';
import { runCanvasGroupCommand } from '../../../src/plugins/cli/cmds/cmd.group.canvas';
import { runCanvasListCommand } from '../../../src/plugins/cli/cmds/cmd.list.canvas';
import { runCanvasMoveCommand } from '../../../src/plugins/cli/cmds/cmd.move.canvas';
import { runCanvasPatchCommand } from '../../../src/plugins/cli/cmds/cmd.patch.canvas';
import { runCanvasQueryCommand } from '../../../src/plugins/cli/cmds/cmd.query.canvas';
import { runCanvasReorderCommand } from '../../../src/plugins/cli/cmds/cmd.reorder.canvas';
import { runCanvasUngroupCommand } from '../../../src/plugins/cli/cmds/cmd.ungroup.canvas';
import type {
  ICanvasCliApi,
  TCanvasApiResult,
  TCanvasListEntry,
  TCanvasNode,
} from '../../../src/plugins/cli/cmds/interface';
import { fnCanvasWebSocketUrl } from '../../../src/plugins/cli/core/fn.canvas-websocket-url';

const transform = Object.freeze({
  position: Object.freeze({ x: 10, y: 20 }),
  rotation: 0,
  scale: Object.freeze({ x: 1, y: 1 }),
  skew: Object.freeze({ x: 0, y: 0 }),
  origin: Object.freeze({ x: 0, y: 0 }),
});

function node(
  id: string,
  parentId: string | null = null,
  kind: 'rect' | 'group' = 'rect',
  orderKey = id,
): TCanvasNode {
  if (kind === 'group') {
    return { id, parentId, orderKey, kind, transform } as TCanvasNode;
  }
  return {
    id,
    parentId,
    orderKey,
    kind,
    transform,
    size: { width: 100, height: 60 },
  } as TCanvasNode;
}

function canvasSnapshot(items: readonly TCanvasNode[]): TCanvasSnapshot {
  return {
    canvasId: 'canvas-a',
    revision: 7,
    items: items.map((item, index) => ({
      id: item.id,
      item,
      itemRevision: index + 10,
      createdAtMs: 1,
      updatedAtMs: 2,
    })),
  };
}

class FakeCanvasApi implements ICanvasCliApi {
  canvases: readonly TCanvasListEntry[] = [{
    id: 'canvas-a',
    name: 'Sketch',
    revision: 7,
    created_at: '2026-07-27T00:00:00.000Z',
  }];
  snapshotValue = canvasSnapshot([]);
  queryValue: TCanvasItemPage = { items: [], nextCursor: null };
  readonly queries: TCanvasItemQuery[] = [];
  readonly executions: TCanvasCommand[] = [];

  list(): TCanvasApiResult<readonly TCanvasListEntry[]> {
    return Promise.resolve([null, this.canvases] as const);
  }

  snapshot(
    input: Readonly<{ canvasId: string }>,
  ): TCanvasApiResult<TCanvasSnapshot> {
    expect(input).toEqual({ canvasId: 'canvas-a' });
    return Promise.resolve([null, this.snapshotValue] as const);
  }

  query(input: TCanvasItemQuery): TCanvasApiResult<TCanvasItemPage> {
    this.queries.push(input);
    return Promise.resolve([null, this.queryValue] as const);
  }

  execute(input: TCanvasCommand): TCanvasApiResult<TCanvasItemsChangedEvent> {
    this.executions.push(input);
    return Promise.resolve([null, {
      type: 'items-changed',
      canvasId: input.canvasId,
      commandId: input.commandId,
      revision: this.snapshotValue.revision + 1,
      changedItems: [],
      deletedItemIds: input.operations.flatMap((operation) => (
        operation.type === 'delete' ? [operation.itemId] : []
      )),
    }] as const);
  }
}

describe('canvas CLI A92 cutover', () => {
  test('parses complete node JSON without treating payload commas as id separators', () => {
    const parsed = parseCanvasSubcommandArgs('add', [
      '--canvas',
      'canvas-a',
      '--item',
      JSON.stringify(node('rect-a')),
      '--dry-run',
    ]);

    expect(parsed).toMatchObject({
      subcommand: 'add',
      input: {
        canvasId: 'canvas-a',
        dryRun: true,
        items: [{ id: 'rect-a', kind: 'rect' }],
      },
    });
  });

  test('parses the contract-native query filters and rejects mixed filters', () => {
    expect(parseCanvasSubcommandArgs('query', [
      '--canvas',
      'canvas-a',
      '--widget-definition',
      'clock',
      '--revision',
      'r2',
      '--limit',
      '25',
    ])).toEqual({
      subcommand: 'query',
      input: {
        canvasId: 'canvas-a',
        filter: {
          type: 'widget-definition',
          definitionId: 'clock',
          revisionId: 'r2',
        },
        limit: 25,
      },
    });

    expect(() => parseCanvasSubcommandArgs('query', [
      '--canvas',
      'canvas-a',
      '--id',
      'rect-a',
      '--kind',
      'rect',
    ])).toThrow();
  });

  test('lists and queries only through the canvas API', async () => {
    const api = new FakeCanvasApi();
    api.queryValue = {
      items: canvasSnapshot([node('rect-a')]).items,
      nextCursor: { type: 'id', id: 'rect-a' },
    };

    const listed = await runCanvasListCommand(api);
    const queried = await runCanvasQueryCommand(api, {
      canvasNameQuery: 'ket',
      filter: { type: 'kind', kind: 'rect' },
      limit: 10,
    });

    expect(listed.payload).toMatchObject({
      command: 'canvas.list',
      canvases: [{ id: 'canvas-a', name: 'Sketch' }],
    });
    expect(api.queries).toEqual([{
      canvasId: 'canvas-a',
      filter: { type: 'kind', kind: 'rect' },
      limit: 10,
    }]);
    expect(queried.payload).toMatchObject({
      command: 'canvas.query',
      canvasId: 'canvas-a',
      items: [{ id: 'rect-a' }],
    });
  });

  test('adds full Cangine nodes with item-absent guards', async () => {
    const api = new FakeCanvasApi();
    const item = node('rect-a');

    await runCanvasAddCommand(api, {
      canvasId: 'canvas-a',
      dryRun: false,
      items: [item],
    }, () => 'command-add');

    expect(api.executions).toEqual([{
      commandId: 'command-add',
      canvasId: 'canvas-a',
      baseRevision: 7,
      operations: [{ type: 'insert', item }],
      preconditions: [{ type: 'item-absent', itemId: 'rect-a' }],
    }]);
  });

  test('dry-run plans guarded patches without calling execute', async () => {
    const api = new FakeCanvasApi();
    api.snapshotValue = canvasSnapshot([node('rect-a')]);

    const result = await runCanvasPatchCommand(api, {
      canvasId: 'canvas-a',
      dryRun: true,
      ids: ['rect-a'],
      patches: [{
        type: 'set',
        path: ['extensions', 'demo:value'],
        value: 3,
      }],
    }, () => 'command-patch');

    expect(api.executions).toHaveLength(0);
    expect(result.payload).toMatchObject({
      command: 'canvas.patch',
      dryRun: true,
      request: {
        commandId: 'command-patch',
        operations: [{ type: 'patch', itemId: 'rect-a' }],
        preconditions: [{
          type: 'item-revision',
          itemId: 'rect-a',
          itemRevision: 10,
        }],
      },
    });
  });

  test('moves nodes by guarded Cangine transform patches', async () => {
    const api = new FakeCanvasApi();
    api.snapshotValue = canvasSnapshot([node('rect-a')]);

    await runCanvasMoveCommand(api, {
      canvasId: 'canvas-a',
      dryRun: false,
      ids: ['rect-a'],
      mode: 'relative',
      x: 5,
      y: -3,
    }, () => 'command-move');

    expect(api.executions[0]).toMatchObject({
      operations: [{
        type: 'patch',
        itemId: 'rect-a',
        patches: [
          { type: 'set', path: ['transform', 'position', 'x'], value: 15 },
          { type: 'set', path: ['transform', 'position', 'y'], value: 17 },
        ],
      }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'rect-a',
        itemRevision: 10,
      }],
    });
  });

  test('groups and ungroups through atomic insert/reparent/delete operations', async () => {
    const api = new FakeCanvasApi();
    api.snapshotValue = canvasSnapshot([
      node('rect-a', null, 'rect', 'A'),
      node('rect-b', null, 'rect', 'B'),
    ]);

    await runCanvasGroupCommand(api, {
      canvasId: 'canvas-a',
      dryRun: false,
      ids: ['rect-a', 'rect-b'],
      groupId: 'group-a',
    }, () => 'command-group');

    expect(api.executions[0]).toMatchObject({
      operations: [
        {
          type: 'insert',
          item: {
            id: 'group-a',
            parentId: null,
            orderKey: 'A',
            kind: 'group',
          },
        },
        { type: 'reparent', itemId: 'rect-a', parentId: 'group-a' },
        { type: 'reparent', itemId: 'rect-b', parentId: 'group-a' },
      ],
      preconditions: [
        { type: 'item-absent', itemId: 'group-a' },
        { type: 'item-revision', itemId: 'rect-a', itemRevision: 10 },
        { type: 'item-revision', itemId: 'rect-b', itemRevision: 11 },
      ],
    });

    const ungroupApi = new FakeCanvasApi();
    ungroupApi.snapshotValue = canvasSnapshot([
      node('group-a', null, 'group', 'A'),
      node('rect-a', 'group-a', 'rect', 'A'),
      node('rect-b', 'group-a', 'rect', 'B'),
    ]);
    await runCanvasUngroupCommand(ungroupApi, {
      canvasId: 'canvas-a',
      dryRun: false,
      groupId: 'group-a',
    }, () => 'command-ungroup');

    expect(ungroupApi.executions[0]?.operations).toEqual([
      { type: 'reparent', itemId: 'rect-a', parentId: null, orderKey: 'A' },
      { type: 'reparent', itemId: 'rect-b', parentId: null, orderKey: 'B' },
      { type: 'delete', itemId: 'group-a' },
    ]);
  });

  test('reorders with an explicit orderKey and revision guard', async () => {
    const api = new FakeCanvasApi();
    api.snapshotValue = canvasSnapshot([node('rect-a')]);

    await runCanvasReorderCommand(api, {
      canvasId: 'canvas-a',
      dryRun: false,
      id: 'rect-a',
      orderKey: 'Z9',
    }, () => 'command-reorder');

    expect(api.executions[0]).toMatchObject({
      operations: [{ type: 'reorder', itemId: 'rect-a', orderKey: 'Z9' }],
      preconditions: [{
        type: 'item-revision',
        itemId: 'rect-a',
        itemRevision: 10,
      }],
    });
  });

  test('deletes complete group subtrees in one guarded command', async () => {
    const api = new FakeCanvasApi();
    api.snapshotValue = canvasSnapshot([
      node('group-a', null, 'group'),
      node('group-b', 'group-a', 'group'),
      node('rect-a', 'group-b'),
      node('untouched'),
    ]);

    await runCanvasDeleteCommand(api, {
      canvasId: 'canvas-a',
      dryRun: false,
      ids: ['group-a'],
    }, () => 'command-delete');

    expect(api.executions[0]?.operations).toEqual([
      { type: 'delete', itemId: 'rect-a' },
      { type: 'delete', itemId: 'group-b' },
      { type: 'delete', itemId: 'group-a' },
    ]);
    expect(api.executions[0]?.preconditions).toHaveLength(3);
  });

  test('targets the live local oRPC WebSocket endpoint', () => {
    expect(fnCanvasWebSocketUrl(7496)).toBe('ws://127.0.0.1:7496/api');
  });
});
