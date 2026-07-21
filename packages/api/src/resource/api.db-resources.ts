import { ORPCError } from '@orpc/contract';
import { baseActorsOs } from '../actor/orpc';
import { withActorResourceApiError } from './api.resource-error';

export const apiDbResourceImpact = baseActorsOs.dbResources.impact.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.dbResourceImpact(input.resourceId))
));

export const apiInspectDbResource = baseActorsOs.dbResources.inspect.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.inspectDbResource(input))
));

export const apiExecuteDbLiveSql = baseActorsOs.dbResources.executeSql.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.executeDbLiveSql(input))
));

export const apiListDbRows = baseActorsOs.dbRows.list.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.listDbRows(input))
));

export const apiGetDbRow = baseActorsOs.dbRows.get.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.getDbRow(input))
));

export const apiCreateDbRow = baseActorsOs.dbRows.create.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.createDbRow(input))
));

export const apiUpdateDbRow = baseActorsOs.dbRows.update.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.updateDbRow(input))
));

export const apiDeleteDbRow = baseActorsOs.dbRows.delete.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.deleteDbRow(input))
));

export const apiBulkDbRows = baseActorsOs.dbRows.bulk.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.bulkDbRows(input))
));

export const apiCreateDbDraft = baseActorsOs.dbDrafts.create.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.createDbDraft(input.resourceId, input.name))
));

export const apiListDbDrafts = baseActorsOs.dbDrafts.list.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.listDbDrafts(input))
));

export const apiGetDbDraft = baseActorsOs.dbDrafts.get.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.getDbDraft(input.draftId))
));

export const apiGetActiveDbDraft = baseActorsOs.dbDrafts.active.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.getActiveDbDraft(input.resourceId))
));

export const apiInspectDbDraft = baseActorsOs.dbDrafts.inspect.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.inspectDbResource({ ...input, target: 'draft' }))
));

export const apiChangeDbDraft = baseActorsOs.dbDrafts.change.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.changeDbDraft(input.draftId, input.operation))
));

export const apiExecuteDbDraftSql = baseActorsOs.dbDrafts.executeSql.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.executeDbDraftSql(input.draftId, input.sql))
));

export const apiDiscardDbDraft = baseActorsOs.dbDrafts.discard.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.discardDbDraft(input.draftId))
));

export const apiPreviewDbApply = baseActorsOs.dbApplies.preview.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.previewDbApply(input.draftId))
));

export const apiConfirmDbApply = baseActorsOs.dbApplies.confirm.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.confirmDbApply(input.draftId))
));

export const apiGetDbApply = baseActorsOs.dbApplies.get.handler(async ({ input, context }) => {
  const result = await withActorResourceApiError(() => context.actor.getDbApply(input.applyId));
  if (!result) throw new ORPCError('NOT_FOUND');
  return result;
});

export const apiListDbApplies = baseActorsOs.dbApplies.list.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.listDbApplies(input))
));

export const apiGetDbBackup = baseActorsOs.dbBackups.get.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.getDbBackup(input.resourceId))
));

export const apiDiscardDbBackup = baseActorsOs.dbBackups.discard.handler(async ({ input, context }) => {
  await withActorResourceApiError(() => context.actor.discardDbBackup(input.resourceId, input.applyId));
  return { discarded: true };
});

export const apiPreviewDbBackupRestore = baseActorsOs.dbBackups.previewRestore.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.previewDbBackupRestore(input.resourceId, input.applyId))
));

export const apiRestoreDbBackup = baseActorsOs.dbBackups.restore.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.restoreDbBackup(input.resourceId, input.applyId))
));

export const apiGetDbRestoreStatus = baseActorsOs.dbBackups.restoreStatus.handler(({ input, context }) => (
  withActorResourceApiError(() => context.actor.getDbRestoreStatus(input.restoreId))
));
