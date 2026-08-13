import {
  createCapsuleAuthoringInspection,
  createCapsuleAuthoringInspectionHost,
  type CapsuleAuthoringInspectionController,
  type CapsuleAuthoringInspectionHost,
  type CapsuleAuthoringInspectionOptions,
  type CreateCapsuleAuthoringInspectionHostOptions,
} from '@omnidraw/capsule/authoring-inspection';

export {
  CAPSULE_AUTHORING_INSPECTION_LIMITS,
  type CapsuleAuthoringInspectionAttachment,
  type CapsuleAuthoringInspectionBounds,
  type CapsuleAuthoringInspectionCanvas,
  type CapsuleAuthoringInspectionComputed,
  type CapsuleAuthoringInspectionController,
  type CapsuleAuthoringInspectionDiagnostics,
  type CapsuleAuthoringInspectionFocusedTargetCheck,
  type CapsuleAuthoringInspectionFocusedTargetReason,
  type CapsuleAuthoringInspectionKeyboardGuardReason,
  type CapsuleAuthoringInspectionKeyboardGuardResult,
  type CapsuleAuthoringInspectionKeyboardGuardTicket,
  type CapsuleAuthoringInspectionKeyboardOperation,
  type CapsuleAuthoringInspectionHost,
  type CapsuleAuthoringInspectionMountOptions,
  type CapsuleAuthoringInspectionOptions,
  type CapsuleAuthoringInspectionPointCheck,
  type CapsuleAuthoringInspectionPointReason,
  type CapsuleAuthoringInspectionQuery,
  type CapsuleAuthoringInspectionRequest,
  type CapsuleAuthoringInspectionRole,
  type CapsuleAuthoringInspectionTarget,
  type CreateCapsuleAuthoringInspectionHostOptions,
} from '@omnidraw/capsule/authoring-inspection';

/**
 * Creates the production-supported controller used only by Omnidraw's
 * one-time isolated inspection shell. Bounds may be lowered but Capsule's
 * upstream hard ceilings cannot be raised.
 */
export function createOmnidrawCapsuleAuthoringInspection(
  options: CapsuleAuthoringInspectionOptions = {},
): CapsuleAuthoringInspectionController {
  return createCapsuleAuthoringInspection(options);
}

/** Dedicated trusted host; ordinary Preview and published mounts stay closed. */
export function createOmnidrawCapsuleAuthoringInspectionHost(
  options: CreateCapsuleAuthoringInspectionHostOptions,
): Promise<CapsuleAuthoringInspectionHost> {
  return createCapsuleAuthoringInspectionHost(options);
}
