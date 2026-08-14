import type { TWidgetFrameNode } from "@omnidraw/canvas-contract";
import type { TWidgetViewport } from "@omnidraw/sdk";

const WIDGET_VIEWPORT_MIN_SCALE = 0.25;
const WIDGET_VIEWPORT_MAX_SCALE = 8;
const WIDGET_VIEWPORT_MAX_DIMENSION = 32_768;

function dimension(value: number): number {
  return Math.min(WIDGET_VIEWPORT_MAX_DIMENSION, Math.max(1, Math.round(value)));
}

/** Projects Canvas geometry into the bounds accepted by the widget runtime. */
export function fnWidgetViewport(node: Readonly<TWidgetFrameNode>): TWidgetViewport {
  return Object.freeze({
    width: dimension(node.size.width),
    height: dimension(node.size.height),
    scale: Math.min(
      WIDGET_VIEWPORT_MAX_SCALE,
      Math.max(WIDGET_VIEWPORT_MIN_SCALE, Math.abs(node.transform.scale.x)),
    ),
    visibility: node.visibility === "hidden" ? "hidden" : "visible",
    distance: 0,
    priority: 1,
    occlusion: 0,
  });
}
