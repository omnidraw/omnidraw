import type {
  TGroupNode,
  TLayerNode,
  TRectNode,
  TSceneNode,
} from '@omnidraw/cangine';
import type {
  TEditorSceneMutationRequest,
} from '@omnidraw/cangine/editor';
import { describe, expect, test } from 'vitest';
import {
  fnReduceLocalDocument,
} from '../../src/services/fn.local-document';

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function layer(): TLayerNode {
  return {
    id: 'content',
    parentId: null,
    orderKey: 'A',
    kind: 'layer',
    role: 'content',
    coordinateSpace: 'world',
    transform,
  };
}

function group(
  id: string,
  parentId = 'content',
  orderKey = 'A',
): TGroupNode {
  return {
    id,
    parentId,
    orderKey,
    kind: 'group',
    transform,
    layout: { type: 'free' },
  };
}

function rect(
  id: string,
  parentId = 'content',
  orderKey = 'A',
  x = 0,
): TRectNode {
  return {
    id,
    parentId,
    orderKey,
    kind: 'rect',
    transform: {
      ...transform,
      position: { x, y: 0 },
    },
    size: { width: 100, height: 60 },
  };
}

function document(
  nodes: readonly TSceneNode[],
): ReadonlyMap<string, TSceneNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function request(
  commands: TEditorSceneMutationRequest['commands'],
  affectedNodeIds: readonly string[],
): TEditorSceneMutationRequest {
  return {
    transactionId: 'transaction-a',
    basisSceneRevision: 0,
    source: 'test',
    commands,
    affectedNodeIds,
  };
}

