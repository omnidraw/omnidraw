import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';
import { fnNormalizeTransition } from '@vibecanvas/service-actor/core/fn.normalize-actor-manifest';

export function fnLintManifestStates(manifest: TVibecanvasJson): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stateNames = new Set(Object.keys(manifest.actor.states));

  if (!stateNames.has(manifest.actor.initialState)) {
    errors.push(`actor.initialState '${manifest.actor.initialState}' is not defined in actor.states`);
  }

  if (!stateNames.has('error')) {
    errors.push(`actor.states.error is required because transition failures implicitly move actors to the base error state`);
  } else if (Object.keys(manifest.actor.states.error?.on ?? {}).length === 0) {
    errors.push(`actor.states.error must define at least one recovery input message, for example in.resetError`);
  }

  for (const [stateName, state] of Object.entries(manifest.actor.states)) {
    for (const [messageName, transition] of Object.entries(state?.on ?? {})) {
      if (!transition) continue;
      const normalized = fnNormalizeTransition(transition, stateName as Parameters<typeof fnNormalizeTransition>[1], `actor.states.${stateName}.on.${messageName}`);
      if (normalized.warning) warnings.push(normalized.warning);
      if (!stateNames.has(normalized.transition.targetState)) {
        errors.push(`actor.states.${stateName}.on.${messageName} target state '${normalized.transition.targetState}' is not defined in actor.states`);
      }
      if (normalized.transition.targetState === 'error' || normalized.transition.targetState.startsWith('error.')) {
        warnings.push(`actor.states.${stateName}.on.${messageName} explicitly targets an error state; prefer implicit error transitions`);
      }
    }

    const recoveryTargets = [
      state?.onError?.recover,
      state?.activity?.onError?.recover,
      ...Object.values(state?.on ?? {}).map((transition) => transition?.onError?.recover),
    ].flatMap((recover) => typeof recover === 'object' ? [recover.targetState] : []);
    recoveryTargets.forEach((targetState) => {
      if (!stateNames.has(targetState)) {
        errors.push(`actor.states.${stateName} recovery target state '${targetState}' is not defined in actor.states`);
      }
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
