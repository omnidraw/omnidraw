import type { TWidgetFrameBounds, TWidgetPlacementRef } from "@vibecanvas/orpc-client";
import type { TCanvasProductTransientProjection } from "../../engine/product-runtime/typed";
import type { TClientPoint, TWidgetWorldBounds, TWorldPoint, TWorldViewport } from "./types";

export function fnHasWidgetDragThreshold(args: {
  origin: TClientPoint;
  point: TClientPoint;
  threshold: number;
}): boolean {
  const deltaX = args.point.x - args.origin.x;
  const deltaY = args.point.y - args.origin.y;
  return (deltaX * deltaX) + (deltaY * deltaY) >= args.threshold * args.threshold;
}

export function fnWidgetPlacementReferenceIsAvailable(args: {
  reference: TWidgetPlacementRef;
  availableReferences: readonly TWidgetPlacementRef[];
}): boolean {
  return args.availableReferences.some((candidate) => (
    candidate.source === args.reference.source
    && candidate.name === args.reference.name
    && candidate.revision === args.reference.revision
  ));
}

export function fnClampWidgetFrameToViewport(args: {
  point: TWorldPoint;
  bounds: TWidgetFrameBounds;
  viewport: TWorldViewport;
}): TWidgetWorldBounds {
  const maxX = args.viewport.x + Math.max(0, args.viewport.width - args.bounds.width);
  const maxY = args.viewport.y + Math.max(0, args.viewport.height - args.bounds.height);
  return {
    x: Math.min(maxX, Math.max(args.viewport.x, args.point.x)),
    y: Math.min(maxY, Math.max(args.viewport.y, args.point.y)),
    width: args.bounds.width,
    height: args.bounds.height,
  };
}

export function fnWidgetDropGhostProjection(args: {
  request: {
    reference: TWidgetPlacementRef;
    bounds: TWidgetFrameBounds;
    label: string;
  };
  position: TWorldPoint;
  zoom: number;
  state: "positioning" | "committing";
}): TCanvasProductTransientProjection {
  const published = args.request.reference.source === "published";
  const color = published
    ? { r: 0.145, g: 0.388, b: 0.922, a: 1 }
    : { r: 0.486, g: 0.227, b: 0.929, a: 1 };
  const scale = 1 / Math.max(Number.EPSILON, args.zoom);
  const committing = args.state === "committing";
  return {
    band: "world-overlay",
    hitTest: "none",
    nodes: [{
      id: "widget-frame",
      parentId: null,
      orderKey: "A",
      kind: "widget-frame",
      size: { ...args.request.bounds },
      title: committing
        ? published
          ? `Adding ${args.request.label}…`
          : `Building ${args.request.label} Preview…`
        : `${args.request.label} · ${published ? "Published" : "Draft"}`,
      transform: {
        position: { ...args.position },
      },
      opacity: committing ? 0.94 : 0.82,
      pointerEvents: "none",
      active: committing,
      resizable: false,
      style: {
        background: { ...color, a: committing ? 0.14 : 0.08 },
        border: {
          color,
          width: 2 * scale,
          ...(committing ? {} : { dash: [8 * scale, 5 * scale] }),
        },
        titleBarBackground: { ...color, a: committing ? 0.2 : 0.12 },
        titleColor: color,
        cornerRadius: 10 * scale,
        titleBarHeight: 34 * scale,
        padding: {
          top: 8 * scale,
          right: 8 * scale,
          bottom: 8 * scale,
          left: 8 * scale,
        },
        ...(committing
          ? {
              activeOutline: {
                color,
                width: 3 * scale,
              },
            }
          : {}),
      },
    }],
  };
}
