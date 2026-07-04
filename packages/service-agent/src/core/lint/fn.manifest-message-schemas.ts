import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';

export function fnLintManifestMessageSchemas(manifest: TVibecanvasJson): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inputSchemaNames = new Set(Object.keys(manifest.actor.inputMsgSchema ?? {}));
  const outputSchemaNames = new Set(Object.keys(manifest.actor.outputMsgSchema ?? {}));

  for (const [stateName, state] of Object.entries(manifest.actor.states)) {
    for (const [messageName, transition] of Object.entries(state?.on ?? {})) {
      if (!transition) continue;
      if (!inputSchemaNames.has(messageName)) {
        errors.push(`actor.states.${stateName}.on.${messageName} has no actor.inputMsgSchema entry`);
      }
    }
  }

  if (inputSchemaNames.size === 0) {
    warnings.push('actor.inputMsgSchema is empty; widget UI will have no typed actor inputs.');
  }

  if (outputSchemaNames.size === 0) {
    warnings.push('actor.outputMsgSchema is empty; actor connections will have no typed outputs.');
  }

  return { ok: errors.length === 0, errors, warnings };
}
