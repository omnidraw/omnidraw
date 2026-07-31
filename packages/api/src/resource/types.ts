import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import type { IHumanResourceSecretService as IRuntimeHumanResourceSecretService } from '@omnidraw/resource-runtime';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { resourceContract } from './contract';

type TResourceInputs = InferContractRouterInputs<typeof resourceContract>;
type TResourceOutputs = InferContractRouterOutputs<typeof resourceContract>;
type TResourceFilter = NonNullable<TResourceInputs['resources']['list']>;

export type TResourceApiCapability = {
  listResources(
    tenant: TTenantContext,
    filter: TResourceFilter,
  ): Promise<TResourceOutputs['resources']['list']>;
  getResource(
    tenant: TTenantContext,
    resourceId: TResourceInputs['resources']['get']['resourceId'],
  ): Promise<TResourceOutputs['resources']['get'] | null>;
  createResource(
    tenant: TTenantContext,
    input: TResourceInputs['resources']['create'],
  ): Promise<TResourceOutputs['resources']['create']>;
  renameResource(
    tenant: TTenantContext,
    args: {
      id: TResourceInputs['resources']['rename']['resourceId'];
      name: TResourceInputs['resources']['rename']['name'];
    },
  ): Promise<TResourceOutputs['resources']['rename']>;
  deleteResource(
    tenant: TTenantContext,
    resourceId: TResourceInputs['resources']['delete']['resourceId'],
  ): Promise<void>;
  listResourceReferences(
    tenant: TTenantContext,
    resourceId: TResourceInputs['resources']['references']['resourceId'],
  ): Promise<TResourceOutputs['resources']['references']>;
  listResourceData(
    tenant: TTenantContext,
    input: TResourceInputs['resources']['data'],
  ): Promise<TResourceOutputs['resources']['data']>;
  setResourceDataEntry(
    tenant: TTenantContext,
    input: TResourceInputs['resources']['dataSet'],
  ): Promise<TResourceOutputs['resources']['dataSet']>;
  deleteResourceDataEntry(
    tenant: TTenantContext,
    input: TResourceInputs['resources']['dataDelete'],
  ): Promise<TResourceOutputs['resources']['dataDelete']>;
  dbResourceImpact(
    tenant: TTenantContext,
    resourceId: TResourceInputs['dbResources']['impact']['resourceId'],
  ): Promise<TResourceOutputs['dbResources']['impact']>;
  inspectDbResource(
    tenant: TTenantContext,
    input: TResourceInputs['dbResources']['inspect'],
  ): Promise<TResourceOutputs['dbResources']['inspect']>;
  executeDbLiveSql(
    tenant: TTenantContext,
    input: TResourceInputs['dbResources']['executeSql'],
  ): Promise<TResourceOutputs['dbResources']['executeSql']>;
  listDbRows(
    tenant: TTenantContext,
    input: TResourceInputs['dbRows']['list'],
  ): Promise<TResourceOutputs['dbRows']['list']>;
  getDbRow(
    tenant: TTenantContext,
    input: TResourceInputs['dbRows']['get'],
  ): Promise<TResourceOutputs['dbRows']['get']>;
  createDbRow(
    tenant: TTenantContext,
    input: TResourceInputs['dbRows']['create'],
  ): Promise<TResourceOutputs['dbRows']['create']>;
  updateDbRow(
    tenant: TTenantContext,
    input: TResourceInputs['dbRows']['update'],
  ): Promise<TResourceOutputs['dbRows']['update']>;
  deleteDbRow(
    tenant: TTenantContext,
    input: TResourceInputs['dbRows']['delete'],
  ): Promise<TResourceOutputs['dbRows']['delete']>;
  bulkDbRows(
    tenant: TTenantContext,
    input: TResourceInputs['dbRows']['bulk'],
  ): Promise<TResourceOutputs['dbRows']['bulk']>;

  createDbDraft(
    tenant: TTenantContext,
    resourceId: TResourceInputs['dbDrafts']['create']['resourceId'],
    name: TResourceInputs['dbDrafts']['create']['name'],
  ): Promise<TResourceOutputs['dbDrafts']['create']>;
  listDbDrafts(
    tenant: TTenantContext,
    input: TResourceInputs['dbDrafts']['list'],
  ): Promise<TResourceOutputs['dbDrafts']['list']>;
  getDbDraft(
    tenant: TTenantContext,
    draftId: TResourceInputs['dbDrafts']['get']['draftId'],
  ): Promise<TResourceOutputs['dbDrafts']['get']>;
  getActiveDbDraft(
    tenant: TTenantContext,
    resourceId: TResourceInputs['dbDrafts']['active']['resourceId'],
  ): Promise<TResourceOutputs['dbDrafts']['active']>;
  changeDbDraft(
    tenant: TTenantContext,
    draftId: TResourceInputs['dbDrafts']['change']['draftId'],
    operation: TResourceInputs['dbDrafts']['change']['operation'],
  ): Promise<TResourceOutputs['dbDrafts']['change']>;
  executeDbDraftSql(
    tenant: TTenantContext,
    draftId: TResourceInputs['dbDrafts']['executeSql']['draftId'],
    sql: TResourceInputs['dbDrafts']['executeSql']['sql'],
  ): Promise<TResourceOutputs['dbDrafts']['executeSql']>;
  discardDbDraft(
    tenant: TTenantContext,
    draftId: TResourceInputs['dbDrafts']['discard']['draftId'],
  ): Promise<TResourceOutputs['dbDrafts']['discard']>;

  previewDbApply(
    tenant: TTenantContext,
    draftId: TResourceInputs['dbApplies']['preview']['draftId'],
  ): Promise<TResourceOutputs['dbApplies']['preview']>;
  confirmDbApply(
    tenant: TTenantContext,
    draftId: TResourceInputs['dbApplies']['confirm']['draftId'],
  ): Promise<TResourceOutputs['dbApplies']['confirm']>;
  getDbApply(
    tenant: TTenantContext,
    applyId: TResourceInputs['dbApplies']['get']['applyId'],
  ): Promise<TResourceOutputs['dbApplies']['get'] | null>;
  listDbApplies(
    tenant: TTenantContext,
    input: TResourceInputs['dbApplies']['list'],
  ): Promise<TResourceOutputs['dbApplies']['list']>;

  getDbBackup(
    tenant: TTenantContext,
    resourceId: TResourceInputs['dbBackups']['get']['resourceId'],
  ): Promise<TResourceOutputs['dbBackups']['get']>;
  discardDbBackup(
    tenant: TTenantContext,
    resourceId: TResourceInputs['dbBackups']['discard']['resourceId'],
    applyId: TResourceInputs['dbBackups']['discard']['applyId'],
  ): Promise<void>;
  previewDbBackupRestore(
    tenant: TTenantContext,
    resourceId: TResourceInputs['dbBackups']['previewRestore']['resourceId'],
    applyId: TResourceInputs['dbBackups']['previewRestore']['applyId'],
  ): Promise<TResourceOutputs['dbBackups']['previewRestore']>;
  restoreDbBackup(
    tenant: TTenantContext,
    resourceId: TResourceInputs['dbBackups']['restore']['resourceId'],
    applyId: TResourceInputs['dbBackups']['restore']['applyId'],
  ): Promise<TResourceOutputs['dbBackups']['restore']>;
  getDbRestoreStatus(
    tenant: TTenantContext,
    restoreId: TResourceInputs['dbBackups']['restoreStatus']['restoreId'],
  ): Promise<TResourceOutputs['dbBackups']['restoreStatus']>;
};

export type TResourceApiContext = {
  humanResourceSecret: IRuntimeHumanResourceSecretService;
  resource: TResourceApiCapability;
  tenant: TTenantContext;
};

export type { TResourceFilter, TResourceInputs, TResourceOutputs };
export type { IRuntimeHumanResourceSecretService as IHumanResourceSecretService };
