import type { IActorResourceService } from '@vibecanvas/service-actor';
import type { TResourceJson } from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { ResourceService } from './ResourceService';

/** Account/request-scoped compatibility facade over one placement-owned store. */
class TenantResourceService implements IActorResourceService {
  readonly #owner: ResourceService;
  readonly #tenant: TTenantContext;

  constructor(owner: ResourceService, tenant: TTenantContext) {
    this.#owner = owner;
    this.#tenant = tenant;
  }

  attachConsumer: NonNullable<IActorResourceService['attachConsumer']> = (consumer) => (
    this.#owner.attachConsumer(consumer)
  );

  listResources: IActorResourceService['listResources'] = (filter) => (
    this.#owner.listResources(this.#tenant, filter)
  );
  getResource: IActorResourceService['getResource'] = (id) => this.#owner.getResource(this.#tenant, id);
  resolveResourceByName: IActorResourceService['resolveResourceByName'] = (name, options) => (
    this.#owner.resolveResourceByName(this.#tenant, name, options)
  );
  createResource: IActorResourceService['createResource'] = (args) => (
    this.#owner.createResource(this.#tenant, args)
  );
  renameResource: IActorResourceService['renameResource'] = (args) => (
    this.#owner.renameResource(this.#tenant, args)
  );
  deleteResource: IActorResourceService['deleteResource'] = (id) => (
    this.#owner.deleteResource(this.#tenant, id)
  );
  listResourceReferences: IActorResourceService['listResourceReferences'] = (resourceId) => (
    this.#owner.listResourceReferences(this.#tenant, resourceId)
  );
  listResourceBindingsForDefinition: IActorResourceService['listResourceBindingsForDefinition'] = (name) => (
    this.#owner.listResourceBindingsForDefinition(this.#tenant, name)
  );
  getDefinitionResourceStatus: IActorResourceService['getDefinitionResourceStatus'] = (name) => (
    this.#owner.getDefinitionResourceStatus(this.#tenant, name)
  );
  bindResource: IActorResourceService['bindResource'] = (args) => this.#owner.bindResource(this.#tenant, args);
  unbindResource: IActorResourceService['unbindResource'] = (args) => this.#owner.unbindResource(this.#tenant, args);
  replaceResourceBindings: IActorResourceService['replaceResourceBindings'] = (args) => (
    this.#owner.replaceResourceBindings(this.#tenant, args)
  );
  transitionResourceBindings: IActorResourceService['transitionResourceBindings'] = (args, beforeReplace) => (
    this.#owner.transitionResourceBindings(this.#tenant, args, beforeReplace)
  );
  getActorStartAdmission: IActorResourceService['getActorStartAdmission'] = (args) => (
    this.#owner.getActorStartAdmission(this.#tenant, args)
  );
  completeActorStart: IActorResourceService['completeActorStart'] = (args) => (
    this.#owner.completeActorStart(this.#tenant, args)
  );
  call: IActorResourceService['call'] = (call) => this.#owner.call(this.#tenant, call);
  callWithDirectBinding: IActorResourceService['callWithDirectBinding'] = (call, binding) => (
    this.#owner.callWithDirectBinding(this.#tenant, call, binding)
  );
  callWithDirectResourceBinding: IActorResourceService['callWithDirectResourceBinding'] = (call, binding) => (
    this.#owner.callWithDirectResourceBinding(this.#tenant, call, binding)
  );
  withReadyResource: IActorResourceService['withReadyResource'] = (resourceId, operation) => (
    this.#owner.withReadyResource(this.#tenant, resourceId, operation)
  );

