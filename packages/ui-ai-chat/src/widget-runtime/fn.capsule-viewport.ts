import type { CapsuleViewport } from '@omnidraw/capsule-omnidraw/host';

type TArgs = CapsuleViewport;

function fnClamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Normalizes product geometry to Capsule's exact public viewport bounds.
 * Browser layout dimensions may be fractional even though Capsule requires
 * integer CSS-pixel dimensions and priority.
 */
export function fnWidgetCapsuleViewport(args: TArgs): CapsuleViewport {
  return Object.freeze({
    width: Math.round(fnClamp(args.width, 0, 32_768)),
    height: Math.round(fnClamp(args.height, 0, 32_768)),
    scale: fnClamp(args.scale, 0.25, 8),
    visibility: args.visibility,
    distance: fnClamp(args.distance, 0, 1_000_000),
    priority: Math.round(fnClamp(args.priority, -100, 100)),
    occlusion: fnClamp(args.occlusion, 0, 1),
  });
}
