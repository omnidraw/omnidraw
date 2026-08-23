import type { TAgentResourceService } from '#backend/shell/agent';
import type { ResourceService } from '../resources/ResourceService';

type TCompleteAgentResourceService = {
  readonly [TKey in keyof TAgentResourceService]-?: NonNullable<TAgentResourceService[TKey]>;
};

/**
 * Binds the singleton resource service to the narrow capability exposed to
 * agent tools. The broader management surface remains private to the CLI
 * composition root.
 */
function createAgentResourceService(
  owner: ResourceService,
): TAgentResourceService {
  const capability = {
    listResources: (filter) => (
      owner.listResources(filter) as ReturnType<
        TCompleteAgentResourceService['listResources']
      >
    ),
    getResource: (resourceId) => owner.getResource(resourceId),
    resolveResourceByName: (resourceName, options) => (
      owner.resolveResourceByName(resourceName, options)
    ),
    createResource: (request) => (
      owner.createResource(request) as ReturnType<
        TCompleteAgentResourceService['createResource']
      >
    ),
    renameResource: (request) => (
      owner.renameResource(request) as ReturnType<
        TCompleteAgentResourceService['renameResource']
      >
    ),
    deleteResource: (resourceId) => owner.deleteResource(resourceId),
    countResourceData: (request) => owner.countResourceData(request),
    listResourceData: (request) => (
      owner.listResourceData(request) as ReturnType<
        TCompleteAgentResourceService['listResourceData']
      >
    ),
    getResourceDataEntry: (request) => owner.getResourceDataEntry(request),
    setResourceDataEntry: (request) => (
      owner.setResourceDataEntry(request) as ReturnType<
        TCompleteAgentResourceService['setResourceDataEntry']
      >
    ),
    deleteResourceDataEntry: (request) => owner.deleteResourceDataEntry(request),
    inspectDbResource: (request) => (
      owner.inspectDbResource(request) as ReturnType<
        TCompleteAgentResourceService['inspectDbResource']
      >
    ),
    executeDbLiveSql: (request) => (
      owner.executeDbLiveSql(request) as ReturnType<
        TCompleteAgentResourceService['executeDbLiveSql']
      >
    ),
    createDbDraft: (resourceId, name) => (
      owner.createDbDraft(resourceId, name) as ReturnType<
        TCompleteAgentResourceService['createDbDraft']
      >
    ),
    executeDbDraftSql: (draftId, sql, parameters) => (
      owner.executeDbDraftSql(draftId, sql, parameters) as ReturnType<
        TCompleteAgentResourceService['executeDbDraftSql']
      >
    ),
    discardDbDraft: (draftId) => (
      owner.discardDbDraft(draftId) as ReturnType<
        TCompleteAgentResourceService['discardDbDraft']
      >
    ),
    previewDbApply: (draftId) => (
      owner.previewDbApply(draftId) as ReturnType<
        TCompleteAgentResourceService['previewDbApply']
      >
    ),
    confirmDbApply: (draftId) => (
      owner.confirmDbApply(draftId) as ReturnType<
        TCompleteAgentResourceService['confirmDbApply']
      >
    ),
    getDbApply: async (applyId) => {
      const details = await owner.getDbApply(applyId);
      return { apply: details.apply };
    },
  } satisfies TCompleteAgentResourceService;

  return Object.freeze(capability);
}

export { createAgentResourceService };
