import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';

export function fnNormalizeRelativeFilePath(path: string): string {
  return path.replace(/^\.\//, '');
}

export function fnLintRequiredWidgetFiles(args: { files: string[]; manifest?: TVibecanvasJson }): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hasFile = (path: string) => args.files.includes(fnNormalizeRelativeFilePath(path));

  if (!hasFile('vibecanvas.json')) errors.push('Missing vibecanvas.json');

  if (args.manifest) {
    const actorFunctionPath = fnNormalizeRelativeFilePath(args.manifest.actor.relFunctionPath);
    const widgetMainPath = `${fnNormalizeRelativeFilePath(args.manifest.widget.relWidgetDir).replace(/\/$/, '')}/main.ts`;

    if (!hasFile(actorFunctionPath)) errors.push(`Missing ${actorFunctionPath}`);
    if (!hasFile(widgetMainPath)) errors.push(`Missing ${widgetMainPath}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
