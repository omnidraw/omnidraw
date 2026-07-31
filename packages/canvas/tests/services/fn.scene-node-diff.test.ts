import type { TPathNode, TRectNode, TWidgetFrameNode } from '@omnidraw/cangine';
import { describe, expect, test } from 'vitest';
import {
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
} from '@omnidraw/canvas-contract/CONSTANTS';
import {
  fnApplySceneNodePatches,
  fnAuthoredCanvasNode,
  fnDiffSceneNodeStructure,
  fnDiffSceneNodes,
  fnRuntimeCanvasNode,
} from '../../src/services/fn.scene-node-diff';

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(): TRectNode {
  return {
    id: 'rect-a',
    parentId: null,
    orderKey: 'A',
    kind: 'rect',
    transform,
    size: { width: 100, height: 60 },
    opacity: 1,
  };
}

describe('scene node diff', () => {
  test('emits touched-leaf preconditions and applies patches immutably', () => {
    const before = rect();
    const after: TRectNode = {
      ...before,
      transform: {
        ...before.transform,
        position: { x: 25, y: 0 },
      },
      opacity: 0.5,
    };

    const diff = fnDiffSceneNodes(before, after);

    expect(diff.patches).toEqual([
      { type: 'set', path: ['opacity'], value: 0.5 },
      {
        type: 'set',
        path: ['transform', 'position', 'x'],
        value: 25,
      },
    ]);
    expect(diff.preconditions).toEqual([
      {
        type: 'path-value',
        itemId: 'rect-a',
        path: ['opacity'],
        value: 1,
      },
      {
        type: 'path-value',
        itemId: 'rect-a',
        path: ['transform', 'position', 'x'],
        value: 0,
      },
    ]);
    expect(fnApplySceneNodePatches(before, diff.patches)).toEqual(after);
    expect(before.transform.position.x).toBe(0);
  });

  test('treats arrays as authored atomic values', () => {
    const before: TPathNode = {
      id: 'path-a',
      parentId: null,
      orderKey: 'B',
      kind: 'path',
      transform,
      path: {
        fillRule: 'nonzero',
        commands: [
          { type: 'M', to: { x: 0, y: 0 } },
          { type: 'L', to: { x: 10, y: 10 } },
        ],
      },
    };
    const after: TPathNode = {
      ...before,
      path: {
        ...before.path,
        commands: [
          { type: 'M', to: { x: 0, y: 0 } },
          { type: 'L', to: { x: 20, y: 20 } },
        ],
      },
    };

    const diff = fnDiffSceneNodes(before, after);

    expect(diff.patches).toHaveLength(1);
    expect(diff.patches[0]).toMatchObject({
      type: 'set',
      path: ['path', 'commands'],
    });
    expect(fnApplySceneNodePatches(before, diff.patches)).toEqual(after);
  });

  test('maps only the synthetic content parent at the runtime boundary', () => {
    const authored = rect();
    const runtime = fnRuntimeCanvasNode(authored);

    expect(runtime.parentId).toBe(CANVAS_SYNTHETIC_CONTENT_LAYER_ID);
    expect(fnAuthoredCanvasNode(runtime)).toEqual(authored);
    expect(authored.parentId).toBeNull();
  });

  test('keeps hierarchy and order changes out of JSON patches', () => {
    const before = rect();
    const after: TRectNode = {
      ...before,
      parentId: 'group-a',
      orderKey: 'Z',
    };

    expect(fnDiffSceneNodes(before, after)).toEqual({
      patches: [],
      preconditions: [],
    });
    expect(fnDiffSceneNodeStructure(before, after)).toEqual({
      parentChanged: true,
      orderChanged: true,
    });
  });

  test('rejects mismatched node identities before command planning', () => {
    expect(() => fnDiffSceneNodes(rect(), {
      ...rect(),
      id: 'rect-b',
    })).toThrow('different IDs');
  });

  test('materializes widget portals only at the runtime boundary', () => {
    const authored: TWidgetFrameNode = {
      id: 'widget-a',
      parentId: null,
      orderKey: 'C',
      kind: 'widget-frame',
      transform,
      size: { width: 320, height: 240 },
    };

    const runtime = fnRuntimeCanvasNode(authored);

    expect(runtime).toMatchObject({
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
      portal: { portalId: 'omnidraw:widget:widget-a' },
    });
    expect(fnAuthoredCanvasNode(runtime)).toEqual(authored);
  });
});
