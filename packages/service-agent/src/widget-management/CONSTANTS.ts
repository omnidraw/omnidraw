export const WIDGET_CATALOG_MAX_FILES = 2_000;
export const WIDGET_CATALOG_MAX_BYTES = 20 * 1024 * 1024;
export const WIDGET_INSPECTION_MAX_FILES = 4_000;
export const WIDGET_FILE_READ_MAX_BYTES = 5 * 1024 * 1024;
export const WIDGET_FILE_TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

export const WIDGET_PRIVATE_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  '.vibecanvas-wizard',
  '.vibecanvas-preview',
]);

export const WIDGET_PRIVATE_FILE_NAMES = new Set([
  '.vibecanvas-validate.tsconfig.json',
]);

export const WIDGET_TRANSIENT_PREFIXES = [
  '.publish-',
  '.publish-backup-',
  '.reconcile-',
  '.sync-',
  '.sync-backup-',
  '.create-',
  '.preview-',
];
