import type { TWidgetManifestV3 } from '@omnidraw/widget-contract';
import type { TValidationResult } from '../types';
import { Z_OMNIDRAW_JSON } from '../../tools/CONSTANTS';

export function fnLintManifestShape(manifest: TWidgetManifestV3): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const zodResult = Z_OMNIDRAW_JSON.safeParse(manifest);

  if (!zodResult.success) {
    errors.push(...zodResult.error.issues.map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`));
  }

  return { ok: errors.length === 0, errors, warnings };
}
