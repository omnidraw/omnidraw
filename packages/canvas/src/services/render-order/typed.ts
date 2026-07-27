import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasTarget } from "../../semantic/typed";

export type TProductRenderOrderInsertPosition =
  | "front"
  | "back"
  | {
      before?: TCanvasTarget;
      after?: TCanvasTarget;
    };

export type TProductRenderOrderSnapshot = {
  parentGroupId: string | null;
  items: Array<{
    target: TCanvasTarget;
    zIndex: string;
  }>;
};

export type TProductRenderOrderBundleResolver = (
  target: TCanvasTarget,
  document: TCanvasDoc,
) => readonly TCanvasTarget[] | null;
