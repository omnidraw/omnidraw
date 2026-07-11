import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TToolCanvasPoint } from "../../services/tool/types";
import { fnCreatePenDataFromStrokePoints } from "./fn.math";

export type TArgsCreatePenDraftElement = {
  id: string;
  now: number;
  points: TToolCanvasPoint[];
};

export function fnCreatePenDraftElement(args: TArgsCreatePenDraftElement): TElement {
  const penData = fnCreatePenDataFromStrokePoints({
    points: args.points,
  });
  if (!penData) {
    throw new Error("Failed to create pen draft data");
  }

  return {
    id: args.id,
    x: penData.x,
    y: penData.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: args.now,
    updatedAt: args.now,
    data: penData,
    style: {
      backgroundColor: "black",
    },
  };
}
