import type {
  TCanvasItemPatch,
  TCanvasJsonPath,
  TCanvasPrecondition,
} from '@vibecanvas/canvas-contract';
import type { TJsonValue, TSceneNode } from '@omnidraw/cangine';
import { CANVAS_SYNTHETIC_CONTENT_LAYER_ID } from '@vibecanvas/canvas-contract/CONSTANTS';

type TCanvasNodeDiff = Readonly<{
  patches: readonly TCanvasItemPatch[];
  preconditions: readonly TCanvasPrecondition[];
}>;

type TCanvasNodeStructureDiff = Readonly<{
  parentChanged: boolean;
  orderChanged: boolean;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && equalJson(left[key], right[key])
    ));
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJson(entry)) as T;
  }
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]),
  ) as T;
}

function collectDiff(
  itemId: string,
  before: unknown,
  after: unknown,
  path: readonly (string | number)[],
  patches: TCanvasItemPatch[],
  preconditions: TCanvasPrecondition[],
): void {
  if (equalJson(before, after)) return;
  if (before === undefined) {
    patches.push({ type: 'set', path, value: cloneJson(after) as TJsonValue });
    preconditions.push({ type: 'path-absent', itemId, path });
    return;
  }
  if (after === undefined) {
    patches.push({ type: 'remove', path });
    preconditions.push({
      type: 'path-value',
      itemId,
      path,
      value: cloneJson(before) as TJsonValue,
    });
    return;
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      collectDiff(
        itemId,
        before[key],
        after[key],
        [...path, key],
        patches,
        preconditions,
      );
    }
    return;
  }
  patches.push({ type: 'set', path, value: cloneJson(after) as TJsonValue });
  preconditions.push({
    type: 'path-value',
    itemId,
    path,
    value: cloneJson(before) as TJsonValue,
  });
}

export function fnDiffSceneNodes(
  before: TSceneNode,
  after: TSceneNode,
): TCanvasNodeDiff {
  if (before.id !== after.id) {
    throw new TypeError('Scene nodes with different IDs cannot be diffed.');
  }
  const patches: TCanvasItemPatch[] = [];
  const preconditions: TCanvasPrecondition[] = [];
  const keys = [...new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])]
    .filter((key) => (
      key !== 'id'
      && key !== 'parentId'
      && key !== 'orderKey'
    ))
    .sort();
  for (const key of keys) {
    collectDiff(
      before.id,
      before[key as keyof TSceneNode],
      after[key as keyof TSceneNode],
      [key],
      patches,
      preconditions,
    );
  }
  return Object.freeze({
    patches: Object.freeze(patches),
    preconditions: Object.freeze(preconditions),
  });
}

export function fnDiffSceneNodeStructure(
  before: TSceneNode,
  after: TSceneNode,
): TCanvasNodeStructureDiff {
  if (before.id !== after.id) {
    throw new TypeError('Scene nodes with different IDs cannot be compared.');
  }
  return Object.freeze({
    parentChanged: before.parentId !== after.parentId,
    orderChanged: before.orderKey !== after.orderKey,
  });
}

export function fnApplySceneNodePatches(
  node: TSceneNode,
  patches: readonly TCanvasItemPatch[],
): TSceneNode {
  const root = cloneJson(node) as unknown as Record<string, unknown>;
  for (const patch of patches) {
    if (patch.path.length === 0) {
      if (patch.type === 'remove') {
        throw new TypeError('A complete scene node cannot be removed with a JSON patch.');
      }
      return cloneJson(patch.value) as unknown as TSceneNode;
    }
    let parent = root;
    for (const segment of patch.path.slice(0, -1)) {
      const next = parent[String(segment)];
      if (!isObject(next) && !Array.isArray(next)) {
        throw new TypeError('A canvas JSON patch traversed a non-container value.');
      }
      parent = next as Record<string, unknown>;
    }
    const leaf = String(patch.path.at(-1)!);
    if (patch.type === 'remove') delete parent[leaf];
    else parent[leaf] = cloneJson(patch.value);
  }
  return root as unknown as TSceneNode;
}

export function fnRuntimeCanvasNode(node: TSceneNode): TSceneNode {
  const runtimeNode = node.parentId === null
    ? { ...cloneJson(node), parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID }
    : cloneJson(node);
  if (runtimeNode.kind !== 'widget-frame' || runtimeNode.portal !== undefined) {
    return runtimeNode;
  }
  return {
    ...runtimeNode,
    portal: {
      portalId: `vibecanvas:widget:${runtimeNode.id}`,
      interactive: true,
      scaleMode: 'world',
      suspendWhenOffscreen: true,
      overscan: 96,
    },
  };
}

export function fnAuthoredCanvasNode(node: TSceneNode): TSceneNode {
  const authoredNode = node.parentId === CANVAS_SYNTHETIC_CONTENT_LAYER_ID
    ? { ...cloneJson(node), parentId: null }
    : cloneJson(node);
  if (authoredNode.kind !== 'widget-frame' || authoredNode.portal === undefined) {
    return authoredNode;
  }
  const { portal: _runtimePortal, ...persistedNode } = authoredNode;
  return persistedNode as TSceneNode;
}

export type { TCanvasNodeDiff, TCanvasNodeStructureDiff };
