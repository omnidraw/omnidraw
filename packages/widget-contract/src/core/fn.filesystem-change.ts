/** @file Pure evidence-based widget change classification. */

import type {
  TWidgetBuildEnvironment,
  TWidgetChangeClassification,
  TWidgetExecutableInputFile,
  TWidgetManifestV1,
} from '../filesystem/typed';
import {
  fnProjectWidgetExecutableManifest,
  fnProjectWidgetPresentation,
} from './fn.filesystem-manifest';
import {
  fnNormalizeWidgetFilesystemRelativePath,
} from './fn.filesystem-path';

const DEPENDENCY_PATH_PATTERN = /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|(?:[^/]+\/)*(?:tsconfig(?:\.[^/]+)?\.json|vite\.config\.[cm]?[jt]s|rollup\.config\.[cm]?[jt]s|esbuild\.config\.[cm]?[jt]s))$/;
const EXECUTABLE_SOURCE_PATTERN = /^(?:ui|server|shared)\//;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function changedFilePaths(
  previousFiles: readonly TWidgetExecutableInputFile[],
  nextFiles: readonly TWidgetExecutableInputFile[],
): readonly string[] {
  const collect = (files: readonly TWidgetExecutableInputFile[]) => {
    const result = new Map<string, Uint8Array>();
    for (const file of files) {
      const path = fnNormalizeWidgetFilesystemRelativePath(file.path);
      if (path === null || result.has(path)) {
        throw new TypeError(`Invalid or duplicate widget input path: ${file.path}`);
      }
      if (path !== 'omnidraw.json') result.set(path, file.bytes);
    }
    return result;
  };
  const previous = collect(previousFiles);
  const next = collect(nextFiles);
  return [...new Set([...previous.keys(), ...next.keys()])]
    .filter((path) => {
      const left = previous.get(path);
      const right = next.get(path);
      return left === undefined || right === undefined || !sameBytes(left, right);
    })
    .sort(compareText);
}

export function fnClassifyWidgetChange(args: Readonly<{
  previous: Readonly<{
    manifest: TWidgetManifestV1;
    files?: readonly TWidgetExecutableInputFile[];
    environment?: TWidgetBuildEnvironment;
  }>;
  next:
    | Readonly<{ valid: false; reason: string }>
    | Readonly<{
        valid: true;
        manifest: TWidgetManifestV1;
        files?: readonly TWidgetExecutableInputFile[];
        environment?: TWidgetBuildEnvironment;
      }>;
}>): TWidgetChangeClassification {
  if (!args.next.valid) return { class: 'invalid', changedPaths: [], reason: args.next.reason };
  let changedPaths: readonly string[];
  try {
    changedPaths = changedFilePaths(args.previous.files ?? [], args.next.files ?? []);
  } catch (error) {
    return {
      class: 'invalid',
      changedPaths: [],
      reason: error instanceof Error ? error.message : 'Invalid widget input observation.',
    };
  }
  if (args.previous.manifest.slug !== args.next.manifest.slug) {
    return { class: 'identity', changedPaths, reason: 'The portable widget slug changed.' };
  }
  if (!sameValue(args.previous.environment, args.next.environment)) {
    return { class: 'ambiguous', changedPaths, reason: 'The build environment changed and executable reuse is not proven safe.' };
  }
  if (changedPaths.some((path) => DEPENDENCY_PATH_PATTERN.test(path))) {
    return { class: 'dependency', changedPaths, reason: 'A dependency or build input changed.' };
  }
  if (changedPaths.some((path) => !EXECUTABLE_SOURCE_PATTERN.test(path))) {
    return { class: 'ambiguous', changedPaths, reason: 'An unclassified build-visible file changed.' };
  }
  const previousExecutable = fnProjectWidgetExecutableManifest(args.previous.manifest);
  const nextExecutable = fnProjectWidgetExecutableManifest(args.next.manifest);
  if (!sameValue(previousExecutable.resources, nextExecutable.resources)) {
    return { class: 'resource-contract', changedPaths, reason: 'Portable resource needs changed.' };
  }
  if (
    changedPaths.length > 0
    || previousExecutable.schemaVersion !== nextExecutable.schemaVersion
    || !sameValue(previousExecutable.ui, nextExecutable.ui)
    || !sameValue(previousExecutable.server, nextExecutable.server)
  ) return { class: 'executable', changedPaths, reason: 'Executable widget input changed.' };
  if (!sameValue(
    fnProjectWidgetPresentation(args.previous.manifest),
    fnProjectWidgetPresentation(args.next.manifest),
  )) return { class: 'presentation-only', changedPaths, reason: 'Only presentation metadata changed.' };
  return {
    class: 'presentation-only',
    changedPaths,
    reason: 'No executable, dependency, identity, or resource-contract input changed.',
  };
}
