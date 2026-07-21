import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TAgentEvent } from '../agent/contract';
import type { TActorDatabaseCapability } from '../interface';
import type { actorsContract, TActorEvent } from './contract';

type TActorInputs = InferContractRouterInputs<typeof actorsContract>;
type TActorOutputs = InferContractRouterOutputs<typeof actorsContract>;
type TActorResourceFilter = NonNullable<TActorInputs['resources']['list']>;

export type TActorApiCapability = {
  deleteDefinition(name: TActorInputs['definitions']['delete']['name']): Promise<boolean>;
  getVibecanvasJson(definitionName: string): TVibecanvasJson | null;
  getWidgetCode(definitionName: string): Promise<TActorOutputs['definitions']['get']['widgetCode'] | null>;
  sendMessage(
    instanceId: TActorInputs['instances']['sendMessage']['instanceId'],
    name: TActorInputs['instances']['sendMessage']['name'],
    payload: TActorInputs['instances']['sendMessage']['payload'],
  ): Promise<TActorOutputs['instances']['sendMessage']['messageId']>;

  listResources(filter: TActorResourceFilter): Promise<TActorOutputs['resources']['list']>;
  getResource(resourceId: TActorInputs['resources']['get']['resourceId']): Promise<TActorOutputs['resources']['get'] | null>;
  createResource(input: TActorInputs['resources']['create']): Promise<TActorOutputs['resources']['create']>;
  renameResource(args: {
    id: TActorInputs['resources']['rename']['resourceId'];
    name: TActorInputs['resources']['rename']['name'];
  }): Promise<TActorOutputs['resources']['rename']>;
  deleteResource(resourceId: TActorInputs['resources']['delete']['resourceId']): Promise<void>;
  listResourceReferences(
    resourceId: TActorInputs['resources']['references']['resourceId'],
  ): Promise<TActorOutputs['resources']['references']>;
  listResourceData(input: TActorInputs['resources']['data']): Promise<TActorOutputs['resources']['data']>;
  setResourceDataEntry(input: TActorInputs['resources']['dataSet']): Promise<TActorOutputs['resources']['dataSet']>;
  deleteResourceDataEntry(
    input: TActorInputs['resources']['dataDelete'],
  ): Promise<TActorOutputs['resources']['dataDelete']>;
  revealResourceSecret(
    input: TActorInputs['resources']['dataRevealSecret'],
  ): Promise<TActorOutputs['resources']['dataRevealSecret']>;
  getDefinitionResourceStatus(
    definitionName: TActorInputs['resources']['definitionStatus']['definitionName'],
  ): Promise<TActorOutputs['resources']['definitionStatus']>;
  bindResource(input: TActorInputs['resources']['bind']): Promise<TActorOutputs['resources']['bind']>;
  unbindResource(input: TActorInputs['resources']['unbind']): Promise<TActorOutputs['resources']['unbind']['deleted']>;

  dbResourceImpact(
    resourceId: TActorInputs['dbResources']['impact']['resourceId'],
  ): Promise<TActorOutputs['dbResources']['impact']>;
  inspectDbResource(input: TActorInputs['dbResources']['inspect']): Promise<TActorOutputs['dbResources']['inspect']>;
  executeDbLiveSql(input: TActorInputs['dbResources']['executeSql']): Promise<TActorOutputs['dbResources']['executeSql']>;
  listDbRows(input: TActorInputs['dbRows']['list']): Promise<TActorOutputs['dbRows']['list']>;
  getDbRow(input: TActorInputs['dbRows']['get']): Promise<TActorOutputs['dbRows']['get']>;
  createDbRow(input: TActorInputs['dbRows']['create']): Promise<TActorOutputs['dbRows']['create']>;
  updateDbRow(input: TActorInputs['dbRows']['update']): Promise<TActorOutputs['dbRows']['update']>;
  deleteDbRow(input: TActorInputs['dbRows']['delete']): Promise<TActorOutputs['dbRows']['delete']>;
  bulkDbRows(input: TActorInputs['dbRows']['bulk']): Promise<TActorOutputs['dbRows']['bulk']>;

  createDbDraft(
    resourceId: TActorInputs['dbDrafts']['create']['resourceId'],
    name: TActorInputs['dbDrafts']['create']['name'],
  ): Promise<TActorOutputs['dbDrafts']['create']>;
  listDbDrafts(input: TActorInputs['dbDrafts']['list']): Promise<TActorOutputs['dbDrafts']['list']>;
  getDbDraft(draftId: TActorInputs['dbDrafts']['get']['draftId']): Promise<TActorOutputs['dbDrafts']['get']>;
  getActiveDbDraft(
    resourceId: TActorInputs['dbDrafts']['active']['resourceId'],
  ): Promise<TActorOutputs['dbDrafts']['active']>;
  changeDbDraft(
    draftId: TActorInputs['dbDrafts']['change']['draftId'],
    operation: TActorInputs['dbDrafts']['change']['operation'],
  ): Promise<TActorOutputs['dbDrafts']['change']>;
  executeDbDraftSql(
    draftId: TActorInputs['dbDrafts']['executeSql']['draftId'],
    sql: TActorInputs['dbDrafts']['executeSql']['sql'],
  ): Promise<TActorOutputs['dbDrafts']['executeSql']>;
  discardDbDraft(
    draftId: TActorInputs['dbDrafts']['discard']['draftId'],
  ): Promise<TActorOutputs['dbDrafts']['discard']>;

  previewDbApply(
    draftId: TActorInputs['dbApplies']['preview']['draftId'],
  ): Promise<TActorOutputs['dbApplies']['preview']>;
  confirmDbApply(
    draftId: TActorInputs['dbApplies']['confirm']['draftId'],
  ): Promise<TActorOutputs['dbApplies']['confirm']>;
  getDbApply(applyId: TActorInputs['dbApplies']['get']['applyId']): Promise<TActorOutputs['dbApplies']['get']>;
  listDbApplies(input: TActorInputs['dbApplies']['list']): Promise<TActorOutputs['dbApplies']['list']>;

  getDbBackup(
    resourceId: TActorInputs['dbBackups']['get']['resourceId'],
  ): Promise<TActorOutputs['dbBackups']['get']>;
  discardDbBackup(
    resourceId: TActorInputs['dbBackups']['discard']['resourceId'],
    applyId: TActorInputs['dbBackups']['discard']['applyId'],
  ): Promise<void>;
  previewDbBackupRestore(
    resourceId: TActorInputs['dbBackups']['previewRestore']['resourceId'],
    applyId: TActorInputs['dbBackups']['previewRestore']['applyId'],
  ): Promise<TActorOutputs['dbBackups']['previewRestore']>;
  restoreDbBackup(
    resourceId: TActorInputs['dbBackups']['restore']['resourceId'],
    applyId: TActorInputs['dbBackups']['restore']['applyId'],
  ): Promise<TActorOutputs['dbBackups']['restore']>;
  getDbRestoreStatus(
    restoreId: TActorInputs['dbBackups']['restoreStatus']['restoreId'],
  ): Promise<TActorOutputs['dbBackups']['restoreStatus']>;
};

export type TActorEventCapability = {
  publishAgentEvent(event: TAgentEvent): void;
  subscribeActorEvents(): AsyncIterable<TActorEvent>;
};

export type TActorsApiContext = {
  db: TActorDatabaseCapability;
  eventPublisher: TActorEventCapability;
  actor: TActorApiCapability;
  accountId?: string;
  requestId?: string;
};
