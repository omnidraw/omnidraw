import type { TImageNode, TRectNode } from '@omnidraw/cangine';
import { CANVAS_IMAGE_EXTENSION_KEY } from '@omnidraw/canvas-contract';
import { describe, expect, test } from 'vitest';
import {
  fnBuildImageDocumentIndex,
  fnPlanCanvasOperations,
  fnStageImageIndexChanges,
} from '../../src/services/fn.document-policy';

const transform = {
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  skew: { x: 0, y: 0 },
  origin: { x: 0, y: 0 },
};

function rect(x = 0): TRectNode {
  return {
    id: 'rect-a',
    parentId: null,
    orderKey: 'A',
    kind: 'rect',
    transform: { ...transform, position: { x, y: 0 } },
    size: { width: 100, height: 60 },
  };
}

const image: TImageNode = {
  id: 'image-a',
  parentId: null,
  orderKey: 'B',
  kind: 'image',
  transform,
  resourceId: 'resource-a',
  size: { width: 80, height: 60 },
  extensions: {
    [CANVAS_IMAGE_EXTENSION_KEY]: {
      schemaVersion: 1,
      url: 'https://media.test/image.png',
      mimeType: 'image/png',
    },
  },
};

describe('document policy', () => {
  test('plans durable patches without runtime state', () => {
    const plan = fnPlanCanvasOperations(
      new Map([['rect-a', rect(0)]]),
      new Map([['rect-a', rect(25)]]),
    );

    expect(plan.operations).toEqual([expect.objectContaining({
      type: 'patch',
      itemId: 'rect-a',
    })]);
    expect(plan.preconditions).toEqual([expect.objectContaining({
      type: 'path-value',
      itemId: 'rect-a',
    })]);
  });

  test('stages image registration changes without mutating the current index', () => {
    const current = fnBuildImageDocumentIndex(new Map([['image-a', image]]));
    const patch = fnStageImageIndexChanges({
      before: new Map([['image-a', image]]),
      after: new Map([['image-a', null]]),
      current,
      localResourceIds: new Set(),
    });

    expect(patch.nodeCounts.get('resource-a')).toBe(0);
    expect(patch.descriptorCounts.get('resource-a')).toEqual(new Map());
    expect(patch.registrationsChanged).toBe(true);
    expect(current.nodeCounts.get('resource-a')).toBe(1);
    expect(current.descriptorCounts.get('resource-a')?.size).toBe(1);
  });
});
