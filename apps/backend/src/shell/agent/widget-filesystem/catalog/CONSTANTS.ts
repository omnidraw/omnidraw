import {
  WIDGET_BUILD_FILE_COUNT_MAX,
  WIDGET_BUILD_FILE_MAX_BYTES,
  WIDGET_BUILD_TOTAL_BYTES_MAX,
  WIDGET_RELEASE_FILE_COUNT_MAX,
  WIDGET_RELEASE_FILE_MAX_BYTES,
} from '@omnidraw/sdk/contract';
import type { TWidgetCatalogScanLimits } from './typed';

export const WIDGET_CATALOG_MANIFEST_PATH = 'omnidraw.json';
export const WIDGET_CATALOG_RELEASE_PATH = 'release.json';
export const WIDGET_CATALOG_CAPSULE_PATH = 'capsule.artifact';
export const WIDGET_CATALOG_FUNCTIONS_PATH = 'functions.json';
export const WIDGET_CATALOG_MANIFEST_MAX_BYTES = 128 * 1_024;
export const WIDGET_CATALOG_TEXT_FILE_MAX_BYTES = 2 * 1_024 * 1_024;

export const WIDGET_CATALOG_LAYOUT_DIRECTORIES = Object.freeze([
  'drafts',
  'published',
  '.staging',
  '.preview',
  '.trash',
  '.quarantine',
] as const);

export const WIDGET_CATALOG_DRAFT_EXCLUDED_DIRECTORIES = Object.freeze(new Set([
  '.git',
  '.omnidraw',
  'dist',
  'node_modules',
  'server-dist',
]));

export const WIDGET_CATALOG_SCAN_LIMITS: TWidgetCatalogScanLimits = Object.freeze({
  maxWidgetForms: 2_048,
  maxGlobalEntries: 100_000,
  maxGlobalDirectories: 20_000,
  maxGlobalFiles: 50_000,
  maxGlobalTotalBytes: 1_024 * 1_024 * 1_024,
  maxEntriesPerWidget: 20_000,
  maxDepth: 32,
  maxDirectoriesPerWidget: 2_048,
  maxEntriesPerDirectory: 10_002,
  draftMaxFiles: WIDGET_BUILD_FILE_COUNT_MAX + 1,
  draftMaxFileBytes: WIDGET_BUILD_FILE_MAX_BYTES,
  draftMaxTotalBytes: WIDGET_BUILD_TOTAL_BYTES_MAX + 128 * 1_024,
  publishedMaxFiles: WIDGET_RELEASE_FILE_COUNT_MAX + 2,
  publishedMaxFileBytes: WIDGET_RELEASE_FILE_MAX_BYTES,
  publishedMaxTotalBytes: 512 * 1_024 * 1_024,
});
