import { ORPCError } from '@orpc/contract';
import { withResourceApiError } from './api.resource-error';
import { baseResourceOs } from './orpc';

export const apiDbResourceImpact = baseResourceOs.dbResources.impact.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.dbResourceImpact(context.tenant, input.resourceId))
));

export const apiInspectDbResource = baseResourceOs.dbResources.inspect.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.inspectDbResource(context.tenant, input))
));

export const apiExecuteDbLiveSql = baseResourceOs.dbResources.executeSql.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.executeDbLiveSql(context.tenant, input))
));

export const apiListDbRows = baseResourceOs.dbRows.list.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.listDbRows(context.tenant, input))
));

export const apiGetDbRow = baseResourceOs.dbRows.get.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbRow(context.tenant, input))
));

export const apiCreateDbRow = baseResourceOs.dbRows.create.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.createDbRow(context.tenant, input))
));

export const apiUpdateDbRow = baseResourceOs.dbRows.update.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.updateDbRow(context.tenant, input))
));

export const apiDeleteDbRow = baseResourceOs.dbRows.delete.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.deleteDbRow(context.tenant, input))
));

export const apiBulkDbRows = baseResourceOs.dbRows.bulk.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.bulkDbRows(context.tenant, input))
));

export const apiCreateDbDraft = baseResourceOs.dbDrafts.create.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.createDbDraft(context.tenant, input.resourceId, input.name))
));

export const apiListDbDrafts = baseResourceOs.dbDrafts.list.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.listDbDrafts(context.tenant, input))
));

export const apiGetDbDraft = baseResourceOs.dbDrafts.get.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbDraft(context.tenant, input.draftId))
));

export const apiGetActiveDbDraft = baseResourceOs.dbDrafts.active.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getActiveDbDraft(context.tenant, input.resourceId))
));

export const apiInspectDbDraft = baseResourceOs.dbDrafts.inspect.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.inspectDbResource(context.tenant, { ...input, target: 'draft' }))
));

export const apiChangeDbDraft = baseResourceOs.dbDrafts.change.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.changeDbDraft(context.tenant, input.draftId, input.operation))
));

export const apiExecuteDbDraftSql = baseResourceOs.dbDrafts.executeSql.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.executeDbDraftSql(context.tenant, input.draftId, input.sql))
));

export const apiDiscardDbDraft = baseResourceOs.dbDrafts.discard.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.discardDbDraft(context.tenant, input.draftId))
));

export const apiPreviewDbApply = baseResourceOs.dbApplies.preview.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.previewDbApply(context.tenant, input.draftId))
));

export const apiConfirmDbApply = baseResourceOs.dbApplies.confirm.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.confirmDbApply(context.tenant, input.draftId))
));

export const apiGetDbApply = baseResourceOs.dbApplies.get.handler(async ({ input, context }) => {
  const result = await withResourceApiError(() => context.resource.getDbApply(context.tenant, input.applyId));
  if (!result) throw new ORPCError('NOT_FOUND');
  return result;
});

export const apiListDbApplies = baseResourceOs.dbApplies.list.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.listDbApplies(context.tenant, input))
));

export const apiGetDbBackup = baseResourceOs.dbBackups.get.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbBackup(context.tenant, input.resourceId))
));

export const apiDiscardDbBackup = baseResourceOs.dbBackups.discard.handler(async ({ input, context }) => {
  await withResourceApiError(() => context.resource.discardDbBackup(context.tenant, input.resourceId, input.applyId));
  return { discarded: true };
});

export const apiPreviewDbBackupRestore = baseResourceOs.dbBackups.previewRestore.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.previewDbBackupRestore(context.tenant, input.resourceId, input.applyId))
));

export const apiRestoreDbBackup = baseResourceOs.dbBackups.restore.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.restoreDbBackup(context.tenant, input.resourceId, input.applyId))
));

export const apiGetDbRestoreStatus = baseResourceOs.dbBackups.restoreStatus.handler(({ input, context }) => (
  withResourceApiError(() => context.resource.getDbRestoreStatus(context.tenant, input.restoreId))
));
