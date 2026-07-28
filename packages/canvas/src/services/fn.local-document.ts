import type { TSceneNode } from '@omnidraw/cangine';
import type { TEditorSceneMutationRequest } from '@omnidraw/cangine/editor';

export type TLocalDocumentNodeImage = TSceneNode | null;

export type TLocalDocumentReduction = Readonly<{
  nodes: ReadonlyMap<string, TSceneNode>;
  before: ReadonlyMap<string, TLocalDocumentNodeImage>;
  after: ReadonlyMap<string, TLocalDocumentNodeImage>;
  affectedNodeIds: readonly string[];
}>;

type TMutableLocalDocument = {
  base: ReadonlyMap<string, TSceneNode>;
  changes: Map<string, TLocalDocumentNodeImage>;
  children: Map<string | null, Set<string>> | null;
};

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equalData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left === 'number'
    && typeof right === 'number'
    && left === right
  ) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalData(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort(codePointCompare);
  const rightKeys = Object.keys(right).sort(codePointCompare);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && equalData(left[key], right[key])
    ));
}

function cloneFrozenData(value: unknown): unknown {
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneFrozenData(entry)));
  }
  if (!isObject(value)) return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneFrozenData(entry)]),
  ));
}

function cloneFrozenNode(node: TSceneNode): TSceneNode {
  return cloneFrozenData(node) as TSceneNode;
}

function addChild(
  children: Map<string | null, Set<string>>,
  parentId: string | null,
  nodeId: string,
): void {
  const siblings = children.get(parentId);
  if (siblings === undefined) {
    children.set(parentId, new Set([nodeId]));
  } else {
    siblings.add(nodeId);
  }
}

function removeChild(
  children: Map<string | null, Set<string>>,
  parentId: string | null,
  nodeId: string,
): void {
  const siblings = children.get(parentId);
  if (siblings === undefined) return;
  siblings.delete(nodeId);
  if (siblings.size === 0) children.delete(parentId);
}

function indexChildren(
  nodes: ReadonlyMap<string, TSceneNode>,
): Map<string | null, Set<string>> {
  const children = new Map<string | null, Set<string>>();
  for (const [nodeId, node] of nodes) {
    if (node.id !== nodeId) {
      throw new TypeError(
        `Local document entry '${nodeId}' contains node '${node.id}'.`,
      );
    }
    addChild(children, node.parentId, nodeId);
  }
  return children;
}

function readNode(
  state: TMutableLocalDocument,
  nodeId: string,
): TSceneNode | undefined {
  if (!state.changes.has(nodeId)) return state.base.get(nodeId);
  return state.changes.get(nodeId) ?? undefined;
}

function overlayNodes(
  base: ReadonlyMap<string, TSceneNode>,
  changes: ReadonlyMap<string, TLocalDocumentNodeImage>,
): ReadonlyMap<string, TSceneNode> {
  let size = base.size;
  for (const [nodeId, node] of changes) {
    if (node === null && base.has(nodeId)) size -= 1;
    else if (node !== null && !base.has(nodeId)) size += 1;
  }
  const get = (nodeId: string): TSceneNode | undefined => (
    changes.has(nodeId)
      ? changes.get(nodeId) ?? undefined
      : base.get(nodeId)
  );
  const entries = function* (): IterableIterator<[string, TSceneNode]> {
    for (const [nodeId, baseNode] of base) {
      const node = changes.has(nodeId) ? changes.get(nodeId) : baseNode;
      if (node !== null && node !== undefined) yield [nodeId, node];
    }
    for (const [nodeId, node] of changes) {
      if (base.has(nodeId) || node === null) continue;
      yield [nodeId, node];
    }
  };
  const view = {
    size,
    get,
    has: (nodeId: string) => get(nodeId) !== undefined,
    entries,
    keys: function* (): IterableIterator<string> {
      for (const [nodeId] of entries()) yield nodeId;
    },
    values: function* (): IterableIterator<TSceneNode> {
      for (const [, node] of entries()) yield node;
    },
    forEach(
      callback: (
        value: TSceneNode,
        key: string,
        map: ReadonlyMap<string, TSceneNode>,
      ) => void,
      thisArg?: unknown,
    ) {
      for (const [nodeId, node] of entries()) {
        callback.call(
          thisArg,
          node,
          nodeId,
          view as unknown as ReadonlyMap<string, TSceneNode>,
        );
      }
    },
    [Symbol.iterator]: entries,
  } as unknown as ReadonlyMap<string, TSceneNode>;
  return Object.freeze(view);
}

function ensureChildren(
  state: TMutableLocalDocument,
): Map<string | null, Set<string>> {
  if (state.children === null) {
    state.children = indexChildren(overlayNodes(state.base, state.changes));
  }
  return state.children;
}

function setNode(
  state: TMutableLocalDocument,
  node: TSceneNode,
): void {
  const previous = readNode(state, node.id);
  if (state.children !== null) {
    if (previous !== undefined) {
      removeChild(state.children, previous.parentId, previous.id);
    }
    addChild(state.children, node.parentId, node.id);
  }
  state.changes.set(node.id, node);
}

