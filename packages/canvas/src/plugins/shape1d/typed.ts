import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { THandleDragSnapshot, TPoint, TShape1dNode } from "./CONSTANTS";

export type TShape1dMovePatch = Pick<TElement, "id" | "x" | "y" | "parentGroupId" | "updatedAt">;

export type TShape1dMoveSession = {
  beforeElement: TElement;
  throttledPatch: (patch: TShape1dMovePatch) => void;
};

export type TShape1dPluginState = {
  previewShape: TShape1dNode | null;
  draftElementId: string | null;
  draftStartPoint: TPoint | null;
  draftCurrentPoint: TPoint | null;
  anchorHandles: Konva.Circle[];
  insertHandles: Konva.Circle[];
  activeHandleDrag: THandleDragSnapshot | null;
  previousToolId: string;
  moveSessions: Map<string, TShape1dMoveSession>;
};
