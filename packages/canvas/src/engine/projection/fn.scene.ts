import type {
  TBackgroundNode,
  TLayerNode,
  TSceneNode,
} from "@vibecanvas/canvas-engine";
import {
  CANVAS_ENGINE_BACKGROUND_IDS,
  CANVAS_ENGINE_LAYER_IDS,
  CANVAS_ENGINE_ORDER_KEYS,
} from "../CONSTANTS";
import type { TCanvasProjectionTheme } from "../typed";
import { CANVAS_PROJECTION_GRID } from "./CONSTANTS";
import {
  fnCanvasSolidPaint,
  fnResolveCanvasProjectionColor,
} from "./fn.color";
import { fnCanvasIdentityTransform2D } from "./fn.nodes";

type TArgsSceneBaseNodes = {
  theme: TCanvasProjectionTheme;
  gridVisible?: boolean;
};

export function fnCanvasSceneBaseNodes(args: TArgsSceneBaseNodes): TSceneNode[] {
  const backgroundLayer: TLayerNode = {
    id: CANVAS_ENGINE_LAYER_IDS.background,
    parentId: null,
    orderKey: CANVAS_ENGINE_ORDER_KEYS.backgroundLayer,
    kind: "layer",
    role: "background",
    coordinateSpace: "world",
    transform: fnCanvasIdentityTransform2D(),
  };
  const contentLayer: TLayerNode = {
    id: CANVAS_ENGINE_LAYER_IDS.content,
    parentId: null,
    orderKey: CANVAS_ENGINE_ORDER_KEYS.contentLayer,
    kind: "layer",
    role: "content",
    coordinateSpace: "world",
    transform: fnCanvasIdentityTransform2D(),
  };
  const debugLayer: TLayerNode = {
    id: CANVAS_ENGINE_LAYER_IDS.debug,
    parentId: null,
    orderKey: CANVAS_ENGINE_ORDER_KEYS.debugLayer,
    kind: "layer",
    role: "debug",
    coordinateSpace: "screen",
    transform: fnCanvasIdentityTransform2D(),
  };
  const overlayLayer: TLayerNode = {
    id: CANVAS_ENGINE_LAYER_IDS.overlay,
    parentId: null,
    orderKey: CANVAS_ENGINE_ORDER_KEYS.overlayLayer,
    kind: "layer",
    role: "overlay",
    coordinateSpace: "screen",
    transform: fnCanvasIdentityTransform2D(),
  };
  const surface: TBackgroundNode = {
    id: CANVAS_ENGINE_BACKGROUND_IDS.surface,
    parentId: CANVAS_ENGINE_LAYER_IDS.background,
    orderKey: CANVAS_ENGINE_ORDER_KEYS.backgroundSurface,
    kind: "background",
    transform: fnCanvasIdentityTransform2D(),
    pointerEvents: "none",
    background: {
      type: "solid",
      paint: fnCanvasSolidPaint({
        color: fnResolveCanvasProjectionColor({
          theme: args.theme,
          value: args.theme.colors.canvasBackground,
        }),
      }),
    },
  };
  const grid: TBackgroundNode = {
    id: CANVAS_ENGINE_BACKGROUND_IDS.grid,
    parentId: CANVAS_ENGINE_LAYER_IDS.background,
    orderKey: CANVAS_ENGINE_ORDER_KEYS.backgroundGrid,
    kind: "background",
    transform: fnCanvasIdentityTransform2D(),
    visibility: args.gridVisible === false ? "hidden" : "visible",
    pointerEvents: "none",
    background: {
      type: "grid",
      ...CANVAS_PROJECTION_GRID,
      minorColor: fnResolveCanvasProjectionColor({
        theme: args.theme,
        value: args.theme.colors.canvasGridMinor,
      }),
      majorColor: fnResolveCanvasProjectionColor({
        theme: args.theme,
        value: args.theme.colors.canvasGridMajor,
      }),
    },
  };
  return [
    backgroundLayer,
    contentLayer,
    overlayLayer,
    debugLayer,
    surface,
    grid,
  ];
}
