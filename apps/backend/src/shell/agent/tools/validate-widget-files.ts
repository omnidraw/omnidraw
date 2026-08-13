import type { TWidgetManifestV1 } from '@omnidraw/sdk/contract';
import type { TValidationResult } from './types';
import { walkFiles } from '../workspace/walk-files';
import { fnLintRequiredWidgetFiles } from '../../../core/agent/lint/fn.required-widget-files';
import { fnValidateManifest } from '../../../core/agent/lint/fn.validate-manifest';

export type TDirent = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

export type TEffectsValidateWidgetFiles = {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<TDirent[]>;
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  join: (...paths: string[]) => string;
  relative: (from: string, to: string) => string;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  rm: (path: string, options: { force: true }) => Promise<void>;
  execFile: (
    file: string,
    args: readonly string[],
    options: { cwd: string; timeout: number; maxBuffer: number },
    callback: (error: Error | null, stdout: unknown, stderr: unknown) => void,
  ) => void;
};

export type TArgsValidateWidgetFiles = {
  cwd: string;
};

export async function validateWidgetFiles(
  effects: TEffectsValidateWidgetFiles,
  args: TArgsValidateWidgetFiles,
): Promise<TValidationResult & { files: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const files: string[] = await walkFiles(effects, { root: args.cwd }).catch((): string[] => []);
  const hasFile = (path: string): boolean => files.includes(path);

  let manifest: TWidgetManifestV1 | null = null;
  if (hasFile('omnidraw.json')) {
    try {
      const candidate: unknown = JSON.parse(
        await effects.readFile(effects.join(args.cwd, 'omnidraw.json'), 'utf8'),
      );
      manifest = candidate as TWidgetManifestV1;
      const manifestValidation = fnValidateManifest(manifest);
      errors.push(...manifestValidation.errors);
      warnings.push(...manifestValidation.warnings);
      if (!manifestValidation.ok) manifest = null;
    } catch (error) {
      errors.push(`Could not parse omnidraw.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const requiredValidation = fnLintRequiredWidgetFiles({
    files,
    manifest: manifest ?? undefined,
  });
  errors.push(...requiredValidation.errors);
  warnings.push(...requiredValidation.warnings);

  return { ok: errors.length === 0, errors, warnings, files };
}
