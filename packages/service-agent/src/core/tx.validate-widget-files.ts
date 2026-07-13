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
  sdkActorTypePath: string;
};

function txCompileActorTypescript(portal: TPortalValidateWidgetFiles, args: TArgsValidateWidgetFiles): Promise<string[]> {
  const configPath = portal.join(args.cwd, '.vibecanvas-validate.tsconfig.json');
  const config = `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: args.cwd,
      paths: {
        '@vibecanvas/sdk/actor': [args.sdkActorTypePath],
      },
    },
    include: ['actor/**/*.ts'],
  }, null, 2)}\n`;

  return portal.writeFile(configPath, config, 'utf8').then(() => new Promise<string[]>((resolve) => {
    portal.execFile('bun', ['x', 'tsc', '--pretty', 'false', '--noEmit', '-p', configPath], {
      cwd: args.cwd,
      timeout: 30_000,
      maxBuffer: 1_000_000,
    }, (error, stdout, stderr) => {
      const output = `${String(stdout)}\n${String(stderr)}`.trim();
      const lines = output.split(/\r?\n/).filter(Boolean).slice(0, 40);
      void portal.rm(configPath, { force: true }).then(() => {
        resolve(error ? (lines.length > 0 ? lines : [`Actor TypeScript validation failed: ${error.message}`]) : []);
      });
    });
  }));
}

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

  if (hasFile('tsconfig.json') && files.some((file) => file.startsWith('actor/') && file.endsWith('.ts'))) {
    errors.push(...await txCompileActorTypescript(portal, args));
  }

  return { ok: errors.length === 0, errors, warnings, files };
}
