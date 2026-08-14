import type { TWidgetFrameNode } from "@omnidraw/canvas-contract";
import type { TWidgetViewport } from "@omnidraw/sdk";

const WIDGET_VIEWPORT_MIN_SCALE = 0.25;
const WIDGET_VIEWPORT_MAX_SCALE = 8;
const WIDGET_VIEWPORT_MAX_DIMENSION = 32_768;

function dimension(value: number, fallback: number): number {
  const selected = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.min(WIDGET_VIEWPORT_MAX_DIMENSION, Math.max(1, Math.round(selected)));
}

function deviceScale(value: number): number {
  const selected = Number.isFinite(value) && value > 0 ? value : 1;
  return Math.min(
    WIDGET_VIEWPORT_MAX_SCALE,
    Math.max(WIDGET_VIEWPORT_MIN_SCALE, selected),
  );
}

/** Projects the live host box into the bounds accepted by the widget runtime. */
export function fnWidgetViewport(args: Readonly<{
  node: Readonly<TWidgetFrameNode>;
  width: number;
  height: number;
  devicePixelRatio: number;
}>): TWidgetViewport {
  return Object.freeze({
    width: dimension(args.width, args.node.size.width),
    height: dimension(args.height, args.node.size.height),
    scale: deviceScale(args.devicePixelRatio),
    visibility: args.node.visibility === "hidden" ? "hidden" : "visible",
    distance: 0,
    priority: 1,
    occlusion: 0,
  });
}
