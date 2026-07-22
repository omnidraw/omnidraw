import type { TWidgetSourceSnapshot } from '@vibecanvas/widget-contract';
import {
  WIDGET_FILE_READ_MAX_BYTES,
  WIDGET_FILE_TEXT_PREVIEW_MAX_BYTES,
  WIDGET_INSPECTION_MAX_FILES,
  WIDGET_PRIVATE_DIRECTORY_NAMES,
  WIDGET_PRIVATE_FILE_NAMES,
  WIDGET_TRANSIENT_PREFIXES,
} from './CONSTANTS';
import { fnIsSafeWidgetRelativePath } from './fn.widget-management';
import type { TWidgetFileEntry, TWidgetFilePreview } from './types';

type TSourceArgs = Readonly<{
  snapshot: TWidgetSourceSnapshot;
}>;

type TFileArgs = TSourceArgs & Readonly<{
  path: string;
  decodeUtf8: (bytes: Uint8Array) => string;
}>;

function sourceIntegrityError(): Error {
  return new Error('OPERATION_UNAVAILABLE: Published widget source artifact is invalid.');
}

function pathIsPrivate(path: string): boolean {
  return path.split('/').some((part) => (
    WIDGET_TRANSIENT_PREFIXES.some((prefix) => part.startsWith(prefix))
    || WIDGET_PRIVATE_DIRECTORY_NAMES.has(part)
    || WIDGET_PRIVATE_FILE_NAMES.has(part)
  ));
}

function visibleFiles(snapshot: TWidgetSourceSnapshot) {
  const paths = new Set<string>();
  const files = snapshot.files.filter((file) => {
    if (!fnIsSafeWidgetRelativePath(file.path)) throw sourceIntegrityError();
    if (paths.has(file.path)) throw sourceIntegrityError();
    paths.add(file.path);
    return !pathIsPrivate(file.path);
  });
  return { files, paths };
}

export function fnV2PublishedWidgetFiles(args: TSourceArgs): TWidgetFileEntry[] {
  const { files, paths } = visibleFiles(args.snapshot);
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const directory = parts.slice(0, index).join('/');
      if (paths.has(directory)) throw sourceIntegrityError();
      directories.add(directory);
    }
    if (directories.has(file.path)) throw sourceIntegrityError();
  }
  const entries: TWidgetFileEntry[] = [
    ...[...directories].map((path) => ({ path, kind: 'directory' as const, size: 0 })),
    ...files.map((file) => ({ path: file.path, kind: 'file' as const, size: file.bytes.byteLength })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length > WIDGET_INSPECTION_MAX_FILES) {
    throw new Error('PAYLOAD_LIMIT: Widget file tree exceeds the inspection limit.');
  }
  return entries;
}

export function fnV2PublishedWidgetFile(args: TFileArgs): TWidgetFilePreview | null {
  if (!fnIsSafeWidgetRelativePath(args.path) || pathIsPrivate(args.path)) {
    throw new Error('UNSAFE_PATH: Widget file path is unsafe.');
  }
  const { files } = visibleFiles(args.snapshot);
  const matching = files.filter((file) => file.path === args.path);
  if (matching.length > 1) throw sourceIntegrityError();
  const file = matching[0];
  if (!file) return null;
  if (file.bytes.byteLength > WIDGET_FILE_READ_MAX_BYTES) {
    throw new Error('PAYLOAD_LIMIT: Widget file exceeds the read limit.');
  }
  const preview = file.bytes.subarray(0, WIDGET_FILE_TEXT_PREVIEW_MAX_BYTES);
  let binary = file.bytes.includes(0);
  let text: string | null = null;
  if (!binary) {
    try {
      text = args.decodeUtf8(preview);
    } catch {
      binary = true;
    }
  }
  return {
    path: file.path,
    size: file.bytes.byteLength,
    binary,
    text: binary ? null : text,
    truncated: file.bytes.byteLength > preview.byteLength,
  };
}

export type { TFileArgs, TSourceArgs };
