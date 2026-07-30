import type { TRectNode } from '@omnidraw/cangine';
import { validateSceneSnapshot } from '@omnidraw/cangine/testing';
import {
  CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
  CANVAS_RUNTIME_GRID_NODE_ID,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
} from '@vibecanvas/canvas-contract';
import { BUILTIN_THEMES } from '@vibecanvas/service-theme';
import { expect, test } from 'vitest';
import { fnRuntimeSceneSnapshot } from '../../src/services/fn.runtime-scene';

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

test('composes the non-interactive runtime grid before authored content', () => {
  const authored: TRectNode = {
    id: 'rect-a',
    parentId: null,
    orderKey: 'A',
    kind: 'rect',
    transform,
    size: { width: 100, height: 60 },
  };
  const colors = BUILTIN_THEMES[0]!.colors;
  const snapshot = fnRuntimeSceneSnapshot({
    authoredNodes: [authored],
    grid: {
      visible: false,
      minorColor: colors.canvasGridMinor,
      majorColor: colors.canvasGridMajor,
    },
  });

  expect(snapshot.rootLayerIds).toEqual([
    CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
    CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
  ]);
  expect(snapshot.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
      role: 'background',
      pointerEvents: 'none',
    }),
    expect.objectContaining({
      id: CANVAS_RUNTIME_GRID_NODE_ID,
      parentId: CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
      visibility: 'hidden',
      pointerEvents: 'none',
      background: {
        type: 'grid',
        minorSize: 64,
        majorEvery: 4,
        minorColor: colors.canvasGridMinor,
        majorColor: colors.canvasGridMajor,
        lineWidth: 1,
      },
    }),
    expect.objectContaining({
      id: authored.id,
      parentId: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    }),
  ]));
  expect(validateSceneSnapshot(snapshot)).toMatchObject({
    valid: true,
    errors: [],
  });
});
