import type { TWidgetCapsuleBuildIdentity } from '@omnidraw/widget-contract';

export const RESOURCE_MANAGEMENT_OPERATION = 'omnidraw.resource.management';

export const FUNCTION_IDEMPOTENCY_TTL_DEFAULT_MS = 30 * 24 * 60 * 60 * 1_000;
export const FUNCTION_IDEMPOTENCY_TTL_MINIMUM_MS = 60 * 1_000;
export const FUNCTION_IDEMPOTENCY_TTL_MAXIMUM_MS = 90 * 24 * 60 * 60 * 1_000;

export const WIDGET_CAPSULE_BUILD_IDENTITY = Object.freeze({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.12.0',
  packageDigest: 'sha256:d01c2ad66af0b54af8d88124a28b8efc2f32081ef3b73fdcc58826658c461f8f',
  buildApiVersion: '0.1.0',
  runtimeBuildDigest: 'sha256:e7c239a3853ff6918c22dc5cea4246e863a89938f75fccbab0dd8e76023c775d',
}) satisfies TWidgetCapsuleBuildIdentity;

export const WIDGET_CAPSULE_BUILD_POLICY_ID = 'omnidraw-capsule-widget-v2';
export const WIDGET_CAPSULE_PREVIEW_SIGNING_KEY_ID = 'omnidraw-preview-v1';
export const WIDGET_CAPSULE_RELEASE_SIGNING_KEY_ID = 'omnidraw-release-v1';

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
