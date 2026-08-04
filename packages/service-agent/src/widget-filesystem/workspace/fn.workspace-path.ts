import type {
  TWidgetWorkspaceLimits,
  TWidgetWorkspaceManagedPath,
  TWidgetWorkspaceTreeCapture,
} from './typed';
import { WIDGET_WORKSPACE_LIMITS } from './CONSTANTS';

function utf8ByteLength(value: string): number {
  let size = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    size += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return size;
}

export function fnNormalizeWidgetWorkspaceRelativePath(
  value: string,
  maximumBytes = WIDGET_WORKSPACE_LIMITS.maxPathBytes,
): string | null {
  if (
    value.length === 0
    || value !== value.trim()
    || value.includes('\\')
    || value.includes('\0')
    || /[\u0000-\u001f\u007f]/.test(value)
    || value !== value.normalize('NFC')
    || value.startsWith('/')
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    || utf8ByteLength(value) > maximumBytes
  ) return null;
  const segments = value.split('/');
  if (segments.some((segment) => (
    segment.length === 0
    || segment === '.'
    || segment === '..'
    || utf8ByteLength(segment) > 255
  ))) return null;
  return segments.join('/');
}

export function fnIsWidgetWorkspaceSlug(value: string): boolean {
  return value.length >= 1
    && value.length <= 100
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function fnClassifyWidgetWorkspaceManagedPath(
  value: string,
): TWidgetWorkspaceManagedPath | null {
  const relativePath = fnNormalizeWidgetWorkspaceRelativePath(value);
  if (relativePath === null) return null;
  const segments = relativePath.split('/');
  if (
    segments[0] === '.staging'
    && segments.length >= 2
    && /^import-[a-z0-9]+(?:-[a-z0-9]+)*-[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(segments[1]!)
  ) return Object.freeze({
    namespace: 'staging',
    relativePath,
    rootRelativePath: segments.slice(0, 2).join('/'),
    segments: Object.freeze(segments),
  });
  if (
    segments[0] === '.preview'
    && segments[1] === 'sessions'
    && segments.length >= 3
    && /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(segments[2]!)
  ) return Object.freeze({
    namespace: 'preview',
    relativePath,
    rootRelativePath: segments.slice(0, 3).join('/'),
    segments: Object.freeze(segments),
  });
  if (
    segments[0] === 'drafts'
    && segments.length >= 2
    && fnIsWidgetWorkspaceSlug(segments[1]!)
  ) return Object.freeze({
    namespace: 'draft',
    relativePath,
    rootRelativePath: segments.slice(0, 2).join('/'),
    segments: Object.freeze(segments),
  });
  return null;
}

export function fnResolveWidgetWorkspaceLimits(
  overrides: Partial<TWidgetWorkspaceLimits> | undefined,
): TWidgetWorkspaceLimits {
  const limits = { ...WIDGET_WORKSPACE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Widget workspace limit '${name}' must be a positive integer.`);
    }
  }
  return Object.freeze(limits);
}

export function fnCanonicalizeWidgetWorkspaceTreeCapture(
  capture: Omit<TWidgetWorkspaceTreeCapture, 'digestSha256' | 'rootRelativePath'>,
): string {
  return JSON.stringify({
    format: 'omnidraw.widget-managed-tree.v1',
    entries: capture.entries,
    files: capture.files,
    fileCount: capture.fileCount,
    directoryCount: capture.directoryCount,
    byteSize: capture.byteSize,
  });
}