describe('local document reducer', () => {
  test('does not scan untouched nodes for a non-structural mutation', () => {
    const base = document([
      layer(),
      rect('rect-a'),
      rect('rect-b', 'content', 'B'),
    ]);
    let iterations = 0;
    const observed: ReadonlyMap<string, TSceneNode> = {
      size: base.size,
      get: (nodeId) => base.get(nodeId),
      has: (nodeId) => base.has(nodeId),
      entries() {
        iterations += 1;
        return base.entries();
      },
      keys() {
        iterations += 1;
        return base.keys();
      },
      values() {
        iterations += 1;
        return base.values();
      },
      forEach(callback, thisArg) {
        iterations += 1;
        base.forEach((node, nodeId) => {
          callback.call(thisArg, node, nodeId, observed);
        });
      },
      [Symbol.iterator]() {
        iterations += 1;
        return base[Symbol.iterator]();
      },
    };

    const reduced = fnReduceLocalDocument(observed, request([
      { type: 'reorder', nodeId: 'rect-a', orderKey: 'Z' },
    ], ['rect-a']));

    expect(iterations).toBe(0);
    expect(reduced.nodes.get('rect-a')?.orderKey).toBe('Z');
    expect(reduced.nodes.get('rect-b')).toBe(base.get('rect-b'));
    expect(iterations).toBe(0);
  });

  test('applies command-order hierarchy and ordering semantics', () => {
    const originalChild = rect('child', 'group-a', 'B');
    const current = document([
      layer(),
      group('group-a'),
      originalChild,
    ]);
    const created = rect('created', 'group-a', 'C');

    const reduced = fnReduceLocalDocument(current, request([
      { type: 'upsert', node: created },
      {
        type: 'reparent',
        nodeId: 'child',
        parentId: 'content',
        orderKey: 'Y',
      },
      { type: 'reorder', nodeId: 'child', orderKey: 'Z' },
      {
        type: 'remove',
        nodeId: 'group-a',
        descendants: 'reparent',
      },
    ], ['child', 'created', 'group-a']));

    expect(reduced.affectedNodeIds).toEqual([
      'child',
      'created',
      'group-a',
    ]);
    expect(reduced.nodes.get('group-a')).toBeUndefined();
    expect(reduced.nodes.get('child')).toMatchObject({
      parentId: 'content',
      orderKey: 'Z',
    });
    expect(reduced.nodes.get('created')).toMatchObject({
      parentId: 'content',
      orderKey: 'C',
    });
    expect(reduced.before).toEqual(new Map([
      ['child', originalChild],
      ['created', null],
      ['group-a', group('group-a')],
    ]));
    expect(reduced.after.get('group-a')).toBeNull();
    expect(current.get('group-a')).toEqual(group('group-a'));
    expect(current.get('created')).toBeUndefined();
  });

  test('removes a complete descendant subtree by default', () => {
    const current = document([
      layer(),
      group('group-a'),
      group('group-b', 'group-a'),
      rect('child', 'group-b'),
    ]);

    const reduced = fnReduceLocalDocument(current, request([
      { type: 'remove', nodeId: 'group-a' },
    ], ['child', 'group-a', 'group-b']));

    expect([...reduced.nodes.keys()]).toEqual(['content']);
    expect(reduced.before.size).toBe(3);
    expect(reduced.after).toEqual(new Map([
      ['child', null],
      ['group-a', null],
      ['group-b', null],
    ]));
  });

  test('reparents only direct children when removing a container', () => {
    const grandchild = rect('grandchild', 'child');
    const current = document([
      layer(),
      group('group-a'),
      group('child', 'group-a', 'B'),
      grandchild,
    ]);

    const reduced = fnReduceLocalDocument(current, request([
      {
        type: 'remove',
        nodeId: 'group-a',
        descendants: 'reparent',
      },
    ], ['child', 'group-a']));

    expect(reduced.nodes.get('child')).toMatchObject({
      parentId: 'content',
      orderKey: 'B',
    });
    expect(reduced.nodes.get('grandchild')).toBe(grandchild);
    expect(reduced.before.has('grandchild')).toBe(false);
    expect(reduced.after.has('grandchild')).toBe(false);
  });

  test('rejects affected IDs that differ from bounded final effects', () => {
    const current = document([layer(), rect('rect-a')]);

    expect(() => fnReduceLocalDocument(current, request([
      { type: 'reorder', nodeId: 'rect-a', orderKey: 'Z' },
    ], ['extra', 'rect-a']))).toThrow('affected node IDs');

    expect(() => fnReduceLocalDocument(current, request([
      { type: 'reorder', nodeId: 'rect-a', orderKey: 'A' },
    ], ['rect-a']))).toThrow('no local document change');

    expect(() => fnReduceLocalDocument(current, request([
      {
        type: 'upsert',
        node: rect('rect-a', 'content', 'A', -0),
      },
    ], ['rect-a']))).toThrow('no local document change');
  });

  test('rejects replacement and missing-node incremental commands', () => {
    const root = layer();
    const current = document([root]);

    expect(() => fnReduceLocalDocument(current, request([{
      type: 'replace-snapshot',
      snapshot: {
        schemaVersion: '1.0.0',
        rootLayerIds: [root.id],
        nodes: [root],
      },
    }], []))).toThrow('replace-snapshot');

    expect(() => fnReduceLocalDocument(current, request([{
      type: 'reparent',
      nodeId: 'missing',
      parentId: root.id,
    }], ['missing']))).toThrow('missing node');
  });

  test('isolates and freezes changed node images from caller mutation', () => {
    const before = rect('rect-a');
    const next = rect('rect-a', 'content', 'A', 25);
    const current = document([layer(), before]);

    const reduced = fnReduceLocalDocument(current, request([
      { type: 'upsert', node: next },
    ], ['rect-a']));
    next.transform.position.x = 99;
    before.transform.position.x = 88;

    const reducedBefore = reduced.before.get('rect-a');
    const reducedAfter = reduced.after.get('rect-a');
    expect(reducedBefore?.transform.position.x).toBe(0);
    expect(reducedAfter?.transform.position.x).toBe(25);
    expect(Object.isFrozen(reducedBefore)).toBe(true);
    expect(Object.isFrozen(reducedBefore?.transform.position)).toBe(true);
    expect(Object.isFrozen(reducedAfter)).toBe(true);
    expect(Object.isFrozen(reducedAfter?.transform.position)).toBe(true);
  });
});
