import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasInputEvent } from "../../engine/input/typed";
import type { TCrdtOp, TRecording, TStep } from "./CONSTANTS";

export function fnCloneValue<T>(args: { value: T }): T {
  return JSON.parse(JSON.stringify(args.value)) as T;
}

export function fnCreateEmptyRecording(
  args: { reducedEvents: boolean },
): TRecording {
  return {
    name: "canvas-recording",
    initialDoc: null,
    reducedEvents: args.reducedEvents,
    steps: [],
    crdtOps: [],
  };
}

export function fnCreateStartedRecording(args: {
  initialDoc: TCanvasDoc;
  reducedEvents: boolean;
  now: number;
}): TRecording {
  return {
    name: `canvas-recording-${args.now}`,
    initialDoc: fnCloneValue({ value: args.initialDoc }),
    reducedEvents: args.reducedEvents,
    steps: [],
    crdtOps: [],
  };
}

export function fnCanExportRecording(
  args: { recording: TRecording },
): boolean {
  return args.recording.steps.length > 0
    || args.recording.crdtOps.length > 0;
}

export function fnCreateInputStep(
  args: { event: TCanvasInputEvent },
): TStep {
  return {
    type: "input",
    event: fnCloneValue({ value: args.event }),
  };
}

export function fnCreateOpsCrdtOp(args: {
  ops: Array<Record<string, unknown>>;
}): TCrdtOp {
  return {
    type: "ops",
    payload: fnCloneValue({ value: args.ops }),
  };
}
