import type { TWidgetFrameNode } from "@omnidraw/canvas-contract";
import type { TWidgetViewport } from "@omnidraw/sdk";

const WIDGET_VIEWPORT_MIN_SCALE = 0.25;
const WIDGET_VIEWPORT_MAX_SCALE = 8;
const WIDGET_VIEWPORT_MAX_DIMENSION = 32_768;
const WIDGET_VIEWPORT_MAX_DISTANCE = 1_000_000;
const WIDGET_VIEWPORT_MAX_PRIORITY = 4;

export type TWidgetViewportScheduling = Readonly<{
  eligible: boolean;
  visible: boolean;
  priority: number;
  distance: number;
  occlusion: number;
}>;

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

function bounded(value: number, minimum: number, maximum: number, fallback: number): number {
  const selected = Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, selected));
}

/** Projects the live host box into the bounds accepted by the widget runtime. */
export function fnWidgetViewport(args: Readonly<{
  node: Readonly<TWidgetFrameNode>;
  width: number;
  height: number;
  devicePixelRatio: number;
  scheduling: TWidgetViewportScheduling;
}>): TWidgetViewport {
  return Object.freeze({
    width: dimension(args.width, args.node.size.width),
    height: dimension(args.height, args.node.size.height),
    scale: deviceScale(args.devicePixelRatio),
    visibility: args.node.visibility === "hidden" || !args.scheduling.visible
      ? "hidden"
      : "visible",
    distance: bounded(args.scheduling.distance, 0, WIDGET_VIEWPORT_MAX_DISTANCE, WIDGET_VIEWPORT_MAX_DISTANCE),
    priority: bounded(args.scheduling.priority, 0, WIDGET_VIEWPORT_MAX_PRIORITY, 0),
    occlusion: bounded(args.scheduling.occlusion, 0, 1, 1),
  });
}
