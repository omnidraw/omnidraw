import {
  WIDGET_BUILD_FILE_COUNT_MAX,
  WIDGET_BUILD_FILE_MAX_BYTES,
  WIDGET_BUILD_TOTAL_BYTES_MAX,
} from '@omnidraw/sdk/contract';
import type { TWidgetWorkspaceLimits } from './typed';

export const WIDGET_WORKSPACE_DIRECTORY_MODE = 0o700;
export const WIDGET_WORKSPACE_FILE_MODE = 0o600;
export const WIDGET_WORKSPACE_EXECUTABLE_FILE_MODE = 0o700;
export const WIDGET_WORKSPACE_MANIFEST_MAX_BYTES = 128 * 1_024;

export const WIDGET_WORKSPACE_SOURCE_EXCLUDED_DIRECTORIES = Object.freeze(new Set([
  '.git',
  '.omnidraw',
  'dist',
  'node_modules',
  'server-dist',
]));

export const WIDGET_WORKSPACE_LIMITS: TWidgetWorkspaceLimits = Object.freeze({
  maxDepth: 32,
  maxEntries: 20_000,
  maxEntriesPerDirectory: 10_000,
  maxDirectories: 4_096,
  maxFiles: WIDGET_BUILD_FILE_COUNT_MAX + 1,
  maxFileBytes: WIDGET_BUILD_FILE_MAX_BYTES,
  maxTotalBytes: WIDGET_BUILD_TOTAL_BYTES_MAX + WIDGET_WORKSPACE_MANIFEST_MAX_BYTES,
  maxPathBytes: 1_024,
});