function deleteNode(
  state: TMutableLocalDocument,
  nodeId: string,
): void {
  const node = readNode(state, nodeId);
  if (node === undefined) return;
  if (state.children !== null) {
    removeChild(state.children, node.parentId, node.id);
    state.children.delete(nodeId);
  }
  state.changes.set(nodeId, null);
}

function requireNode(
  state: TMutableLocalDocument,
  nodeId: string,
): TSceneNode {
  const node = readNode(state, nodeId);
  if (node === undefined) {
    throw new RangeError(
      `Local document command references missing node '${nodeId}'.`,
    );
  }
  return node;
}

function assertAffectedNodeIds(
  expected: readonly string[],
  received: readonly string[],
): void {
  if (
    expected.length === received.length
    && expected.every((nodeId, index) => nodeId === received[index])
  ) return;
  throw new RangeError(
    'Editor affected node IDs do not match the local document effects: '
      + `expected [${expected.join(', ')}], received [${received.join(', ')}].`,
  );
}

export function fnReduceLocalDocument(
  current: ReadonlyMap<string, TSceneNode>,
  request: TEditorSceneMutationRequest,
): TLocalDocumentReduction {
  const state: TMutableLocalDocument = {
    base: current,
    changes: new Map(),
    children: null,
  };
  const before = new Map<string, TLocalDocumentNodeImage>();
  const captureBefore = (nodeId: string): void => {
    if (before.has(nodeId)) return;
    const node = current.get(nodeId);
    before.set(nodeId, node === undefined ? null : cloneFrozenNode(node));
  };

  for (const command of request.commands) {
    if (command.type === 'replace-snapshot') {
      throw new RangeError(
        'replace-snapshot is not an incremental local document command.',
      );
    }
    if (command.type === 'upsert') {
      captureBefore(command.node.id);
      setNode(state, cloneFrozenNode(command.node));
      continue;
    }
    if (command.type === 'remove') {
      const node = readNode(state, command.nodeId);
      if (node === undefined) continue;
      const children = ensureChildren(state);
      if ((command.descendants ?? 'remove') === 'reparent') {
        const childIds = [...(children.get(node.id) ?? [])]
          .sort(codePointCompare);
        for (const childId of childIds) {
          const child = requireNode(state, childId);
          captureBefore(childId);
          setNode(state, cloneFrozenNode({
            ...child,
            parentId: node.parentId,
          }));
        }
        captureBefore(node.id);
        deleteNode(state, node.id);
        continue;
      }

      const removalOrder: string[] = [];
      const traversed = new Set<string>();
      const work = [node.id];
      while (work.length > 0) {
        const currentId = work.pop()!;
        if (traversed.has(currentId)) continue;
        traversed.add(currentId);
        removalOrder.push(currentId);
        const childIds = [...(children.get(currentId) ?? [])]
          .sort(codePointCompare);
        for (let index = childIds.length - 1; index >= 0; index -= 1) {
          work.push(childIds[index]!);
        }
      }
      for (let index = removalOrder.length - 1; index >= 0; index -= 1) {
        const removedId = removalOrder[index]!;
        captureBefore(removedId);
        deleteNode(state, removedId);
      }
      continue;
    }

    const node = requireNode(state, command.nodeId);
    captureBefore(node.id);
    if (command.type === 'reparent') {
      if (
        command.parentId !== null
        && readNode(state, command.parentId) === undefined
      ) {
        throw new RangeError(
          `Local document parent '${command.parentId}' does not exist.`,
        );
      }
      setNode(state, cloneFrozenNode({
        ...node,
        parentId: command.parentId,
        orderKey: command.orderKey ?? node.orderKey,
      }));
      continue;
    }
    if (command.type === 'reorder') {
      setNode(state, cloneFrozenNode({
        ...node,
        orderKey: command.orderKey,
      }));
      continue;
    }
    throw new RangeError('Unknown incremental local document command.');
  }

  const affectedNodeIds = [...before.keys()]
    .filter((nodeId) => (
      !equalData(before.get(nodeId) ?? null, readNode(state, nodeId) ?? null)
    ))
    .sort(codePointCompare);
  if (affectedNodeIds.length === 0) {
    throw new RangeError('Editor transaction has no local document change.');
  }
  assertAffectedNodeIds(affectedNodeIds, request.affectedNodeIds);

  const boundedBefore = new Map<string, TLocalDocumentNodeImage>();
  const boundedAfter = new Map<string, TLocalDocumentNodeImage>();
  for (const nodeId of affectedNodeIds) {
    boundedBefore.set(nodeId, before.get(nodeId) ?? null);
    boundedAfter.set(nodeId, readNode(state, nodeId) ?? null);
  }

  return Object.freeze({
    nodes: overlayNodes(current, state.changes),
    before: Object.freeze(boundedBefore),
    after: Object.freeze(boundedAfter),
    affectedNodeIds: Object.freeze(affectedNodeIds),
  });
}
