import { ProcedureError } from '../procedure';
import { withResourceApiError } from './api.resource-error';
import { baseResourceOs } from './procedure-builder';

export const apiDbResourceImpact = baseResourceOs.dbResources.impact.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.dbResourceImpact(input.resourceId))
));

export const apiInspectDbResource = baseResourceOs.dbResources.inspect.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.inspectDbResource(input))
));

export const apiExecuteDbLiveSql = baseResourceOs.dbResources.executeSql.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.executeDbLiveSql(input))
));

export const apiListDbRows = baseResourceOs.dbRows.list.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.listDbRows(input))
));

export const apiGetDbRow = baseResourceOs.dbRows.get.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbRow(input))
));

export const apiCreateDbRow = baseResourceOs.dbRows.create.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.createDbRow(input))
));

export const apiUpdateDbRow = baseResourceOs.dbRows.update.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.updateDbRow(input))
));

export const apiDeleteDbRow = baseResourceOs.dbRows.delete.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.deleteDbRow(input))
));

export const apiBulkDbRows = baseResourceOs.dbRows.bulk.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.bulkDbRows(input))
));

export const apiCreateDbDraft = baseResourceOs.dbDrafts.create.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.createDbDraft(input.resourceId, input.name))
));

export const apiListDbDrafts = baseResourceOs.dbDrafts.list.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.listDbDrafts(input))
));

export const apiGetDbDraft = baseResourceOs.dbDrafts.get.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbDraft(input.draftId))
));

export const apiGetActiveDbDraft = baseResourceOs.dbDrafts.active.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getActiveDbDraft(input.resourceId))
));

export const apiInspectDbDraft = baseResourceOs.dbDrafts.inspect.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.inspectDbResource({ ...input, target: 'draft' }))
));

export const apiChangeDbDraft = baseResourceOs.dbDrafts.change.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.changeDbDraft(input.draftId, input.operation))
));

export const apiExecuteDbDraftSql = baseResourceOs.dbDrafts.executeSql.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.executeDbDraftSql(input.draftId, input.sql))
));

export const apiDiscardDbDraft = baseResourceOs.dbDrafts.discard.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.discardDbDraft(input.draftId))
));

export const apiPreviewDbApply = baseResourceOs.dbApplies.preview.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.previewDbApply(input.draftId))
));

export const apiConfirmDbApply = baseResourceOs.dbApplies.confirm.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.confirmDbApply(input.draftId))
));

export const apiGetDbApply = baseResourceOs.dbApplies.get.handler(async ({ input, context }) => {
  const result = await withResourceApiError(() => context.resource.getDbApply(input.applyId));
  if (!result) throw new ProcedureError('NOT_FOUND');
  return result;
});

export const apiListDbApplies = baseResourceOs.dbApplies.list.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.listDbApplies(input))
));

export const apiGetDbBackup = baseResourceOs.dbBackups.get.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbBackup(input.resourceId))
));

export const apiDiscardDbBackup = baseResourceOs.dbBackups.discard.handler(async ({ input, context }) => {
  await withResourceApiError(() => context.resource.discardDbBackup(input.resourceId, input.applyId));
  return { discarded: true };
});

export const apiPreviewDbBackupRestore = baseResourceOs.dbBackups.previewRestore.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.previewDbBackupRestore(input.resourceId, input.applyId))
));

export const apiRestoreDbBackup = baseResourceOs.dbBackups.restore.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.restoreDbBackup(input.resourceId, input.applyId))
));

export const apiGetDbRestoreStatus = baseResourceOs.dbBackups.restoreStatus.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbRestoreStatus(input.restoreId))
));
