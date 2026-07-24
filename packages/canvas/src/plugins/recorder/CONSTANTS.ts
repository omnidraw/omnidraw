import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasInputEvent } from "../../engine/input/typed";

export type TStep = {
  type: "input";
  event: TCanvasInputEvent;
};

export type TCrdtOp = {
  type: "ops";
  payload: Array<Record<string, unknown>>;
};

export type TRecording = {
  name: string;
  initialDoc: TCanvasDoc | null;
  reducedEvents: boolean;
  steps: TStep[];
  crdtOps: TCrdtOp[];
};
