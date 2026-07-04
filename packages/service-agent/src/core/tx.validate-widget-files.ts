import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from './types';
import { fxWalkFiles } from './fx.walk-files';
import { fnLintActorRegistry } from './lint/fn.actor-registry';
import { fnLintRequiredWidgetFiles, fnNormalizeRelativeFilePath } from './lint/fn.required-widget-files';
import { fnValidateManifest } from './lint/fn.validate-manifest';

export type TDirent = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

export type TPortalValidateWidgetFiles = {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<TDirent[]>;
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  join: (...paths: string[]) => string;
  relative: (from: string, to: string) => string;
};

export type TArgsValidateWidgetFiles = {
  cwd: string;
};

export async function txValidateWidgetFiles(portal: TPortalValidateWidgetFiles, args: TArgsValidateWidgetFiles): Promise<TValidationResult & { files: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const files: string[] = await fxWalkFiles(portal, { root: args.cwd }).catch((): string[] => []);
  const hasFile = (path: string) => files.includes(path);

  let manifest: TVibecanvasJson | null = null;
  if (hasFile('vibecanvas.json')) {
    try {
      manifest = JSON.parse(await portal.readFile(portal.join(args.cwd, 'vibecanvas.json'), 'utf8')) as TVibecanvasJson;
      const manifestValidation = fnValidateManifest(manifest);
      errors.push(...manifestValidation.errors);
      warnings.push(...manifestValidation.warnings);
    } catch (error) {
      errors.push(`Could not parse vibecanvas.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const requiredValidation = fnLintRequiredWidgetFiles({ files, manifest: manifest ?? undefined });
  errors.push(...requiredValidation.errors);
  warnings.push(...requiredValidation.warnings);

  const actorFunctionPath = manifest ? fnNormalizeRelativeFilePath(manifest.actor.relFunctionPath) : null;
  if (manifest && actorFunctionPath && hasFile(actorFunctionPath)) {
    const registry = await portal.readFile(portal.join(args.cwd, actorFunctionPath), 'utf8');
    const registryValidation = fnLintActorRegistry({ manifest, registry });
    errors.push(...registryValidation.errors);
    warnings.push(...registryValidation.warnings);
  }

  return { ok: errors.length === 0, errors, warnings, files };
}
