import type { TWidgetRuntimeBuildIdentity } from '@omnidraw/sdk/contract';

export const RESOURCE_MANAGEMENT_OPERATION = 'omnidraw.resource.management';

export const FUNCTION_IDEMPOTENCY_TTL_DEFAULT_MS = 30 * 24 * 60 * 60 * 1_000;
export const FUNCTION_IDEMPOTENCY_TTL_MINIMUM_MS = 60 * 1_000;
export const FUNCTION_IDEMPOTENCY_TTL_MAXIMUM_MS = 90 * 24 * 60 * 60 * 1_000;

export const WIDGET_CAPSULE_BUILD_IDENTITY = Object.freeze({
  packageName: '@omnidraw/capsule',
  packageVersion: '0.17.1',
  // SHA-256 of the published npm tarball.
  packageDigest: 'sha256:dfa2e1d252085254791009bbf09dc65b97ad4656c59c1e62f01166600b4db721',
  buildApiVersion: '0.1.0',
  // SHA-256 of sorted dist/**/*.js entries: relative POSIX path + NUL + bytes + NUL.
  runtimeBuildDigest: 'sha256:8668c7e7ccf0b9c97a947fc800d67cbb314c423fb3f9b33bc9393ee7cf16f53a',
}) satisfies TWidgetRuntimeBuildIdentity;

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
