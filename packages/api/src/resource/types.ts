import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import type { IHumanResourceSecretService as IRuntimeHumanResourceSecretService } from '@omnidraw/resource-runtime';
import type { resourceContract } from './contract';

type TResourceInputs = InferContractRouterInputs<typeof resourceContract>;
type TResourceOutputs = InferContractRouterOutputs<typeof resourceContract>;
type TResourceFilter = NonNullable<TResourceInputs['resources']['list']>;

export type TResourceApiCapability = {
  listResources(
    filter: TResourceFilter,
  ): Promise<TResourceOutputs['resources']['list']>;
  getResource(
    resourceId: TResourceInputs['resources']['get']['resourceId'],
  ): Promise<TResourceOutputs['resources']['get'] | null>;
  createResource(
    input: TResourceInputs['resources']['create'],
  ): Promise<TResourceOutputs['resources']['create']>;
  renameResource(
    args: {
      id: TResourceInputs['resources']['rename']['resourceId'];
      name: TResourceInputs['resources']['rename']['name'];
    },
  ): Promise<TResourceOutputs['resources']['rename']>;
  deleteResource(
    resourceId: TResourceInputs['resources']['delete']['resourceId'],
  ): Promise<void>;
  listResourceData(
    input: TResourceInputs['resources']['data'],
  ): Promise<TResourceOutputs['resources']['data']>;
  setResourceDataEntry(
    input: TResourceInputs['resources']['dataSet'],
  ): Promise<TResourceOutputs['resources']['dataSet']>;
  deleteResourceDataEntry(
    input: TResourceInputs['resources']['dataDelete'],
  ): Promise<TResourceOutputs['resources']['dataDelete']>;
  dbResourceImpact(
    resourceId: TResourceInputs['dbResources']['impact']['resourceId'],
  ): Promise<TResourceOutputs['dbResources']['impact']>;
  inspectDbResource(
    input: TResourceInputs['dbResources']['inspect'],
  ): Promise<TResourceOutputs['dbResources']['inspect']>;
  executeDbLiveSql(
    input: TResourceInputs['dbResources']['executeSql'],
  ): Promise<TResourceOutputs['dbResources']['executeSql']>;
  listDbRows(
    input: TResourceInputs['dbRows']['list'],
  ): Promise<TResourceOutputs['dbRows']['list']>;
  getDbRow(
    input: TResourceInputs['dbRows']['get'],
  ): Promise<TResourceOutputs['dbRows']['get']>;
  createDbRow(
    input: TResourceInputs['dbRows']['create'],
  ): Promise<TResourceOutputs['dbRows']['create']>;
  updateDbRow(
    input: TResourceInputs['dbRows']['update'],
  ): Promise<TResourceOutputs['dbRows']['update']>;
  deleteDbRow(
    input: TResourceInputs['dbRows']['delete'],
  ): Promise<TResourceOutputs['dbRows']['delete']>;
  bulkDbRows(
    input: TResourceInputs['dbRows']['bulk'],
  ): Promise<TResourceOutputs['dbRows']['bulk']>;

  createDbDraft(
    resourceId: TResourceInputs['dbDrafts']['create']['resourceId'],
    name: TResourceInputs['dbDrafts']['create']['name'],
  ): Promise<TResourceOutputs['dbDrafts']['create']>;
  listDbDrafts(
    input: TResourceInputs['dbDrafts']['list'],
  ): Promise<TResourceOutputs['dbDrafts']['list']>;
  getDbDraft(
    draftId: TResourceInputs['dbDrafts']['get']['draftId'],
  ): Promise<TResourceOutputs['dbDrafts']['get']>;
  getActiveDbDraft(
    resourceId: TResourceInputs['dbDrafts']['active']['resourceId'],
  ): Promise<TResourceOutputs['dbDrafts']['active']>;
  changeDbDraft(
    draftId: TResourceInputs['dbDrafts']['change']['draftId'],
    operation: TResourceInputs['dbDrafts']['change']['operation'],
  ): Promise<TResourceOutputs['dbDrafts']['change']>;
  executeDbDraftSql(
    draftId: TResourceInputs['dbDrafts']['executeSql']['draftId'],
    sql: TResourceInputs['dbDrafts']['executeSql']['sql'],
  ): Promise<TResourceOutputs['dbDrafts']['executeSql']>;
  discardDbDraft(
    draftId: TResourceInputs['dbDrafts']['discard']['draftId'],
  ): Promise<TResourceOutputs['dbDrafts']['discard']>;

  previewDbApply(
    draftId: TResourceInputs['dbApplies']['preview']['draftId'],
  ): Promise<TResourceOutputs['dbApplies']['preview']>;
  confirmDbApply(
    draftId: TResourceInputs['dbApplies']['confirm']['draftId'],
  ): Promise<TResourceOutputs['dbApplies']['confirm']>;
  getDbApply(
    applyId: TResourceInputs['dbApplies']['get']['applyId'],
  ): Promise<TResourceOutputs['dbApplies']['get'] | null>;
  listDbApplies(
    input: TResourceInputs['dbApplies']['list'],
  ): Promise<TResourceOutputs['dbApplies']['list']>;

  getDbBackup(
    resourceId: TResourceInputs['dbBackups']['get']['resourceId'],
  ): Promise<TResourceOutputs['dbBackups']['get']>;
  discardDbBackup(
    resourceId: TResourceInputs['dbBackups']['discard']['resourceId'],
    applyId: TResourceInputs['dbBackups']['discard']['applyId'],
  ): Promise<void>;
  previewDbBackupRestore(
    resourceId: TResourceInputs['dbBackups']['previewRestore']['resourceId'],
    applyId: TResourceInputs['dbBackups']['previewRestore']['applyId'],
  ): Promise<TResourceOutputs['dbBackups']['previewRestore']>;
  restoreDbBackup(
    resourceId: TResourceInputs['dbBackups']['restore']['resourceId'],
    applyId: TResourceInputs['dbBackups']['restore']['applyId'],
  ): Promise<TResourceOutputs['dbBackups']['restore']>;
  getDbRestoreStatus(
    restoreId: TResourceInputs['dbBackups']['restoreStatus']['restoreId'],
  ): Promise<TResourceOutputs['dbBackups']['restoreStatus']>;
};

export type TResourceApiContext = {
  humanResourceSecret: IRuntimeHumanResourceSecretService;
  resource: TResourceApiCapability;
};

export type { TResourceFilter, TResourceInputs, TResourceOutputs };
export type { IRuntimeHumanResourceSecretService as IHumanResourceSecretService };
