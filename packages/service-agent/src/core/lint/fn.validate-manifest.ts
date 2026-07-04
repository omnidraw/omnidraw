import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';
import { fnLintManifestJsonSchemas } from './fn.manifest-json-schemas';
import { fnLintManifestMessageSchemas } from './fn.manifest-message-schemas';
import { fnLintManifestShape } from './fn.manifest-shape';
import { fnLintManifestStates } from './fn.manifest-states';
import { fnLintManifestTransitionFunctions } from './fn.manifest-transition-functions';

export function fnValidateManifest(manifest: TVibecanvasJson): TValidationResult {
  const results = [
    fnLintManifestShape(manifest),
    fnLintManifestStates(manifest),
    fnLintManifestMessageSchemas(manifest),
    fnLintManifestTransitionFunctions(manifest),
    fnLintManifestJsonSchemas(manifest),
  ];

  const errors = results.flatMap((result) => result.errors);
  const warnings = results.flatMap((result) => result.warnings);
  return { ok: errors.length === 0, errors, warnings };
}
