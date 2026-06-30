import type { TMouseEvent, TPointerEvent, TWheelEvent } from "../../types";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { SceneService } from "../../services/scene/SceneService";
import type { TCrdtOp, TModifiers, TRecording, TStep } from "./CONSTANTS";

export function fnCloneValue<T>(args: { value: T }): T {
  return JSON.parse(JSON.stringify(args.value)) as T;
}

export function fnGetModifiers(args: {
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;
}): TModifiers {
  return {
    altKey: args.event.altKey,
    ctrlKey: args.event.ctrlKey,
    metaKey: args.event.metaKey,
    shiftKey: args.event.shiftKey,
  };
}

export function fnGetPointerPosition(args: {
  render: SceneService;
}) {
  const pointer = args.render.stage.getPointerPosition();

  return {
    x: pointer?.x ?? 0,
    y: pointer?.y ?? 0,
  };
}

export function fnGetTargetId(args: {
  event: TPointerEvent | TMouseEvent | TWheelEvent;
}): string | null {
  const id = args.event.target?.id?.();
  return id || null;
}

export function fnCreateEmptyRecording(args: { reducedEvents: boolean }): TRecording {
  return {
    name: "canvas-recording",
    initialDoc: null,
    reducedEvents: args.reducedEvents,
    steps: [],
    crdtOps: [],
  };
}

export function fnCreateStartedRecording(args: {
  crdt: CrdtService;
  reducedEvents: boolean;
  now: number;
}): TRecording {
  return {
    name: `canvas-recording-${args.now}`,
    initialDoc: fnCloneValue({ value: args.crdt.doc() }),
    reducedEvents: args.reducedEvents,
    steps: [],
    crdtOps: [],
  };
}

export function fnCanExportRecording(args: { recording: TRecording }): boolean {
  return args.recording.steps.length > 0 || args.recording.crdtOps.length > 0;
}

export function fnCreatePointerStep(args: {
  render: SceneService;
  eventName: "pointerdown" | "pointerup" | "pointerout" | "pointerover" | "pointercancel";
  event: TPointerEvent;
}): TStep {
  const { x, y } = fnGetPointerPosition({ render: args.render });

  return {
    type: "pointer",
    event: args.eventName,
    targetId: fnGetTargetId({ event: args.event }),
    x,
    y,
    modifiers: fnGetModifiers({ event: args.event.evt }),
  };
}

export function fnCreatePointerMoveStep(args: { render: SceneService; event: TMouseEvent }): TStep {
  const { x, y } = fnGetPointerPosition({ render: args.render });

  return {
    type: "pointermove",
    targetId: fnGetTargetId({ event: args.event }),
    x,
    y,
    modifiers: fnGetModifiers({ event: args.event.evt }),
  };
}

export function fnCreateWheelStep(args: { render: SceneService; event: TWheelEvent }): TStep {
  const { x, y } = fnGetPointerPosition({ render: args.render });

  return {
    type: "wheel",
    targetId: fnGetTargetId({ event: args.event }),
    x,
    y,
    deltaX: args.event.evt.deltaX,
    deltaY: args.event.evt.deltaY,
    modifiers: fnGetModifiers({ event: args.event.evt }),
  };
}

export function fnCreateKeyStep(args: { eventName: "keydown" | "keyup"; event: KeyboardEvent }): TStep {
  return {
    type: "key",
    event: args.eventName,
    key: args.event.key,
    modifiers: fnGetModifiers({ event: args.event }),
  };
}

export function fnCreateDragStep(args: {
  render: SceneService;
  eventName: "dragstart" | "dragmove" | "dragend";
  event: TMouseEvent;
}): TStep {
  const { x, y } = fnGetPointerPosition({ render: args.render });

  return {
    type: "drag",
    event: args.eventName,
    targetId: fnGetTargetId({ event: args.event }),
    x,
    y,
    modifiers: fnGetModifiers({ event: args.event.evt }),
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
