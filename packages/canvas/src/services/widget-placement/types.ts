import type { TWidgetFrameBounds, TWidgetPlacementRef } from "@vibecanvas/orpc-client";

export type TClientPoint = { x: number; y: number };
export type TWorldPoint = { x: number; y: number };
export type TWorldViewport = { x: number; y: number; width: number; height: number };
export type TWidgetWorldBounds = TWorldPoint & TWidgetFrameBounds;

export type TWidgetPlacementCancelReason =
  | "escape"
  | "pointer-cancel"
  | "outside-canvas"
  | "replaced"
  | "source-changed"
  | "canvas-destroyed";

export type TWidgetDropCommitArgs = {
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
  clientPoint: TClientPoint;
};

export type TWidgetDropRequest = {
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
  label: string;
  onCommit(args: TWidgetDropCommitArgs): Promise<void> | void;
  onCancel?(reason: TWidgetPlacementCancelReason): void;
  onDragStart?(): void;
  onDragEnd?(): void;
};
