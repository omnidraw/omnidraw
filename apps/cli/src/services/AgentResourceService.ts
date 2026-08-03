import type { TAgentResourceService } from '@omnidraw/service-agent';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { ResourceService } from './ResourceService';

type TCompleteAgentResourceService = {
  readonly [TKey in keyof TAgentResourceService]-?: NonNullable<TAgentResourceService[TKey]>;
};

/**
 * Binds one trusted tenant context to the narrow resource capability exposed to
 * agent tools. The physical resource service and its broader management surface
 * remain private to the CLI composition root.
 */
function createAgentResourceService(
  owner: ResourceService,
  tenant: TTenantContext,
): TAgentResourceService {
  const capability = {
    listResources: (filter) => (
      owner.listResources(tenant, filter) as ReturnType<
        TCompleteAgentResourceService['listResources']
      >
    ),
    getResource: (resourceId) => owner.getResource(tenant, resourceId),
    resolveResourceByName: (resourceName, options) => (
      owner.resolveResourceByName(tenant, resourceName, options)
    ),
    createResource: (request) => (
      owner.createResource(tenant, request) as ReturnType<
        TCompleteAgentResourceService['createResource']
      >
    ),
    renameResource: (request) => (
      owner.renameResource(tenant, request) as ReturnType<
        TCompleteAgentResourceService['renameResource']
      >
    ),
    deleteResource: (resourceId) => owner.deleteResource(tenant, resourceId),
    listResourceReferences: (resourceId) => owner.listResourceReferences(tenant, resourceId),
    countResourceData: (request) => owner.countResourceData(tenant, request),
    listResourceData: (request) => (
      owner.listResourceData(tenant, request) as ReturnType<
        TCompleteAgentResourceService['listResourceData']
      >
    ),
    getResourceDataEntry: (request) => owner.getResourceDataEntry(tenant, request),
    setResourceDataEntry: (request) => (
      owner.setResourceDataEntry(tenant, request) as ReturnType<
        TCompleteAgentResourceService['setResourceDataEntry']
      >
    ),
    deleteResourceDataEntry: (request) => owner.deleteResourceDataEntry(tenant, request),
    inspectDbResource: (request) => (
      owner.inspectDbResource(tenant, request) as ReturnType<
        TCompleteAgentResourceService['inspectDbResource']
      >
    ),
    executeDbLiveSql: (request) => (
      owner.executeDbLiveSql(tenant, request) as ReturnType<
        TCompleteAgentResourceService['executeDbLiveSql']
      >
    ),
    createDbDraft: (resourceId, name) => (
      owner.createDbDraft(tenant, resourceId, name) as ReturnType<
        TCompleteAgentResourceService['createDbDraft']
      >
    ),
    executeDbDraftSql: (draftId, sql, parameters) => (
      owner.executeDbDraftSql(tenant, draftId, sql, parameters) as ReturnType<
        TCompleteAgentResourceService['executeDbDraftSql']
      >
    ),
    discardDbDraft: (draftId) => (
      owner.discardDbDraft(tenant, draftId) as ReturnType<
        TCompleteAgentResourceService['discardDbDraft']
      >
    ),
    previewDbApply: (draftId) => (
      owner.previewDbApply(tenant, draftId) as ReturnType<
        TCompleteAgentResourceService['previewDbApply']
      >
    ),
    confirmDbApply: (draftId) => (
      owner.confirmDbApply(tenant, draftId) as ReturnType<
        TCompleteAgentResourceService['confirmDbApply']
      >
    ),
    getDbApply: async (applyId) => {
      const details = await owner.getDbApply(tenant, applyId);
      return { apply: details.apply };
    },
  } satisfies TCompleteAgentResourceService;

  return Object.freeze(capability);
}

export { createAgentResourceService };
