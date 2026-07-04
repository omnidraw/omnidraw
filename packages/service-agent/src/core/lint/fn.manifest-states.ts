import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';

export function fnLintManifestStates(manifest: TVibecanvasJson): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stateNames = new Set(Object.keys(manifest.actor.states));

  if (!stateNames.has(manifest.actor.initialState)) {
    errors.push(`actor.initialState '${manifest.actor.initialState}' is not defined in actor.states`);
  }

  for (const [stateName, state] of Object.entries(manifest.actor.states)) {
    for (const [messageName, transition] of Object.entries(state?.on ?? {})) {
      if (!transition) continue;

      transition.allowedTargetStates.forEach((targetState) => {
        if (!stateNames.has(targetState)) {
          errors.push(`actor.states.${stateName}.on.${messageName} target state '${targetState}' is not defined in actor.states`);
        }
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
