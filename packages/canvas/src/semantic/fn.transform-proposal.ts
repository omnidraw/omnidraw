import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasElementTransformPatch,
  TCanvasTransformProposal,
} from "./typed";

const FULL_TURN_RADIANS = Math.PI * 2;

function fnNormalizeDegrees(degrees: number) {
  const normalized = ((degrees % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function fnRadiansToPersistedDegrees(radians: number) {
  return fnNormalizeDegrees((radians / FULL_TURN_RADIANS) * 360);
}

export function fnElementTransformPatch(
  element: TElement,
  proposal: TCanvasTransformProposal,
): TCanvasElementTransformPatch | null {
  if (
    proposal.target.kind !== "element"
    || proposal.target.id !== element.id
  ) {
    return null;
  }

  const patch: TCanvasElementTransformPatch = {
    x: proposal.position?.x ?? element.x,
    y: proposal.position?.y ?? element.y,
    rotation: proposal.rotationRadians === undefined
      ? element.rotation
      : fnRadiansToPersistedDegrees(proposal.rotationRadians),
    scaleX: proposal.scale?.x ?? element.scaleX,
    scaleY: proposal.scale?.y ?? element.scaleY,
  };

  if (proposal.size) {
    patch.width = proposal.size.width;
    patch.height = proposal.size.height;
  }

  return patch;
}
