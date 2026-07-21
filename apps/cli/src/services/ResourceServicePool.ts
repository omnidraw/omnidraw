import type {
  IHumanResourceSecretService,
  TResourceApiCapability,
} from '@vibecanvas/api/resource/types';
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import { ResourceService } from './ResourceService';
import {
  TenantServicePool,
  type TTenantServicePoolOptions,
} from './TenantServicePool';

type TResourceServicePoolOptions = Omit<
  TTenantServicePoolOptions<ResourceService>,
  'key'
>;

type TResourceServiceCapabilities = {
  readonly humanSecret: IHumanResourceSecretService;
  readonly resource: TResourceApiCapability;
};

/** One physical resource owner per organization placement, shared by accounts. */
class ResourceServicePool extends TenantServicePool<ResourceService>
implements TResourceApiCapability, IHumanResourceSecretService {
  constructor(options: TResourceServicePoolOptions) {
    super('resource-store-pool', {
      ...options,
      key: (tenant) => fnScopedKey('resource-store', [
        tenant.orgId,
        tenant.cellId,
        String(tenant.placementEpoch),
      ]),
    });
  }

  listResources: TResourceApiCapability['listResources'] = (tenant, filter) => (
    this.#delegate(tenant, (service) => service.listResources(tenant, filter))
  );

  getResource: TResourceApiCapability['getResource'] = (tenant, resourceId) => (
    this.#delegate(tenant, (service) => service.getResource(tenant, resourceId))
  );

  createResource: TResourceApiCapability['createResource'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.createResource(tenant, input))
  );

  renameResource: TResourceApiCapability['renameResource'] = (tenant, args) => (
    this.#delegate(tenant, (service) => service.renameResource(tenant, args))
  );

  deleteResource: TResourceApiCapability['deleteResource'] = (tenant, resourceId) => (
    this.#delegate(tenant, (service) => service.deleteResource(tenant, resourceId))
  );

  listResourceReferences: TResourceApiCapability['listResourceReferences'] = (tenant, resourceId) => (
    this.#delegate(tenant, (service) => service.listResourceReferences(tenant, resourceId))
  );

  listResourceData: TResourceApiCapability['listResourceData'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.listResourceData(tenant, input))
  );

  setResourceDataEntry: TResourceApiCapability['setResourceDataEntry'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.setResourceDataEntry(tenant, {
      ...input,
      value: input.value as import('@vibecanvas/resource-runtime').TResourceJson,
    }))
  );

  deleteResourceDataEntry: TResourceApiCapability['deleteResourceDataEntry'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.deleteResourceDataEntry(tenant, input))
  );

  revealSecret: IHumanResourceSecretService['revealSecret'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.revealSecret(tenant, input))
  );

  getDefinitionResourceStatus: TResourceApiCapability['getDefinitionResourceStatus'] = (tenant, definitionName) => (
    this.#delegate(tenant, (service) => service.getDefinitionResourceStatus(tenant, definitionName))
  );

  bindResource: TResourceApiCapability['bindResource'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.bindResource(tenant, input))
  );

  unbindResource: TResourceApiCapability['unbindResource'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.unbindResource(tenant, input))
  );

  dbResourceImpact: TResourceApiCapability['dbResourceImpact'] = (tenant, resourceId) => (
    this.#delegate(tenant, (service) => service.dbResourceImpact(tenant, resourceId))
  );

  inspectDbResource: TResourceApiCapability['inspectDbResource'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.inspectDbResource(tenant, input))
  );

  executeDbLiveSql: TResourceApiCapability['executeDbLiveSql'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.executeDbLiveSql(tenant, input))
  );

  listDbRows: TResourceApiCapability['listDbRows'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.listDbRows(tenant, input))
  );

  getDbRow: TResourceApiCapability['getDbRow'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.getDbRow(tenant, input))
  );

  createDbRow: TResourceApiCapability['createDbRow'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.createDbRow(tenant, input))
  );

  updateDbRow: TResourceApiCapability['updateDbRow'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.updateDbRow(tenant, input))
  );

  deleteDbRow: TResourceApiCapability['deleteDbRow'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.deleteDbRow(tenant, input))
  );

  bulkDbRows: TResourceApiCapability['bulkDbRows'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.bulkDbRows(tenant, input))
  );

  createDbDraft: TResourceApiCapability['createDbDraft'] = (tenant, resourceId, name) => (
    this.#delegate(tenant, (service) => service.createDbDraft(tenant, resourceId, name))
  );

  listDbDrafts: TResourceApiCapability['listDbDrafts'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.listDbDrafts(tenant, input))
  );

  getDbDraft: TResourceApiCapability['getDbDraft'] = (tenant, draftId) => (
    this.#delegate(tenant, (service) => service.getDbDraft(tenant, draftId))
  );

  getActiveDbDraft: TResourceApiCapability['getActiveDbDraft'] = (tenant, resourceId) => (
    this.#delegate(tenant, (service) => service.getActiveDbDraft(tenant, resourceId))
  );

  changeDbDraft: TResourceApiCapability['changeDbDraft'] = (tenant, draftId, operation) => (
    this.#delegate(tenant, (service) => service.changeDbDraft(tenant, draftId, operation))
  );

  executeDbDraftSql: TResourceApiCapability['executeDbDraftSql'] = (tenant, draftId, sql) => (
    this.#delegate(tenant, (service) => service.executeDbDraftSql(tenant, draftId, sql))
  );

  discardDbDraft: TResourceApiCapability['discardDbDraft'] = (tenant, draftId) => (
    this.#delegate(tenant, (service) => service.discardDbDraft(tenant, draftId))
  );

  previewDbApply: TResourceApiCapability['previewDbApply'] = (tenant, draftId) => (
    this.#delegate(tenant, (service) => service.previewDbApply(tenant, draftId))
  );

  confirmDbApply: TResourceApiCapability['confirmDbApply'] = (tenant, draftId) => (
    this.#delegate(tenant, (service) => service.confirmDbApply(tenant, draftId))
  );

  getDbApply: TResourceApiCapability['getDbApply'] = (tenant, applyId) => (
    this.#delegate(tenant, (service) => service.getDbApply(tenant, applyId))
  );

  listDbApplies: TResourceApiCapability['listDbApplies'] = (tenant, input) => (
    this.#delegate(tenant, (service) => service.listDbApplies(tenant, input))
  );

  getDbBackup: TResourceApiCapability['getDbBackup'] = (tenant, resourceId) => (
    this.#delegate(tenant, (service) => service.getDbBackup(tenant, resourceId))
  );

  discardDbBackup: TResourceApiCapability['discardDbBackup'] = (tenant, resourceId, applyId) => (
    this.#delegate(tenant, (service) => service.discardDbBackup(tenant, resourceId, applyId))
  );

  previewDbBackupRestore: TResourceApiCapability['previewDbBackupRestore'] = (tenant, resourceId, applyId) => (
    this.#delegate(tenant, (service) => service.previewDbBackupRestore(tenant, resourceId, applyId))
  );

  restoreDbBackup: TResourceApiCapability['restoreDbBackup'] = (tenant, resourceId, applyId) => (
    this.#delegate(tenant, (service) => service.restoreDbBackup(tenant, resourceId, applyId))
  );

  getDbRestoreStatus: TResourceApiCapability['getDbRestoreStatus'] = (tenant, restoreId) => (
    this.#delegate(tenant, (service) => service.getDbRestoreStatus(tenant, restoreId))
  );

  #delegate<TResult>(
    tenant: TTenantContext,
    operation: (service: ResourceService) => unknown,
  ): Promise<TResult> {
    // The public oRPC contract validates and serializes the result. This cast is
    // the local adapter between readonly domain values and mutable Zod inference.
    return this.forTenant(tenant).then(operation) as Promise<TResult>;
  }
}

