import type { TWidgetManifestV1 } from '@omnidraw/sdk/contract';
import type { TValidationResult } from '../types';
import { ZWidgetManifestV1 as Z_OMNIDRAW_JSON } from '@omnidraw/sdk/contract';

export function fnLintManifestShape(manifest: TWidgetManifestV1): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const zodResult = Z_OMNIDRAW_JSON.safeParse(manifest);

  if (!zodResult.success) {
    errors.push(...zodResult.error.issues.map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`));
  }

  return { ok: errors.length === 0, errors, warnings };
}
