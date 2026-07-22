import type { TWidgetSourceSnapshot } from '@vibecanvas/widget-contract';
import type * as TypeScript from 'typescript';
import {
  WIDGET_TYPESCRIPT_DECLARATION_ENTRYPOINTS,
  WIDGET_TYPESCRIPT_DECLARATION_FILES,
  WIDGET_TYPESCRIPT_MAX_DIAGNOSTICS,
  WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH,
  WIDGET_TYPESCRIPT_MAX_FILES,
  WIDGET_TYPESCRIPT_MAX_FILE_BYTES,
  WIDGET_TYPESCRIPT_MAX_TOTAL_BYTES,
  WIDGET_TYPESCRIPT_STANDARD_LIBRARY_FILES,
} from './CONSTANTS';

export type TPortal = Readonly<{
  typescript: typeof TypeScript;
  decodeUtf8: (bytes: Uint8Array) => string;
  assertCompilerBudget: () => void;
}>;

export type TArgs = Readonly<{
  snapshot: TWidgetSourceSnapshot;
}>;

const TYPESCRIPT_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const TYPESCRIPT_INPUT_PATTERN = /\.(?:[cm]?[jt]sx?|css|json)$/;
const SAFE_SOURCE_PATH_PATTERN = /^[^/\\\u0000-\u001f\u007f]+(?:\/[^/\\\u0000-\u001f\u007f]+)*$/;
const HOST_DECLARATION_ROOT = '/vibecanvas-host-types';
const TYPESCRIPT_LIBRARY_ROOT = '/vibecanvas-typescript-library';
const ASSET_TYPES_PATH = `${HOST_DECLARATION_ROOT}/assets.d.ts`;
const ASSET_TYPES_SOURCE = 'declare module "*.css";\n';

function sourcePathIsSafe(path: string): boolean {
  return SAFE_SOURCE_PATH_PATTERN.test(path)
    && !path.split('/').some((segment) => segment === '.' || segment === '..');
}

function virtualDirectories(fileNames: readonly string[]): ReadonlySet<string> {
  const directories = new Set<string>(['/']);
  for (const fileName of fileNames) {
    let separator = fileName.lastIndexOf('/');
    while (separator >= 0) {
      directories.add(separator === 0 ? '/' : fileName.slice(0, separator));
      if (separator === 0) break;
      separator = fileName.lastIndexOf('/', separator - 1);
    }
  }
  return directories;
}

function compareDiagnostics(
  left: TypeScript.Diagnostic,
  right: TypeScript.Diagnostic,
): number {
  const leftFile = left.file?.fileName ?? '';
  const rightFile = right.file?.fileName ?? '';
  if (leftFile !== rightFile) return leftFile < rightFile ? -1 : 1;
  const leftStart = left.start ?? -1;
  const rightStart = right.start ?? -1;
  if (leftStart !== rightStart) return leftStart - rightStart;
  return left.code - right.code;
}

