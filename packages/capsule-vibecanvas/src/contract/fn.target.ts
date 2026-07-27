import type { CapsuleExecutionTarget } from '@omnidraw/capsule/protocol';
import type { TVibecanvasCapsuleTarget } from './types';

/**
 * Copies the product target into Capsule's public execution-target contract.
 * Feature profiles are ordered for deterministic downstream identity.
 */
export function fnMapCapsuleTarget(
  target: TVibecanvasCapsuleTarget,
): CapsuleExecutionTarget {
  const featureProfiles = Object.freeze([...target.featureProfiles].sort());
  return Object.freeze({
    runtimeAbi: target.runtimeAbi,
    domProfile: target.domProfile,
    ...(featureProfiles.length === 0 ? {} : { featureProfiles }),
  });
}
