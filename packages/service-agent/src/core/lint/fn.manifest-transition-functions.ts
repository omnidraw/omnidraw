import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';
import { fnWidgetDraftFilesFromManifest } from '../fn.widget-draft-files';

export function fnLintManifestTransitionFunctions(manifest: TVibecanvasJson): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const functionName of fnWidgetDraftFilesFromManifest(manifest)) {
    if (!/^(fn|fx|tx)\..+/.test(functionName)) {
      errors.push(`actor function '${functionName}' must start with fn., fx., or tx.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
