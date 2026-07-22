export const WIDGET_SOURCE_MAX_FILES = 1_000;
export const WIDGET_SOURCE_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
export const WIDGET_SOURCE_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const WIDGET_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
/** Base64 source envelopes remain bounded but need headroom above raw snapshot bytes. */
export const WIDGET_SOURCE_ARTIFACT_MAX_BYTES = 32 * 1024 * 1024;
export const WIDGET_ARTIFACT_BLOB_DIRECTORY = 'blobs';
export const WIDGET_ARTIFACT_DIGEST_ALGORITHM = 'sha256';
export const WIDGET_ARTIFACT_TEMP_SUFFIX = '.tmp';
export const WIDGET_BUILD_DEFAULT_ALLOWED_UI_PACKAGE_IMPORTS: readonly string[] = Object.freeze([
  '@arrow-js/core',
  '@vibecanvas/sdk/function-client',
  '@vibecanvas/sdk/widget',
]);
export const WIDGET_BUILD_DEFAULT_ALLOWED_SERVER_PACKAGE_IMPORTS: readonly string[] = Object.freeze([
  '@vibecanvas/sdk/server',
  'zod',
]);
