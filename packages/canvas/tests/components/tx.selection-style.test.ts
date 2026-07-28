import type { TRectNode } from '@omnidraw/cangine';
import type { IStandardCanvasEditor } from '@omnidraw/cangine/editor';
import { describe, expect, test, vi } from 'vitest';
import {
  txApplySelectionStyle,
} from '../../src/components/SelectionStyleMenu/tx.selection-style';

const node: TRectNode = {
  id: 'rect-a',
  parentId: 'content',
  orderKey: 'A',
  kind: 'rect',
  transform: {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  },
  size: { width: 100, height: 60 },
};

describe('selection style transaction', () => {
  test('commits one controlled mutation instead of writing the scene', () => {
    const commitSceneMutation = vi.fn();
    const editor = {
      engine: {
        scene: {
          get: (nodeId: string) => nodeId === node.id ? node : null,
        },
      },
      commitSceneMutation,
    } as unknown as IStandardCanvasEditor;

    txApplySelectionStyle({ editor }, {
      nodeIds: [node.id, 'missing'],
      patch: { opacity: 0.5 },
    });

    expect(commitSceneMutation).toHaveBeenCalledTimes(1);
    expect(commitSceneMutation).toHaveBeenCalledWith({
      source: 'vibecanvas:selection-style',
      coalesceKey: 'vibecanvas:selection-style',
      commands: [{
        type: 'upsert',
        node: {
          ...node,
          opacity: 0.5,
        },
      }],
    });
  });
});