/**
 * Exposes two runtime object capabilities without leaking the owner pool or its
 * tenant resolver through either public API surface.
 */
function createResourceServiceCapabilities(
  pool: ResourceServicePool,
): TResourceServiceCapabilities {
  const resource: TResourceApiCapability = Object.freeze({
    listResources: pool.listResources,
    getResource: pool.getResource,
    createResource: pool.createResource,
    renameResource: pool.renameResource,
    deleteResource: pool.deleteResource,
    listResourceReferences: pool.listResourceReferences,
    listResourceData: pool.listResourceData,
    setResourceDataEntry: pool.setResourceDataEntry,
    deleteResourceDataEntry: pool.deleteResourceDataEntry,
    getDefinitionResourceStatus: pool.getDefinitionResourceStatus,
    bindResource: pool.bindResource,
    unbindResource: pool.unbindResource,
    dbResourceImpact: pool.dbResourceImpact,
    inspectDbResource: pool.inspectDbResource,
    executeDbLiveSql: pool.executeDbLiveSql,
    listDbRows: pool.listDbRows,
    getDbRow: pool.getDbRow,
    createDbRow: pool.createDbRow,
    updateDbRow: pool.updateDbRow,
    deleteDbRow: pool.deleteDbRow,
    bulkDbRows: pool.bulkDbRows,
    createDbDraft: pool.createDbDraft,
    listDbDrafts: pool.listDbDrafts,
    getDbDraft: pool.getDbDraft,
    getActiveDbDraft: pool.getActiveDbDraft,
    changeDbDraft: pool.changeDbDraft,
    executeDbDraftSql: pool.executeDbDraftSql,
    discardDbDraft: pool.discardDbDraft,
    previewDbApply: pool.previewDbApply,
    confirmDbApply: pool.confirmDbApply,
    getDbApply: pool.getDbApply,
    listDbApplies: pool.listDbApplies,
    getDbBackup: pool.getDbBackup,
    discardDbBackup: pool.discardDbBackup,
    previewDbBackupRestore: pool.previewDbBackupRestore,
    restoreDbBackup: pool.restoreDbBackup,
    getDbRestoreStatus: pool.getDbRestoreStatus,
  });
  const humanSecret: IHumanResourceSecretService = Object.freeze({
    revealSecret: pool.revealSecret,
  });
  return Object.freeze({ humanSecret, resource });
}

export { createResourceServiceCapabilities, ResourceServicePool };
export type { TResourceServiceCapabilities, TResourceServicePoolOptions };
