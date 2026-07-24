import type { TColor } from "@vibecanvas/canvas-engine";

export const CANVAS_ENGINE_LAYER_IDS = {
  background: "vc:layer:background",
  content: "vc:layer:content",
  overlay: "vc:layer:overlay",
  debug: "vc:layer:debug",
} as const;

export const CANVAS_ENGINE_BACKGROUND_IDS = {
  surface: "vc:background:surface",
  grid: "vc:background:grid",
} as const;

export const CANVAS_ENGINE_SCENE_SCHEMA_VERSION = "1.0.0" as const;

export const CANVAS_ENGINE_ORDER_KEYS = {
  backgroundLayer: "A",
  contentLayer: "B",
  overlayLayer: "C",
  debugLayer: "D",
  backgroundSurface: "A",
  backgroundGrid: "B",
  elementRender: "A",
  elementInlineText: "B",
  placeholderFrame: "A",
  placeholderText: "B",
} as const;

export const CANVAS_ENGINE_COLORS = {
  black: {
    space: "srgb",
    r: 0,
    g: 0,
    b: 0,
    a: 1,
  },
  white: {
    space: "srgb",
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  },
  transparent: {
    space: "srgb",
    r: 0,
    g: 0,
    b: 0,
    a: 0,
  },
} as const satisfies Record<string, TColor>;
