import type {
  TLayerNode,
  TSceneSnapshot,
  TTransform2D,
} from "@omnidraw/cangine";
import {
  CANVAS_ENGINE_LAYER_IDS,
  CANVAS_ENGINE_ORDER_KEYS,
  CANVAS_ENGINE_SCENE_SCHEMA_VERSION,
} from "./CONSTANTS";

function identityTransform(): TTransform2D {
  return {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  };
}

export function fnCanvasEngineInitialScene(): TSceneSnapshot {
  const nodes: TLayerNode[] = [
    {
      id: CANVAS_ENGINE_LAYER_IDS.background,
      parentId: null,
      orderKey: CANVAS_ENGINE_ORDER_KEYS.backgroundLayer,
      kind: "layer",
      role: "background",
      coordinateSpace: "world",
      transform: identityTransform(),
    },
    {
      id: CANVAS_ENGINE_LAYER_IDS.content,
      parentId: null,
      orderKey: CANVAS_ENGINE_ORDER_KEYS.contentLayer,
      kind: "layer",
      role: "content",
      coordinateSpace: "world",
      transform: identityTransform(),
    },
    {
      id: CANVAS_ENGINE_LAYER_IDS.overlay,
      parentId: null,
      orderKey: CANVAS_ENGINE_ORDER_KEYS.overlayLayer,
      kind: "layer",
      role: "overlay",
      coordinateSpace: "screen",
      transform: identityTransform(),
    },
    {
      id: CANVAS_ENGINE_LAYER_IDS.debug,
      parentId: null,
      orderKey: CANVAS_ENGINE_ORDER_KEYS.debugLayer,
      kind: "layer",
      role: "debug",
      coordinateSpace: "screen",
      transform: identityTransform(),
    },
  ];
  return {
    schemaVersion: CANVAS_ENGINE_SCENE_SCHEMA_VERSION,
    rootLayerIds: [
      CANVAS_ENGINE_LAYER_IDS.background,
      CANVAS_ENGINE_LAYER_IDS.content,
      CANVAS_ENGINE_LAYER_IDS.overlay,
      CANVAS_ENGINE_LAYER_IDS.debug,
    ],
    nodes,
  };
}
