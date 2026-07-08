import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';
import { fnWidgetDraftFilesFromManifest } from '../fn.widget-draft-files';

export function fnLintActorRegistry(args: { manifest: TVibecanvasJson; registry: string }): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const functionName of fnWidgetDraftFilesFromManifest(args.manifest)) {
    if (!args.registry.includes(`"${functionName}"`) && !args.registry.includes(`'${functionName}'`)) {
      errors.push(`actor/functions.ts does not register ${functionName}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
