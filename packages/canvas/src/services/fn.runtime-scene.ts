import type {
  TBackgroundNode,
  TLayerNode,
  TSceneNode,
  TSceneSnapshot,
} from '@omnidraw/cangine';
import {
  CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
  CANVAS_RUNTIME_GRID_NODE_ID,
  CANVAS_SCENE_SCHEMA_VERSION,
  CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
} from '@vibecanvas/canvas-contract/CONSTANTS';
import type { TCanvasGridThemeColor } from '@vibecanvas/service-theme';
import { fnRuntimeCanvasNode } from './fn.scene-node-diff';

export type TRuntimeGridPresentation = Readonly<{
  visible: boolean;
  minorColor: TCanvasGridThemeColor;
  majorColor: TCanvasGridThemeColor;
}>;

export type TArgsRuntimeSceneSnapshot = Readonly<{
  authoredNodes: readonly TSceneNode[];
  grid: TRuntimeGridPresentation;
}>;

export type TArgsRuntimeGridNode = Readonly<{
  grid: TRuntimeGridPresentation;
}>;

function fnIdentityTransform() {
  return {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  };
}

export function fnRuntimeGridNode(
  args: TArgsRuntimeGridNode,
): TBackgroundNode {
  return {
    id: CANVAS_RUNTIME_GRID_NODE_ID,
    parentId: CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
    orderKey: '0',
    kind: 'background',
    visibility: args.grid.visible ? 'visible' : 'hidden',
    pointerEvents: 'none',
    transform: fnIdentityTransform(),
    background: {
      type: 'grid',
      minorSize: 64,
      majorEvery: 4,
      minorColor: args.grid.minorColor,
      majorColor: args.grid.majorColor,
      lineWidth: 1,
    },
  };
}

export function fnRuntimeSceneSnapshot(
  args: TArgsRuntimeSceneSnapshot,
): TSceneSnapshot {
  const backgroundLayer: TLayerNode = {
    id: CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
    parentId: null,
    orderKey: '0',
    kind: 'layer',
    role: 'background',
    coordinateSpace: 'world',
    pointerEvents: 'none',
    transform: fnIdentityTransform(),
  };
  const contentLayer: TLayerNode = {
    id: CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    parentId: null,
    orderKey: '1',
    kind: 'layer',
    role: 'content',
    coordinateSpace: 'world',
    transform: fnIdentityTransform(),
  };
  return {
    schemaVersion: CANVAS_SCENE_SCHEMA_VERSION,
    rootLayerIds: [
      CANVAS_RUNTIME_BACKGROUND_LAYER_ID,
      CANVAS_SYNTHETIC_CONTENT_LAYER_ID,
    ],
    nodes: [
      backgroundLayer,
      fnRuntimeGridNode({ grid: args.grid }),
      contentLayer,
      ...args.authoredNodes.map(fnRuntimeCanvasNode),
    ],
  };
}
