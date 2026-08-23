import {
  fnValidateCanvasItems,
  type TCanvasCommand,
  type TCanvasItemSnapshot,
  type TCanvasItemsChangedEvent,
  type TCanvasPrecondition,
  type TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { CanvasAuthorityError } from './errors';
import {
  fnApplyCanvasItemPatches,
  fnCloneCanvasItem,
  fnJsonEqual,
  fnReadJsonPath,
} from './fn.command';

type TCanvasNode = TCanvasItemSnapshot['item'];

export type TCanvasCommandReduction = Readonly<{
  event: TCanvasItemsChangedEvent;
  snapshot: TCanvasSnapshot;
}>;

export type TCanvasCommandItemChange = Readonly<{
  id: string;
  item: TCanvasNode | null;
}>;

export type TCanvasCommandItemReduction = Readonly<{
  changes: readonly TCanvasCommandItemChange[];
}>;

function assertPrecondition(
  precondition: TCanvasPrecondition,
  items: ReadonlyMap<string, TCanvasItemSnapshot>,
): void {
  const snapshot = items.get(precondition.itemId);
  if (precondition.type === 'item-absent') {
    if (snapshot !== undefined) throw new CanvasAuthorityError('CONFLICT', `Item '${precondition.itemId}' is no longer absent.`);
    return;
  }
  if (snapshot === undefined) throw new CanvasAuthorityError('CONFLICT', `Item '${precondition.itemId}' no longer exists.`);
  if (precondition.type === 'item-revision') {
    if (snapshot.itemRevision !== precondition.itemRevision) {
      throw new CanvasAuthorityError('CONFLICT', `Item '${precondition.itemId}' changed revision.`);
    }
    return;
  }
  const current = fnReadJsonPath(snapshot.item, precondition.path);
  if (precondition.type === 'path-absent') {
    if (current.exists) throw new CanvasAuthorityError('CONFLICT', `A guarded path on '${precondition.itemId}' now exists.`);
  } else if (!current.exists || !fnJsonEqual(current.value, precondition.value)) {
    throw new CanvasAuthorityError('CONFLICT', `A guarded path on '${precondition.itemId}' changed.`);
  }
}

/**
 * Authoritative command policy shared by every Canvas authority adapter.
 *
 * The caller supplies the current snapshots for every item named by an
 * operation or precondition. Persistence, retries, document-closure
 * validation, timestamps, and revision allocation stay adapter concerns.
 */
export function fnReduceCanvasCommandItems(args: Readonly<{
  command: TCanvasCommand;
  items: readonly TCanvasItemSnapshot[];
}>): TCanvasCommandItemReduction {
  if (args.command.operations.length === 0) {
    throw new CanvasAuthorityError('INVALID_COMMAND', 'Canvas command has no operations.');
  }

  const before = new Map(args.items.map((item) => [item.id, item]));
  const current = new Map(before);
  for (const precondition of args.command.preconditions) {
    assertPrecondition(precondition, before);
  }

  const changedIds = new Set<string>();
  for (const operation of args.command.operations) {
    const itemId = operation.type === 'insert' || operation.type === 'replace'
      ? operation.item.id
      : operation.itemId;
    const existing = current.get(itemId);
    if (operation.type === 'insert') {
      if (existing !== undefined) {
        throw new CanvasAuthorityError('CONFLICT', `Item '${itemId}' already exists.`);
      }
      current.set(itemId, {
        id: itemId,
        item: fnCloneCanvasItem(operation.item),
        itemRevision: 1,
        createdAtSec: '',
        updatedAtSec: '',
      });
    } else if (operation.type === 'delete') {
      if (existing === undefined) {
        throw new CanvasAuthorityError('CONFLICT', `Item '${itemId}' no longer exists.`);
      }
      current.delete(itemId);
    } else {
      if (existing === undefined) {
        throw new CanvasAuthorityError('CONFLICT', `Item '${itemId}' no longer exists.`);
      }
      let item: TCanvasNode;
      if (operation.type === 'replace') item = fnCloneCanvasItem(operation.item);
      else if (operation.type === 'patch') {
        const patched = fnApplyCanvasItemPatches(existing.item, operation.patches);
        if (!patched.ok) {
          throw new CanvasAuthorityError(
            'INVALID_COMMAND',
            `Patch '${itemId}' is invalid: ${patched.message}`,
          );
        }
        item = patched.item;
      }
      else if (operation.type === 'reparent') item = {
        ...fnCloneCanvasItem(existing.item),
        parentId: operation.parentId,
        ...(operation.orderKey === undefined ? {} : { orderKey: operation.orderKey }),
      } as TCanvasNode;
      else item = { ...fnCloneCanvasItem(existing.item), orderKey: operation.orderKey } as TCanvasNode;
      current.set(itemId, { ...existing, item });
    }
    changedIds.add(itemId);
  }

  const changes = [...changedIds].flatMap((id): TCanvasCommandItemChange[] => {
    const previous = before.get(id)?.item ?? null;
    const next = current.get(id)?.item ?? null;
    return fnJsonEqual(previous, next) ? [] : [Object.freeze({ id, item: next })];
  });
  if (changes.length === 0) {
    throw new CanvasAuthorityError('INVALID_COMMAND', 'The command does not change any Canvas item.');
  }
  return Object.freeze({ changes: Object.freeze(changes) });
}

export function fnReduceCanvasCommand(args: Readonly<{
  snapshot: TCanvasSnapshot;
  command: TCanvasCommand;
  timestamp: string;
}>): TCanvasCommandReduction {
  const { snapshot, command } = args;
  if (command.canvasId !== snapshot.canvasId) throw new CanvasAuthorityError('INVALID_COMMAND', 'Command targets another Canvas.');
  if (command.baseRevision > snapshot.revision) throw new CanvasAuthorityError('CONFLICT', 'Command base revision is ahead of authority.');
  const current = new Map(snapshot.items.map((item) => [item.id, item]));
  const itemReduction = fnReduceCanvasCommandItems({ command, items: snapshot.items });
  const changedIds = new Set(itemReduction.changes.map((change) => change.id));
  const deletedIds = new Set<string>();
  for (const change of itemReduction.changes) {
    const existing = current.get(change.id);
    if (change.item === null) {
      current.delete(change.id);
      deletedIds.add(change.id);
      continue;
    }
    current.set(change.id, {
      id: change.id,
      item: change.item,
      itemRevision: (existing?.itemRevision ?? 0) + 1,
      createdAtSec: existing?.createdAtSec ?? args.timestamp,
      updatedAtSec: args.timestamp,
    });
  }

  const validation = fnValidateCanvasItems([...current.values()].map((entry) => entry.item));
  if (!validation.valid) {
    throw new CanvasAuthorityError('INVALID_COMMAND', 'Command produces an invalid Canvas document.', {
      issues: validation.issues,
    });
  }
  for (const deletedId of deletedIds) {
    const child = [...current.values()].find((entry) => entry.item.parentId === deletedId);
    if (child !== undefined) throw new CanvasAuthorityError('CONFLICT', `Item '${deletedId}' still owns child '${child.id}'.`);
  }

  const revision = snapshot.revision + 1;
  const changedItems = [...changedIds].map((id) => current.get(id)!).sort((left, right) => left.id.localeCompare(right.id));
  const deletedItemIds = [...deletedIds].sort();
  const event: TCanvasItemsChangedEvent = Object.freeze({
    type: 'items-changed',
    canvasId: snapshot.canvasId,
    commandId: command.commandId,
    revision,
    changedItems: Object.freeze(changedItems),
    deletedItemIds: Object.freeze(deletedItemIds),
  });
  return Object.freeze({
    event,
    snapshot: Object.freeze({
      ...snapshot,
      revision,
      items: Object.freeze([...current.values()].sort((left, right) => left.id.localeCompare(right.id))),
    }),
  });
}
