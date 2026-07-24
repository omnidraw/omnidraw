import type { TColor } from "@vibecanvas/canvas-engine";
import type {
  TElementStyle,
  TElementType,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";

export const CANVAS_PROJECTION_STROKE_WIDTHS = {
  "@stroke-width/none": 0,
  "@stroke-width/thin": 1,
  "@stroke-width/medium": 4,
  "@stroke-width/thick": 7,
  "@stroke-width/heavy": 12,
} as const;

export const CANVAS_PROJECTION_CORNER_RADII = {
  "@corner-radius/none": 0,
  "@corner-radius/sm": 8,
  "@corner-radius/md": 16,
  "@corner-radius/lg": 24,
} as const;

export const CANVAS_PROJECTION_FONT_SIZES = {
  "@text/s": 16,
  "@text/m": 20,
  "@text/l": 28,
  "@text/xl": 36,
} as const;

export const CANVAS_PROJECTION_STYLE_DEFAULTS: Partial<Record<TElementType, TElementStyle>> = {
  rect: {
    backgroundColor: "@base/300",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  diamond: {
    backgroundColor: "@base/300",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  ellipse: {
    backgroundColor: "@base/300",
    strokeWidth: "@stroke-width/none",
    cornerRadius: "@corner-radius/none",
    opacity: 1,
    strokeStyle: "solid",
  },
  line: {
    strokeColor: "@base/900",
    strokeWidth: "@stroke-width/medium",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  arrow: {
    strokeColor: "@base/900",
    strokeWidth: "@stroke-width/medium",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  pen: {
    strokeColor: "@base/900",
    strokeWidth: "@stroke-width/thick",
    opacity: 0.92,
    strokeStyle: "solid",
  },
  text: {
    strokeColor: "@base/900",
    opacity: 1,
    fontSize: "@text/s",
    textAlign: "left",
    verticalAlign: "top",
  },
  image: {
    opacity: 1,
  },
};

export const CANVAS_PROJECTION_FALLBACK_COLORS = {
  dark: {
    space: "srgb",
    r: 15 / 255,
    g: 23 / 255,
    b: 42 / 255,
    a: 1,
  },
  light: {
    space: "srgb",
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  },
  blue: {
    space: "srgb",
    r: 37 / 255,
    g: 99 / 255,
    b: 235 / 255,
    a: 1,
  },
  placeholderFill: {
    space: "srgb",
    r: 244 / 255,
    g: 63 / 255,
    b: 94 / 255,
    a: 0.22,
  },
  placeholderStroke: {
    space: "srgb",
    r: 217 / 255,
    g: 70 / 255,
    b: 239 / 255,
    a: 1,
  },
} as const satisfies Record<string, TColor>;

export const CANVAS_PROJECTION_GRID = {
  minorSize: 32,
  majorEvery: 4,
  lineWidth: 1,
} as const;

export const CANVAS_PROJECTION_WIDGET = {
  minWidth: 100,
  minHeight: 76,
  titleBarHeight: 28,
  cornerRadius: 10,
} as const;

export const CANVAS_PROJECTION_PLACEHOLDER = {
  minWidth: 180,
  minHeight: 96,
  title: "UNSUPPORTED CANVAS FEATURE",
  errorCode: "CANVAS_PROJECTION_FAILED",
} as const;

export const CANVAS_PROJECTION_PEN_OPTIONS = {
  size: 7,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.35,
  simulatePressure: true,
  last: true,
  start: {
    cap: true,
  },
  end: {
    cap: true,
  },
} as const;
