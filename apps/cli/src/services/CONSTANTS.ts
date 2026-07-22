// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import arrowCoreDeclarations from './widget-typescript-declarations/arrow-core.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import sdkCollaborativeStateDeclarations from './widget-typescript-declarations/sdk-collaborative-state-client.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import sdkFunctionClientDeclarations from './widget-typescript-declarations/sdk-function-client.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import sdkServerDeclarations from './widget-typescript-declarations/sdk-server.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import sdkSharedDeclarations from './widget-typescript-declarations/sdk-shared.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import sdkWidgetDeclarations from './widget-typescript-declarations/sdk-widget.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import widgetContractDeclarations from './widget-typescript-widget-contract.d.ts' with { type: 'text' };
// @ts-expect-error Bun's text loader embeds declaration source instead of its TypeScript exports.
import zodDeclarations from './widget-typescript-zod.d.ts' with { type: 'text' };
import { WIDGET_TYPESCRIPT_STANDARD_LIBRARY_FILES } from './widget-typescript-standard-libraries';

export const RESOURCE_MANAGEMENT_OPERATION = 'vibecanvas.resource.management';

export const FUNCTION_IDEMPOTENCY_TTL_DEFAULT_MS = 30 * 24 * 60 * 60 * 1_000;
export const FUNCTION_IDEMPOTENCY_TTL_MINIMUM_MS = 60 * 1_000;
export const FUNCTION_IDEMPOTENCY_TTL_MAXIMUM_MS = 90 * 24 * 60 * 60 * 1_000;

export const RESOURCE_MANAGEMENT_EFFECTS = {
  kv: {
    countData: 'read',
    listData: 'read',
    getData: 'read',
    setData: 'write',
    deleteData: 'write',
    renameResource: 'write',
    deleteResource: 'write',
  },
  secretStore: {
    countData: 'read',
    listData: 'read',
    getData: 'read',
    setData: 'write',
    deleteData: 'write',
    revealSecret: 'read',
    renameResource: 'write',
    deleteResource: 'write',
  },
  db: {
    impact: 'read',
    inspect: 'read',
    executeLiveSql: 'write',
    listRows: 'read',
    getRow: 'read',
    createRow: 'write',
    updateRow: 'write',
    deleteRow: 'write',
    bulkRows: 'write',
    createDraft: 'write',
    listDrafts: 'read',
    getDraft: 'read',
    getActiveDraft: 'read',
    changeDraft: 'write',
    executeDraftSql: 'write',
    discardDraft: 'write',
    previewApply: 'read',
    confirmApply: 'write',
    getApply: 'read',
    listApplies: 'read',
    getBackup: 'read',
    discardBackup: 'write',
    previewRestore: 'read',
    restore: 'write',
    restoreStatus: 'read',
    renameResource: 'write',
    deleteResource: 'write',
  },
} as const;

export const WIDGET_TYPESCRIPT_MAX_FILES = 1_000;
export const WIDGET_TYPESCRIPT_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const WIDGET_TYPESCRIPT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
export const WIDGET_TYPESCRIPT_MAX_DIAGNOSTICS = 8;
export const WIDGET_TYPESCRIPT_MAX_DIAGNOSTIC_LENGTH = 512;
export const WIDGET_TYPESCRIPT_TIMEOUT_MS = 5_000;
export const WIDGET_TYPESCRIPT_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;
export const WIDGET_TYPESCRIPT_MEMORY_SAMPLE_MS = 50;
export const WIDGET_TYPESCRIPT_MAX_CONCURRENCY = 1;

export { WIDGET_TYPESCRIPT_STANDARD_LIBRARY_FILES };

export const WIDGET_TYPESCRIPT_DECLARATION_FILES = Object.freeze({
  'node_modules/@arrow-js/core/index.d.ts': arrowCoreDeclarations as unknown as string,
  'node_modules/@vibecanvas/sdk/collaborative-state-client.d.ts': sdkCollaborativeStateDeclarations as unknown as string,
  'node_modules/@vibecanvas/sdk/function-client.d.ts': sdkFunctionClientDeclarations as unknown as string,
  'node_modules/@vibecanvas/sdk/server.d.ts': sdkServerDeclarations as unknown as string,
  'node_modules/@vibecanvas/sdk/shared.d.ts': sdkSharedDeclarations as unknown as string,
  'node_modules/@vibecanvas/sdk/widget.d.ts': sdkWidgetDeclarations as unknown as string,
  'node_modules/@vibecanvas/widget-contract/index.d.ts': widgetContractDeclarations as unknown as string,
  'node_modules/zod/external.d.ts': zodDeclarations as unknown as string,
  'node_modules/zod/index.d.ts': [
    "export * as z from './external';",
    "export * from './external';",
    '',
  ].join('\n'),
});

export const WIDGET_TYPESCRIPT_DECLARATION_ENTRYPOINTS = Object.freeze({
  '@arrow-js/core': 'node_modules/@arrow-js/core/index.d.ts',
  '@vibecanvas/sdk/function-client': 'node_modules/@vibecanvas/sdk/function-client.d.ts',
  '@vibecanvas/sdk/server': 'node_modules/@vibecanvas/sdk/server.d.ts',
  '@vibecanvas/sdk/widget': 'node_modules/@vibecanvas/sdk/widget.d.ts',
  '@vibecanvas/widget-contract': 'node_modules/@vibecanvas/widget-contract/index.d.ts',
  zod: 'node_modules/zod/index.d.ts',
});
