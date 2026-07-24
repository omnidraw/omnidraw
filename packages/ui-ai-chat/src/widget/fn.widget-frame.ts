import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TWidgetHostData } from "@vibecanvas/canvas/widget-host/types";
import type { TWidgetCanvasProductCreationCommit } from "./interface";

type TArgsCreationBounds = {
  commit: TWidgetCanvasProductCreationCommit;
  defaultSize: Readonly<{ width: number; height: number }>;
  minSize: Readonly<{ width: number; height: number }>;
};

type TArgsNextZIndex = {
  zIndices: readonly string[];
};

export function fnWidgetCreationBounds(args: TArgsCreationBounds) {
  const draggedWidth = Math.abs(
    args.commit.worldBounds.maxX - args.commit.worldBounds.minX,
  );
  const draggedHeight = Math.abs(
    args.commit.worldBounds.maxY - args.commit.worldBounds.minY,
  );
  const width = args.commit.belowThreshold
    ? args.defaultSize.width
    : Math.max(args.minSize.width, draggedWidth);
  const height = args.commit.belowThreshold
    ? args.defaultSize.height
    : Math.max(args.minSize.height, draggedHeight);
  return {
    x: args.commit.belowThreshold
      ? args.commit.current.world.x - width / 2
      : Math.min(args.commit.worldBounds.minX, args.commit.worldBounds.maxX),
    y: args.commit.belowThreshold
      ? args.commit.current.world.y - height / 2
      : Math.min(args.commit.worldBounds.minY, args.commit.worldBounds.maxY),
    width,
    height,
  };
}

export function fnNextWidgetZIndex(args: TArgsNextZIndex): string {
  const next = args.zIndices.reduce((maximum, value) => {
    const match = /^z(\d+)$/.exec(value);
    return match === null
      ? maximum
      : Math.max(maximum, Number.parseInt(match[1]!, 10) + 1);
  }, args.zIndices.length);
  return `z${String(next).padStart(8, "0")}`;
}

export function fnIsWidgetElement(
  element: TElement,
): element is TElement & { data: TWidgetHostData } {
  return element.data.type === "ui-widget"
    || element.data.type === "widget-instance";
}
