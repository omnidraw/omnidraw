export type TWidgetBuildImportResolution =
  | Readonly<{ kind: 'snapshot'; path: string }>
  | Readonly<{ kind: 'package'; specifier: string }>;

const MODULE_SUFFIXES = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mts',
  '.mjs',
  '.cts',
  '.cjs',
  '.json',
  '.css',
] as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier === '.'
    || specifier === '..'
    || specifier.startsWith('./')
    || specifier.startsWith('../');
}

function normalizeRelativeImport(importerPath: string, specifier: string): string | null {
  if (specifier.includes('\\') || specifier.includes('\0') || specifier.includes('?') || specifier.includes('#')) {
    return null;
  }
  const segments = importerPath.split('/');
  segments.pop();
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join('/');
}

function resolveSnapshotPath(
  sourcePaths: ReadonlySet<string>,
  candidate: string,
): string | null {
  if (sourcePaths.has(candidate)) return candidate;
  for (const suffix of MODULE_SUFFIXES) {
    const withSuffix = `${candidate}${suffix}`;
    if (sourcePaths.has(withSuffix)) return withSuffix;
  }
  for (const suffix of MODULE_SUFFIXES) {
    const indexPath = `${candidate}/index${suffix}`;
    if (sourcePaths.has(indexPath)) return indexPath;
  }
  return null;
}

function codeWithoutCommentsAndQuotedStrings(sourceText: string): string {
  let result = '';
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;

  for (let index = 0; index < sourceText.length; index += 1) {
    const character = sourceText[index]!;
    const next = sourceText[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        result += '\n';
      } else result += ' ';
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        result += '  ';
        index += 1;
      } else result += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      result += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      result += '  ';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      result += '  ';
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      result += ' ';
      continue;
    }
    result += character;
  }
  return result;
}

/** Copies and validates the exact package specifiers trusted as runtime externals. */
export function fnNormalizeWidgetBuildAllowedPackageImports(
  imports: readonly string[],
): readonly string[] {
  const normalized = [...new Set(imports)].sort(compareText);
  for (const specifier of normalized) {
    if (
      specifier.length === 0
      || specifier !== specifier.trim()
      || isRelativeSpecifier(specifier)
      || specifier.startsWith('/')
      || specifier.startsWith('\\')
      || specifier.includes('\\')
      || specifier.includes('\0')
      || specifier.includes('?')
      || specifier.includes('#')
      || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)
      || !/^(?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9._~+-]+)*$/.test(specifier)
    ) {
      throw new Error('Widget build package allowlist contains an invalid exact specifier.');
    }
  }
  return normalized;
}

/** Resolves a source import only to snapshot bytes or an exact trusted external package. */
export function fnResolveWidgetBuildImport(args: Readonly<{
  importerPath: string;
  specifier: string;
  sourcePaths: readonly string[];
  allowedPackageImports: readonly string[];
}>): TWidgetBuildImportResolution {
  if (
    args.specifier.length === 0
    || args.specifier.startsWith('/')
    || args.specifier.startsWith('\\')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(args.specifier)
  ) {
    throw new Error('Widget build import uses an absolute path or forbidden scheme.');
  }

  if (!isRelativeSpecifier(args.specifier)) {
    if (!args.allowedPackageImports.includes(args.specifier)) {
      throw new Error('Widget build import is not in the fixed package allowlist.');
    }
    return { kind: 'package', specifier: args.specifier };
  }

  const candidate = normalizeRelativeImport(args.importerPath, args.specifier);
  if (candidate === null) {
    throw new Error('Widget build relative import escapes its pinned source snapshot.');
  }
  const path = resolveSnapshotPath(new Set(args.sourcePaths), candidate);
  if (path === null) {
    throw new Error('Widget build relative import is absent from its pinned source snapshot.');
  }
  return { kind: 'snapshot', path };
}

/** Import attributes are forbidden because Bun's macro attribute executes during bundling. */
export function fnWidgetBuildSourceHasForbiddenImportSyntax(sourceText: string): boolean {
  const code = codeWithoutCommentsAndQuotedStrings(sourceText);
  return /\b(?:import|export)\b[\s\S]*?\b(?:with|assert)\s*\{/.test(code)
    || /\bimport\s*\([^)]*,/.test(code)
    || /\bimport\s*\(/.test(code)
    || /\bimport\s*\.\s*meta\b/.test(code)
    || /\brequire\b/.test(code)
    || /["'`]require["'`]\s*\]/.test(sourceText);
}

/** UI builds may never resolve configured or convention-based server modules. */
export function fnWidgetBuildPathIsServerOnly(path: string, serverEntry: string | null): boolean {
  return path === serverEntry
    || /(?:^|\/)server\//.test(path)
    || /(?:^|\/)[^/]+\.server\.(?:[cm]?[jt]sx?)$/.test(path);
}

/** Cross-target modules are opt-in through an auditable shared-safe namespace. */
export function fnWidgetBuildPathIsSharedSafe(path: string): boolean {
  return /(?:^|\/)shared\//.test(path)
    || /(?:^|\/)[^/]+\.shared\.(?:[cm]?[jt]sx?)$/.test(path);
}
