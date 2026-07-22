import type { TWidgetManifestV2 } from '@vibecanvas/widget-contract';
import type { TValidationResult } from '../types';

export function fnNormalizeRelativeFilePath(path: string): string {
  return path.replace(/^\.\//, '');
}

export function fnLintRequiredWidgetFiles(args: { files: string[]; manifest?: TWidgetManifestV2 }): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hasFile = (path: string) => args.files.includes(fnNormalizeRelativeFilePath(path));

  if (!hasFile('vibecanvas.json')) errors.push('Missing vibecanvas.json');

  if (args.manifest) {
    const uiEntryPath = fnNormalizeRelativeFilePath(args.manifest.ui.entry);
    const serverEntryPath = args.manifest.server
      ? fnNormalizeRelativeFilePath(args.manifest.server.entry)
      : null;

    if (!hasFile(uiEntryPath)) errors.push(`Missing ${uiEntryPath}`);
    if (serverEntryPath !== null && !hasFile(serverEntryPath)) {
      errors.push(`Missing ${serverEntryPath}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
