import type {
  TCanvasCommand,
  TCanvasItemPatch,
  TCanvasItemSnapshot,
  TCanvasOperation,
  TCanvasPrecondition,
  TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { CANVAS_GROUP_TRANSFORM } from './CONSTANTS';
import type {
  TCanvasAddInput,
  TCanvasCliErrorPayload,
  TCanvasDeleteInput,
  TCanvasGroupInput,
  TCanvasMoveInput,
  TCanvasNode,
  TCanvasPatchInput,
  TCanvasReorderInput,
  TCanvasUngroupInput,
} from './interface';

export function fnCanvasCliError(
  command: string,
  code: string,
  message: string,
  hint?: string,
  next?: string,
): TCanvasCliErrorPayload {
  return {
    ok: false,
    command,
    code,
    message,
    ...(hint === undefined ? {} : { hint }),
    ...(next === undefined ? {} : { next }),
  };
}

function fail(
  command: string,
  code: string,
  message: string,
  hint?: string,
): never {
  throw fnCanvasCliError(command, code, message, hint);
}

function uniqueIds(command: string, ids: readonly string[]): readonly string[] {
  const normalized = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (normalized.length === 0) {
    fail(command, 'CANVAS_ITEM_ID_REQUIRED', 'Pass at least one non-empty --id.');
  }
  return normalized;
}

function snapshotItemMap(
  snapshot: TCanvasSnapshot,
): ReadonlyMap<string, TCanvasItemSnapshot> {
  return new Map(snapshot.items.map((item) => [item.id, item]));
}

function requireItems(
  command: string,
  snapshot: TCanvasSnapshot,
  ids: readonly string[],
): readonly TCanvasItemSnapshot[] {
  const byId = snapshotItemMap(snapshot);
  return ids.map((id) => {
    const item = byId.get(id);
    if (item === undefined) {
      return fail(
        command,
        'CANVAS_ITEM_NOT_FOUND',
        `Canvas item '${id}' does not exist in revision ${snapshot.revision}.`,
      );
    }
    return item;
  });
}

function revisionPreconditions(
  items: readonly TCanvasItemSnapshot[],
): readonly TCanvasPrecondition[] {
  return items.map((item) => ({
    type: 'item-revision',
    itemId: item.id,
    itemRevision: item.itemRevision,
  }));
}

function command(
  snapshot: TCanvasSnapshot,
  commandId: string,
  operations: readonly TCanvasOperation[],
  preconditions: readonly TCanvasPrecondition[],
): TCanvasCommand {
  return {
    commandId,
    canvasId: snapshot.canvasId,
    baseRevision: snapshot.revision,
    operations,
    preconditions,
  };
}

export function fnBuildCanvasAddCommand(
  snapshot: TCanvasSnapshot,
  input: TCanvasAddInput,
  commandId: string,
): TCanvasCommand {
  if (input.items.length === 0) {
    fail('canvas.add', 'CANVAS_ITEM_REQUIRED', 'Pass at least one full Cangine node with --item.');
  }
  const ids = input.items.map((item) => item.id?.trim());
  if (ids.some((id) => !id)) {
    fail('canvas.add', 'CANVAS_ITEM_ID_REQUIRED', 'Every added Cangine node must have a non-empty id.');
  }
  if (new Set(ids).size !== ids.length) {
    fail('canvas.add', 'CANVAS_ITEM_ID_DUPLICATE', 'Added Cangine node ids must be unique.');
  }
  return command(
    snapshot,
    commandId,
    input.items.map((item) => ({ type: 'insert', item })),
    input.items.map((item) => ({
      type: 'item-absent',
      itemId: item.id,
    })),
  );
}

export function fnBuildCanvasPatchCommand(
  snapshot: TCanvasSnapshot,
  input: TCanvasPatchInput,
  commandId: string,
): TCanvasCommand {
  const ids = uniqueIds('canvas.patch', input.ids);
  if (input.patches.length === 0) {
    fail('canvas.patch', 'CANVAS_PATCH_REQUIRED', '--patch must contain at least one JSON-path patch.');
  }
  const items = requireItems('canvas.patch', snapshot, ids);
  return command(
    snapshot,
    commandId,
    ids.map((itemId) => ({
      type: 'patch',
      itemId,
      patches: input.patches,
    })),
    revisionPreconditions(items),
  );
}

export function fnBuildCanvasMoveCommand(
  snapshot: TCanvasSnapshot,
  input: TCanvasMoveInput,
  commandId: string,
): TCanvasCommand {
  const ids = uniqueIds('canvas.move', input.ids);
  if (input.x === undefined && input.y === undefined) {
    fail('canvas.move', 'CANVAS_MOVE_COORDINATE_REQUIRED', 'Pass --x, --y, or both.');
  }
  const items = requireItems('canvas.move', snapshot, ids);
  const operations: TCanvasOperation[] = items.map((entry) => {
    const patches: TCanvasItemPatch[] = [];
    if (input.x !== undefined) {
      patches.push({
        type: 'set',
        path: ['transform', 'position', 'x'],
        value: input.mode === 'relative'
          ? entry.item.transform.position.x + input.x
          : input.x,
      });
    }
    if (input.y !== undefined) {
      patches.push({
        type: 'set',
        path: ['transform', 'position', 'y'],
        value: input.mode === 'relative'
          ? entry.item.transform.position.y + input.y
          : input.y,
      });
    }
    return { type: 'patch', itemId: entry.id, patches };
  });
  return command(
    snapshot,
    commandId,
    operations,
    revisionPreconditions(items),
  );
}

export function fnBuildCanvasGroupCommand(
  snapshot: TCanvasSnapshot,
  input: TCanvasGroupInput,
  commandId: string,
): TCanvasCommand {
  const ids = uniqueIds('canvas.group', input.ids);
  if (ids.length < 2) {
    fail('canvas.group', 'CANVAS_GROUP_TARGETS_REQUIRED', 'Grouping requires at least two distinct --id targets.');
  }
  const groupId = input.groupId.trim();
  if (!groupId) {
    fail('canvas.group', 'CANVAS_GROUP_ID_REQUIRED', '--group-id must be non-empty.');
  }
  if (ids.includes(groupId)) {
    fail(
      'canvas.group',
      'CANVAS_GROUP_ID_CONFLICT',
      '--group-id must differ from every grouped item id.',
    );
  }
  const items = requireItems('canvas.group', snapshot, ids);
  const parentId = items[0]!.item.parentId;
  if (items.some((entry) => entry.item.parentId !== parentId)) {
    fail(
      'canvas.group',
      'CANVAS_GROUP_PARENT_MISMATCH',
      'All grouped nodes must currently share one parent.',
    );
  }
  const firstByOrder = [...items].sort((left, right) => (
    left.item.orderKey.localeCompare(right.item.orderKey)
    || left.id.localeCompare(right.id)
  ))[0]!;
  const group = {
    id: groupId,
    parentId,
    orderKey: firstByOrder.item.orderKey,
    kind: 'group',
    transform: CANVAS_GROUP_TRANSFORM,
  } as TCanvasNode;
  return command(
    snapshot,
    commandId,
    [
      { type: 'insert', item: group },
      ...items.map((entry): TCanvasOperation => ({
        type: 'reparent',
        itemId: entry.id,
        parentId: groupId,
        orderKey: entry.item.orderKey,
      })),
    ],
    [
      { type: 'item-absent', itemId: groupId },
      ...revisionPreconditions(items),
    ],
  );
}

export function fnBuildCanvasUngroupCommand(
  snapshot: TCanvasSnapshot,
  input: TCanvasUngroupInput,
  commandId: string,
): TCanvasCommand {
  const groupId = input.groupId.trim();
  const [group] = requireItems('canvas.ungroup', snapshot, [groupId]);
  if (group!.item.kind !== 'group') {
    fail('canvas.ungroup', 'CANVAS_GROUP_REQUIRED', `Canvas item '${groupId}' is not a group node.`);
  }
  const children = snapshot.items
    .filter((entry) => entry.item.parentId === groupId)
    .sort((left, right) => (
      left.item.orderKey.localeCompare(right.item.orderKey)
      || left.id.localeCompare(right.id)
    ));
  return command(
    snapshot,
    commandId,
    [
      ...children.map((entry): TCanvasOperation => ({
        type: 'reparent',
        itemId: entry.id,
        parentId: group!.item.parentId,
        orderKey: entry.item.orderKey,
      })),
      { type: 'delete', itemId: groupId },
    ],
    revisionPreconditions([...children, group!]),
  );
}

export function fnBuildCanvasReorderCommand(
  snapshot: TCanvasSnapshot,
  input: TCanvasReorderInput,
  commandId: string,
): TCanvasCommand {
  const id = input.id.trim();
  const orderKey = input.orderKey.trim();
  if (!id) fail('canvas.reorder', 'CANVAS_ITEM_ID_REQUIRED', 'Pass one --id.');
  if (!orderKey) {
    fail('canvas.reorder', 'CANVAS_ORDER_KEY_REQUIRED', '--order-key must be non-empty.');
  }
  const [item] = requireItems('canvas.reorder', snapshot, [id]);
  return command(
    snapshot,
    commandId,
    [{ type: 'reorder', itemId: id, orderKey }],
    revisionPreconditions([item!]),
  );
}

function itemDepth(
  byId: ReadonlyMap<string, TCanvasItemSnapshot>,
  item: TCanvasItemSnapshot,
): number {
  let depth = 0;
  let parentId = item.item.parentId;
  const visited = new Set<string>();
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    depth += 1;
    parentId = parent.item.parentId;
  }
  return depth;
}

export function fnBuildCanvasDeleteCommand(
  snapshot: TCanvasSnapshot,
  input: TCanvasDeleteInput,
  commandId: string,
): TCanvasCommand {
  const ids = uniqueIds('canvas.delete', input.ids);
  requireItems('canvas.delete', snapshot, ids);
  const deleting = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of snapshot.items) {
      if (
        entry.item.parentId !== null
        && deleting.has(entry.item.parentId)
        && !deleting.has(entry.id)
      ) {
        deleting.add(entry.id);
        changed = true;
      }
    }
  }
  const byId = snapshotItemMap(snapshot);
  const items = [...deleting]
    .map((id) => byId.get(id)!)
    .sort((left, right) => (
      itemDepth(byId, right) - itemDepth(byId, left)
      || left.id.localeCompare(right.id)
    ));
  return command(
    snapshot,
    commandId,
    items.map((entry) => ({ type: 'delete', itemId: entry.id })),
    revisionPreconditions(items),
  );
}
