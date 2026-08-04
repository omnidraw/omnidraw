import type {
  IHumanResourceSecretService,
  TResourceApiCapability,
} from '@omnidraw/api/resource/types';
import type { TResourceJson } from '@omnidraw/resource-runtime';
import type { ResourceService } from './ResourceService';

type TResourceServiceCapabilities = {
  readonly humanSecret: IHumanResourceSecretService;
  readonly resource: TResourceApiCapability;
};

/**
 * Exposes two runtime object capabilities from the singleton resource service
 * without leaking the owner service through either public API surface.
 */
function createResourceServiceCapabilities(
  service: ResourceService,
): TResourceServiceCapabilities {
  // The public oRPC contract validates and serializes results. Casts here are
  // the local adapter between readonly domain values and mutable Zod inference.
  const resource: TResourceApiCapability = Object.freeze({
    listResources: (filter) => service.listResources(filter) as ReturnType<TResourceApiCapability['listResources']>,
    getResource: (resourceId) => service.getResource(resourceId),
    createResource: (input) => service.createResource(input) as ReturnType<TResourceApiCapability['createResource']>,
    renameResource: (args) => service.renameResource(args) as ReturnType<TResourceApiCapability['renameResource']>,
    deleteResource: (resourceId) => service.deleteResource(resourceId),
    listResourceData: (input) => service.listResourceData(input) as ReturnType<TResourceApiCapability['listResourceData']>,
    setResourceDataEntry: (input) => service.setResourceDataEntry({
      ...input,
      value: input.value as TResourceJson,
    }) as ReturnType<TResourceApiCapability['setResourceDataEntry']>,
    deleteResourceDataEntry: (input) => service.deleteResourceDataEntry(input),
    dbResourceImpact: (resourceId) => service.dbResourceImpact(resourceId) as ReturnType<TResourceApiCapability['dbResourceImpact']>,
    inspectDbResource: (input) => service.inspectDbResource(input) as ReturnType<TResourceApiCapability['inspectDbResource']>,
    executeDbLiveSql: (input) => service.executeDbLiveSql(input) as ReturnType<TResourceApiCapability['executeDbLiveSql']>,
    listDbRows: (input) => service.listDbRows(input) as ReturnType<TResourceApiCapability['listDbRows']>,
    getDbRow: (input) => service.getDbRow(input) as ReturnType<TResourceApiCapability['getDbRow']>,
    createDbRow: (input) => service.createDbRow(input) as ReturnType<TResourceApiCapability['createDbRow']>,
    updateDbRow: (input) => service.updateDbRow(input) as ReturnType<TResourceApiCapability['updateDbRow']>,
    deleteDbRow: (input) => service.deleteDbRow(input) as ReturnType<TResourceApiCapability['deleteDbRow']>,
    bulkDbRows: (input) => service.bulkDbRows(input) as ReturnType<TResourceApiCapability['bulkDbRows']>,
    createDbDraft: (resourceId, name) => service.createDbDraft(resourceId, name) as ReturnType<TResourceApiCapability['createDbDraft']>,
    listDbDrafts: (input) => service.listDbDrafts(input) as ReturnType<TResourceApiCapability['listDbDrafts']>,
    getDbDraft: (draftId) => service.getDbDraft(draftId) as ReturnType<TResourceApiCapability['getDbDraft']>,
    getActiveDbDraft: (resourceId) => service.getActiveDbDraft(resourceId) as ReturnType<TResourceApiCapability['getActiveDbDraft']>,
    changeDbDraft: (draftId, operation) => service.changeDbDraft(draftId, operation) as ReturnType<TResourceApiCapability['changeDbDraft']>,
    executeDbDraftSql: (draftId, sql) => service.executeDbDraftSql(draftId, sql) as ReturnType<TResourceApiCapability['executeDbDraftSql']>,
    discardDbDraft: (draftId) => service.discardDbDraft(draftId) as ReturnType<TResourceApiCapability['discardDbDraft']>,
    previewDbApply: (draftId) => service.previewDbApply(draftId) as ReturnType<TResourceApiCapability['previewDbApply']>,
    confirmDbApply: (draftId) => service.confirmDbApply(draftId) as ReturnType<TResourceApiCapability['confirmDbApply']>,
    getDbApply: (applyId) => service.getDbApply(applyId) as ReturnType<TResourceApiCapability['getDbApply']>,
    listDbApplies: (input) => service.listDbApplies(input) as ReturnType<TResourceApiCapability['listDbApplies']>,
    getDbBackup: (resourceId) => service.getDbBackup(resourceId) as ReturnType<TResourceApiCapability['getDbBackup']>,
    discardDbBackup: (resourceId, applyId) => service.discardDbBackup(resourceId, applyId),
    previewDbBackupRestore: (resourceId, applyId) => service.previewDbBackupRestore(resourceId, applyId) as ReturnType<TResourceApiCapability['previewDbBackupRestore']>,
    restoreDbBackup: (resourceId, applyId) => service.restoreDbBackup(resourceId, applyId) as ReturnType<TResourceApiCapability['restoreDbBackup']>,
    getDbRestoreStatus: (restoreId) => service.getDbRestoreStatus(restoreId) as ReturnType<TResourceApiCapability['getDbRestoreStatus']>,
  });
  const humanSecret: IHumanResourceSecretService = Object.freeze({
    revealSecret: (input: { resourceId: string; name: string }) => service.revealSecret(input),
  });
  return Object.freeze({ humanSecret, resource });
}

export { createResourceServiceCapabilities };
export type { TResourceServiceCapabilities };