  countResourceData: IActorResourceService['countResourceData'] = (args) => (
    this.#owner.countResourceData(this.#tenant, args)
  );
  listResourceData: IActorResourceService['listResourceData'] = (args) => (
    this.#owner.listResourceData(this.#tenant, args) as ReturnType<IActorResourceService['listResourceData']>
  );
  getResourceDataEntry: IActorResourceService['getResourceDataEntry'] = (args) => (
    this.#owner.getResourceDataEntry(this.#tenant, args)
  );
  setResourceDataEntry: IActorResourceService['setResourceDataEntry'] = (args) => (
    this.#owner.setResourceDataEntry(this.#tenant, {
      ...args,
      value: args.value as TResourceJson,
    }) as ReturnType<IActorResourceService['setResourceDataEntry']>
  );
  deleteResourceDataEntry: IActorResourceService['deleteResourceDataEntry'] = (args) => (
    this.#owner.deleteResourceDataEntry(this.#tenant, args)
  );
  dbResourceImpact: IActorResourceService['dbResourceImpact'] = (resourceId) => (
    this.#owner.dbResourceImpact(this.#tenant, resourceId) as ReturnType<IActorResourceService['dbResourceImpact']>
  );
  inspectDbResource: IActorResourceService['inspectDbResource'] = (args) => (
    this.#owner.inspectDbResource(this.#tenant, args) as ReturnType<IActorResourceService['inspectDbResource']>
  );
  executeDbLiveSql: IActorResourceService['executeDbLiveSql'] = (args) => (
    this.#owner.executeDbLiveSql(this.#tenant, args) as ReturnType<IActorResourceService['executeDbLiveSql']>
  );
  listDbRows: IActorResourceService['listDbRows'] = (args) => (
    this.#owner.listDbRows(this.#tenant, args) as ReturnType<IActorResourceService['listDbRows']>
  );
  getDbRow: IActorResourceService['getDbRow'] = (args) => (
    this.#owner.getDbRow(this.#tenant, args) as ReturnType<IActorResourceService['getDbRow']>
  );
  createDbRow: IActorResourceService['createDbRow'] = (args) => (
    this.#owner.createDbRow(this.#tenant, args) as ReturnType<IActorResourceService['createDbRow']>
  );
  updateDbRow: IActorResourceService['updateDbRow'] = (args) => (
    this.#owner.updateDbRow(this.#tenant, args) as ReturnType<IActorResourceService['updateDbRow']>
  );
  deleteDbRow: IActorResourceService['deleteDbRow'] = (args) => (
    this.#owner.deleteDbRow(this.#tenant, args) as ReturnType<IActorResourceService['deleteDbRow']>
  );
  bulkDbRows: IActorResourceService['bulkDbRows'] = (args) => (
    this.#owner.bulkDbRows(this.#tenant, args) as ReturnType<IActorResourceService['bulkDbRows']>
  );
  createDbDraft: IActorResourceService['createDbDraft'] = (resourceId, name) => (
    this.#owner.createDbDraft(this.#tenant, resourceId, name) as ReturnType<IActorResourceService['createDbDraft']>
  );
  listDbDrafts: IActorResourceService['listDbDrafts'] = (args) => (
    this.#owner.listDbDrafts(this.#tenant, args) as ReturnType<IActorResourceService['listDbDrafts']>
  );
  getDbDraft: IActorResourceService['getDbDraft'] = (draftId) => (
    this.#owner.getDbDraft(this.#tenant, draftId) as ReturnType<IActorResourceService['getDbDraft']>
  );
  getActiveDbDraft: IActorResourceService['getActiveDbDraft'] = (resourceId) => (
    this.#owner.getActiveDbDraft(this.#tenant, resourceId) as ReturnType<IActorResourceService['getActiveDbDraft']>
  );
  changeDbDraft: IActorResourceService['changeDbDraft'] = (draftId, operation) => (
    this.#owner.changeDbDraft(this.#tenant, draftId, operation) as ReturnType<IActorResourceService['changeDbDraft']>
  );
  executeDbDraftSql: IActorResourceService['executeDbDraftSql'] = (draftId, sql, parameters) => (
    this.#owner.executeDbDraftSql(this.#tenant, draftId, sql, parameters) as ReturnType<IActorResourceService['executeDbDraftSql']>
  );
  discardDbDraft: IActorResourceService['discardDbDraft'] = (draftId) => (
    this.#owner.discardDbDraft(this.#tenant, draftId) as ReturnType<IActorResourceService['discardDbDraft']>
  );
  previewDbApply: IActorResourceService['previewDbApply'] = (draftId) => (
    this.#owner.previewDbApply(this.#tenant, draftId) as ReturnType<IActorResourceService['previewDbApply']>
  );
  confirmDbApply: IActorResourceService['confirmDbApply'] = (draftId) => (
    this.#owner.confirmDbApply(this.#tenant, draftId) as ReturnType<IActorResourceService['confirmDbApply']>
  );
  getDbApply: IActorResourceService['getDbApply'] = (applyId) => (
    this.#owner.getDbApply(this.#tenant, applyId) as ReturnType<IActorResourceService['getDbApply']>
  );
  listDbApplies: IActorResourceService['listDbApplies'] = (args) => (
    this.#owner.listDbApplies(this.#tenant, args) as ReturnType<IActorResourceService['listDbApplies']>
  );
  getDbBackup: IActorResourceService['getDbBackup'] = (resourceId) => (
    this.#owner.getDbBackup(this.#tenant, resourceId) as ReturnType<IActorResourceService['getDbBackup']>
  );
  discardDbBackup: IActorResourceService['discardDbBackup'] = (resourceId, applyId) => (
    this.#owner.discardDbBackup(this.#tenant, resourceId, applyId) as ReturnType<IActorResourceService['discardDbBackup']>
  );
  previewDbBackupRestore: IActorResourceService['previewDbBackupRestore'] = (resourceId, applyId) => (
    this.#owner.previewDbBackupRestore(this.#tenant, resourceId, applyId) as ReturnType<IActorResourceService['previewDbBackupRestore']>
  );
  restoreDbBackup: IActorResourceService['restoreDbBackup'] = (resourceId, applyId) => (
    this.#owner.restoreDbBackup(this.#tenant, resourceId, applyId) as ReturnType<IActorResourceService['restoreDbBackup']>
  );
  getDbRestoreStatus: IActorResourceService['getDbRestoreStatus'] = (restoreId) => (
    this.#owner.getDbRestoreStatus(this.#tenant, restoreId) as ReturnType<IActorResourceService['getDbRestoreStatus']>
  );
}

export { TenantResourceService };
