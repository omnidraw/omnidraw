import type { TCanvasModifierState } from "../../semantic/typed";
import type {
  TCanvasInputKeyEvent,
  TCanvasInputPointerEvent,
  TCanvasInputWheelEvent,
  TCanvasNormalizeKeyEventArgs,
  TCanvasNormalizePointerEventArgs,
  TCanvasNormalizeWheelEventArgs,
} from "./typed";

function modifiers(value: {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}): TCanvasModifierState {
  return {
    alt: value.alt,
    control: value.ctrl,
    meta: value.meta,
    shift: value.shift,
  };
}

export function fnNormalizeCanvasPointerEvent(
  args: TCanvasNormalizePointerEventArgs,
): TCanvasInputPointerEvent {
  return {
    type: args.event.type,
    timeStamp: args.event.timeStamp,
    pointerId: args.event.pointerId,
    button: args.event.button,
    buttons: args.event.buttons,
    pointerType: args.event.pointerType,
    client: { ...args.event.client },
    viewport: { ...args.event.viewport },
    world: { ...args.event.world },
    pressure: args.event.pressure,
    tilt: { ...args.event.tilt },
    deltaViewport: { ...args.event.deltaViewport },
    deltaWorld: { ...args.event.deltaWorld },
    modifiers: modifiers(args.event.modifiers),
    hit: args.hit,
  };
}

export function fnNormalizeCanvasWheelEvent(
  args: TCanvasNormalizeWheelEventArgs,
): TCanvasInputWheelEvent {
  return {
    type: "wheel",
    timeStamp: args.event.timeStamp,
    client: { ...args.event.client },
    viewport: { ...args.event.viewport },
    world: { ...args.event.world },
    delta: { ...args.event.delta },
    deltaMode: args.event.deltaMode,
    modifiers: modifiers(args.event.modifiers),
    hit: args.hit,
  };
}

export function fnNormalizeCanvasKeyEvent(
  args: TCanvasNormalizeKeyEventArgs,
): TCanvasInputKeyEvent {
  return {
    type: args.event.type,
    timeStamp: args.event.timeStamp,
    key: args.event.key,
    code: args.event.code,
    repeat: args.event.repeat,
    composing: args.event.composing,
    modifiers: modifiers(args.event.modifiers),
  };
}