function formatDiagnostic(
  portal: TPortal,
  sourceRoot: string,
  diagnostic: TypeScript.Diagnostic,
): string {
  const fileName = diagnostic.file?.fileName;
  const sourcePrefix = `${sourceRoot}/`;
  const sourcePath = fileName?.startsWith(sourcePrefix)
    ? fileName.slice(sourcePrefix.length)
    : null;
  let diagnosticLocation = sourcePath ?? (fileName ? 'trusted declaration' : 'TypeScript');
  if (sourcePath && diagnostic.file && diagnostic.start !== undefined) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    diagnosticLocation = `${sourcePath}:${position.line + 1}:${position.character + 1}`;
  }
  const message = portal.typescript
    .flattenDiagnosticMessageText(diagnostic.messageText, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${diagnosticLocation} TS${diagnostic.code}: ${message}`.slice(0, WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH);
}

/** Host-owned no-emit semantic validation over one immutable widget source snapshot. */
export function fxTypecheckWidgetSnapshot(
  portal: TPortal,
  args: TArgs,
): readonly string[] {
  portal.assertCompilerBudget();
  if (!/^[0-9a-f]{64}$/.test(args.snapshot.digestSha256)) {
    throw new Error('Widget TypeScript validation requires a canonical source digest.');
  }
  if (args.snapshot.files.length > WIDGET_TYPESCRIPT_MAX_FILES) {
    throw new Error('Widget TypeScript validation source file count exceeds its bound.');
  }

  const ts = portal.typescript;
  const sourceRoot = `/vibecanvas-widget-snapshot/${args.snapshot.digestSha256}`;
  const virtualFiles = new Map<string, string>();
  let totalBytes = 0;
  for (const file of args.snapshot.files) {
    portal.assertCompilerBudget();
    if (!sourcePathIsSafe(file.path)) {
      throw new Error('Widget TypeScript validation received an unsafe source path.');
    }
    if (file.bytes.byteLength > WIDGET_TYPESCRIPT_MAX_FILE_BYTES) {
      throw new Error('Widget TypeScript validation source file exceeds its byte bound.');
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > WIDGET_TYPESCRIPT_MAX_TOTAL_BYTES) {
      throw new Error('Widget TypeScript validation source snapshot exceeds its byte bound.');
    }
    if (!TYPESCRIPT_INPUT_PATTERN.test(file.path)) continue;
    const virtualPath = `${sourceRoot}/${file.path}`;
    if (virtualFiles.has(virtualPath)) {
      throw new Error('Widget TypeScript validation received a duplicate source path.');
    }
    virtualFiles.set(virtualPath, portal.decodeUtf8(file.bytes));
  }
  for (const [relativePath, source] of Object.entries(WIDGET_TYPESCRIPT_DECLARATION_FILES)) {
    virtualFiles.set(`${HOST_DECLARATION_ROOT}/${relativePath}`, source);
  }
  for (const [fileName, source] of Object.entries(WIDGET_TYPESCRIPT_STANDARD_LIBRARY_FILES)) {
    virtualFiles.set(`${TYPESCRIPT_LIBRARY_ROOT}/${fileName}`, source);
  }
  virtualFiles.set(ASSET_TYPES_PATH, ASSET_TYPES_SOURCE);

  const rootNames = [...virtualFiles.keys()]
    .filter((fileName) => fileName === ASSET_TYPES_PATH || (
      fileName.startsWith(`${sourceRoot}/`) && TYPESCRIPT_SOURCE_PATTERN.test(fileName)
    ))
    .sort();
  const directories = virtualDirectories([...virtualFiles.keys()]);
  const options: TypeScript.CompilerOptions = {
    allowArbitraryExtensions: true,
    allowImportingTsExtensions: true,
    allowJs: true,
    checkJs: false,
    forceConsistentCasingInFileNames: true,
    jsx: ts.JsxEmit.Preserve,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noUncheckedSideEffectImports: true,
    noEmit: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  host.getCurrentDirectory = () => sourceRoot;
  host.getDefaultLibLocation = () => TYPESCRIPT_LIBRARY_ROOT;
  host.getDefaultLibFileName = () => `${TYPESCRIPT_LIBRARY_ROOT}/${ts.getDefaultLibFileName(options)}`;
  host.readFile = (fileName) => {
    portal.assertCompilerBudget();
    return virtualFiles.get(fileName);
  };
  host.fileExists = (fileName) => {
    portal.assertCompilerBudget();
    return virtualFiles.has(fileName);
  };
  host.directoryExists = (directoryName) => {
    portal.assertCompilerBudget();
    return directories.has(directoryName);
  };
  host.getDirectories = () => [];
  host.readDirectory = () => [];
  host.getEnvironmentVariable = () => '';
  host.trace = () => undefined;
  host.realpath = (path) => {
    return path;
  };
  host.writeFile = () => {
    throw new Error('Widget TypeScript validation attempted to emit a file.');
  };
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    portal.assertCompilerBudget();
    const entrypoint = WIDGET_TYPESCRIPT_DECLARATION_ENTRYPOINTS[
      moduleName as keyof typeof WIDGET_TYPESCRIPT_DECLARATION_ENTRYPOINTS
    ];
    if (entrypoint !== undefined) {
      if (
        moduleName === '@vibecanvas/widget-contract'
        && !containingFile.startsWith(`${HOST_DECLARATION_ROOT}/`)
      ) return undefined;
      return {
        resolvedFileName: `${HOST_DECLARATION_ROOT}/${entrypoint}`,
        extension: ts.Extension.Dts,
        isExternalLibraryImport: true,
      };
    }
    if (!moduleName.startsWith('./') && !moduleName.startsWith('../')) return undefined;
    const resolved = ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
    if (!resolved) return undefined;
    const allowedRoot = containingFile.startsWith(`${HOST_DECLARATION_ROOT}/`)
      ? HOST_DECLARATION_ROOT
      : sourceRoot;
    return resolved.resolvedFileName.startsWith(`${allowedRoot}/`) ? resolved : undefined;
  });

  const cancellationToken: TypeScript.CancellationToken = {
    isCancellationRequested: () => {
      try {
        portal.assertCompilerBudget();
        return false;
      } catch {
        return true;
      }
    },
    throwIfCancellationRequested: () => portal.assertCompilerBudget(),
  };
  const program = ts.createProgram({ rootNames, options, host });
  portal.assertCompilerBudget();
  const diagnostics = [
    ...program.getOptionsDiagnostics(cancellationToken),
    ...program.getGlobalDiagnostics(cancellationToken),
    ...program.getSyntacticDiagnostics(undefined, cancellationToken),
    ...program.getSemanticDiagnostics(undefined, cancellationToken),
  ]
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .sort(compareDiagnostics);
  if (diagnostics.length === 0) return Object.freeze([]);

  const visible = diagnostics.length > WIDGET_TYPESCRIPT_MAX_DIAGNOSTICS
    ? diagnostics.slice(0, WIDGET_TYPESCRIPT_MAX_DIAGNOSTICS - 1)
    : diagnostics;
  const formatted = visible.map((diagnostic) => formatDiagnostic(
    portal,
    sourceRoot,
    diagnostic,
  ));
  if (diagnostics.length > WIDGET_TYPESCRIPT_MAX_DIAGNOSTICS) {
    formatted.push(`TypeScript: ${diagnostics.length - visible.length} additional errors omitted.`);
  }
  return Object.freeze(formatted);
}
