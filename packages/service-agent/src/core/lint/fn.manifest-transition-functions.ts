import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';

export function fnLintManifestTransitionFunctions(manifest: TVibecanvasJson): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const state of Object.values(manifest.actor.states)) {
    for (const transition of Object.values(state?.on ?? {})) {
      if (!transition) continue;

      transition.func.forEach((functionName) => {
        if (!/^(fn|fx|tx)\..+/.test(functionName)) {
          errors.push(`transition function '${functionName}' must start with fn., fx., or tx.`);
        }
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
