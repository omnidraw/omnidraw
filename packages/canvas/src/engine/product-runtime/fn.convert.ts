import type {
  TDragDraft,
  TInteractionCancelEvent,
  TInteractionSample,
  TNodeTransformProposal,
  TPointerInputEvent,
  TResolvedConnectorGeometry,
  TStrokeSessionEvent,
  TTransform2D,
} from "@vibecanvas/canvas-engine";
import type { TCanvasTarget } from "../../semantic/typed";
import type {
  TCanvasProductConnectorDraft,
  TCanvasProductDragDraft,
  TCanvasProductInteractionCancel,
  TCanvasProductInteractionSample,
  TCanvasProductPointerEvent,
  TCanvasProductResolvedConnector,
  TCanvasProductStrokeEvent,
  TCanvasProductTransform,
  TCanvasProductTransformProposal,
} from "./typed";

type TArgsTransformProposal = {
  target: TCanvasTarget;
  proposal: TNodeTransformProposal;
};

type TArgsConnectorDraft = {
  draft: TDragDraft;
  candidate: TCanvasProductConnectorDraft["candidate"];
  route: TResolvedConnectorGeometry | null;
};

export function fnCanvasProductTransformFromEngine(
  transform: TTransform2D,
): TCanvasProductTransform {
  return {
    position: { ...transform.position },
    rotationRadians: transform.rotation,
    scale: { ...transform.scale },
    skew: { ...transform.skew },
    origin: { ...transform.origin },
  };
}

export function fnCanvasProductTransformToEngine(
  transform: TCanvasProductTransform,
): TTransform2D {
  return {
    position: { ...transform.position },
    rotation: transform.rotationRadians,
    scale: { ...transform.scale },
    skew: { ...transform.skew },
    origin: { ...transform.origin },
  };
}

export function fnCanvasProductTransformProposal(
  args: TArgsTransformProposal,
): TCanvasProductTransformProposal {
  return {
    target: args.target,
    previousTransform: fnCanvasProductTransformFromEngine(
      args.proposal.previousTransform,
    ),
    nextTransform: fnCanvasProductTransformFromEngine(
      args.proposal.nextTransform,
    ),
    ...(args.proposal.previousSize === undefined
      ? {}
      : { previousSize: { ...args.proposal.previousSize } }),
    ...(args.proposal.nextSize === undefined
      ? {}
      : { nextSize: { ...args.proposal.nextSize } }),
  };
}

export function fnCanvasEnginePointerEvent(
  event: TCanvasProductPointerEvent,
): TPointerInputEvent {
  return {
    type: event.type,
    timeStamp: event.timeStamp,
    modifiers: {
      alt: event.modifiers.alt,
      ctrl: event.modifiers.control,
      meta: event.modifiers.meta,
      shift: event.modifiers.shift,
    },
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    buttons: event.buttons,
    button: event.button,
    pressure: event.pressure,
    tilt: { ...event.tilt },
    client: { ...event.client },
    viewport: { ...event.viewport },
    world: { ...event.world },
    deltaViewport: { ...event.deltaViewport },
    deltaWorld: { ...event.deltaWorld },
    hit: null,
  };
}

export function fnCanvasProductInteractionSample(
  sample: TInteractionSample,
): TCanvasProductInteractionSample {
  return {
    pointerId: sample.pointerId,
    pointerType: sample.pointerType,
    world: { ...sample.world },
    viewport: { ...sample.viewport },
    client: { ...sample.client },
    pressure: sample.pressure,
    tilt: { ...sample.tilt },
    timeStamp: sample.timeStamp,
    modifiers: {
      alt: sample.modifiers.alt,
      control: sample.modifiers.ctrl,
      meta: sample.modifiers.meta,
      shift: sample.modifiers.shift,
    },
  };
}

export function fnCanvasProductDragDraft(
  draft: TDragDraft,
): TCanvasProductDragDraft {
  return {
    kind: draft.kind,
    phase: draft.phase,
    start: fnCanvasProductInteractionSample(draft.start),
    current: fnCanvasProductInteractionSample(draft.current),
    worldBounds: { ...draft.worldBounds },
    viewportBounds: { ...draft.viewportBounds },
    distanceViewport: draft.distanceViewport,
  };
}

export function fnCanvasProductInteractionCancel(
  event: TInteractionCancelEvent,
): TCanvasProductInteractionCancel {
  return {
    kind: event.kind,
    pointerId: event.pointerId,
    reason: event.reason,
  };
}

export function fnCanvasProductStrokeEvent(
  event: TStrokeSessionEvent,
): TCanvasProductStrokeEvent {
  return {
    kind: "stroke",
    phase: event.phase,
    samples: event.samples.map(fnCanvasProductInteractionSample),
    added: event.added.map(fnCanvasProductInteractionSample),
    sampleCount: event.sampleCount,
  };
}

export function fnCanvasProductResolvedConnector(
  route: TResolvedConnectorGeometry,
): TCanvasProductResolvedConnector {
  return {
    from: { ...route.from },
    to: { ...route.to },
    pathStart: { ...route.pathStart },
    pathEnd: { ...route.pathEnd },
    path: route.path.commands.map((command) => {
      if (command.type === "A") {
        return {
          ...command,
          radius: { ...command.radius },
          to: { ...command.to },
          xAxisRotationRadians: command.xAxisRotation,
        };
      }
      if (command.type === "Q") {
        return {
          ...command,
          control: { ...command.control },
          to: { ...command.to },
        };
      }
      if (command.type === "C") {
        return {
          ...command,
          control1: { ...command.control1 },
          control2: { ...command.control2 },
          to: { ...command.to },
        };
      }
      return command.type === "Z"
        ? { type: "Z" as const }
        : { type: command.type, to: { ...command.to } };
    }),
    bounds: { ...route.bounds },
    startTangent: { ...route.startTangent },
    endTangent: { ...route.endTangent },
  };
}

export function fnCanvasProductConnectorDraft(
  args: TArgsConnectorDraft,
): TCanvasProductConnectorDraft {
  return {
    ...fnCanvasProductDragDraft(args.draft),
    kind: "connector",
    candidate: args.candidate,
    route: args.route === null
      ? null
      : fnCanvasProductResolvedConnector(args.route),
  };
}
