import {
  WIDGET_SOURCE_MAX_FILES,
  WIDGET_SOURCE_MAX_FILE_BYTES,
  WIDGET_SOURCE_MAX_TOTAL_BYTES,
} from './CONSTANTS';

export type TWidgetSourceFileLike = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

export function fnWidgetSourcePathIsSafe(path: string): boolean {
  if (path.length < 1 || path.length > 1_024) return false;
  if (path.trim() !== path || path.includes('\0') || path.includes('\\')) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('//')) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function fnNormalizeWidgetSourceFiles<TFile extends TWidgetSourceFileLike>(
  files: readonly TFile[],
): readonly TFile[] {
  if (files.length === 0 || files.length > WIDGET_SOURCE_MAX_FILES) {
    throw new Error(`Widget source must contain between 1 and ${WIDGET_SOURCE_MAX_FILES} files.`);
  }

  const ordered = [...files].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
  let totalBytes = 0;
  let previousPath: string | null = null;
  for (const file of ordered) {
    if (!fnWidgetSourcePathIsSafe(file.path)) {
      throw new Error(`Unsafe widget source path '${file.path}'.`);
    }
    if (file.path === previousPath) {
      throw new Error(`Duplicate widget source path '${file.path}'.`);
    }
    if (file.bytes.byteLength > WIDGET_SOURCE_MAX_FILE_BYTES) {
      throw new Error(`Widget source file '${file.path}' exceeds the byte limit.`);
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > WIDGET_SOURCE_MAX_TOTAL_BYTES) {
      throw new Error('Widget source snapshot exceeds the total byte limit.');
    }
    previousPath = file.path;
  }

  return Object.freeze(ordered);
}

export function fnWidgetSourceSnapshotByteSize(files: readonly TWidgetSourceFileLike[]): number {
  return files.reduce((total, file) => total + file.bytes.byteLength, 0);
}
