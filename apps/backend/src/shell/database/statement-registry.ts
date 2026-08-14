/** Static, exhaustive production SQL statement registry. */
import canvasItemDeleteCanvasItemsSql from '../../shell/database/stmts/canvas-item-delete-canvas-items.sql' with { type: 'text' };
import canvasItemInsertCanvasItemsSql from '../../shell/database/stmts/canvas-item-insert-canvas-items.sql' with { type: 'text' };
import canvasItemInsertKeyValuesSql from '../../shell/database/stmts/canvas-item-insert-key-values.sql' with { type: 'text' };
import canvasItemReadCanvasesSql from '../../shell/database/stmts/canvas-item-read-canvases.sql' with { type: 'text' };
import canvasItemReadKeyValuesSql from '../../shell/database/stmts/canvas-item-read-key-values.sql' with { type: 'text' };
import canvasItemUpdateCanvasItemsSql from '../../shell/database/stmts/canvas-item-update-canvas-items.sql' with { type: 'text' };
import canvasItemUpdateCanvasesSql from '../../shell/database/stmts/canvas-item-update-canvases.sql' with { type: 'text' };
import canvasListSql from '../../shell/database/stmts/canvas-list.sql' with { type: 'text' };
import canvasReadByNameSql from '../../shell/database/stmts/canvas-read-by-name.sql' with { type: 'text' };
import canvasReadByIdSql from '../../shell/database/stmts/canvas-read-by-id.sql' with { type: 'text' };
import canvasDeleteSql from '../../shell/database/stmts/canvas-delete.sql' with { type: 'text' };
import canvasDeletionCountItemsSql from '../../shell/database/stmts/canvas-deletion-count-items.sql' with { type: 'text' };
import canvasDeletionCountMediaSql from '../../shell/database/stmts/canvas-deletion-count-media.sql' with { type: 'text' };
import canvasDeletionCountChatsSql from '../../shell/database/stmts/canvas-deletion-count-chats.sql' with { type: 'text' };
import canvasInsertSql from '../../shell/database/stmts/canvas-insert.sql' with { type: 'text' };
import canvasUpdateNameSql from '../../shell/database/stmts/canvas-update-name.sql' with { type: 'text' };
import chatInsertChatsSql from '../../shell/database/stmts/chat-insert-chats.sql' with { type: 'text' };
import chatReadChatsSql from '../../shell/database/stmts/chat-read-chats.sql' with { type: 'text' };
import databaseCheckReadPragmaIntegrityCheckSql from '../../shell/database/stmts/database-check-read-pragma-integrity-check.sql' with { type: 'text' };
import databaseCheckReadPragmaQuickCheckSql from '../../shell/database/stmts/database-check-read-pragma-quick-check.sql' with { type: 'text' };
import dbResourceReadApplyRunSql from '../../shell/database/stmts/db-resource-read-apply-run.sql' with { type: 'text' };
import dbResourceListDraftChangesSql from '../../shell/database/stmts/db-resource-list-draft-changes.sql' with { type: 'text' };
import dbResourceReadDraftSql from '../../shell/database/stmts/db-resource-read-draft.sql' with { type: 'text' };
import dbResourceReadActiveDraftSql from '../../shell/database/stmts/db-resource-read-active-draft.sql' with { type: 'text' };
import dbResourceInsertApplyRunSql from '../../shell/database/stmts/db-resource-insert-apply-run.sql' with { type: 'text' };
import dbResourceInsertDraftChangeSql from '../../shell/database/stmts/db-resource-insert-draft-change.sql' with { type: 'text' };
import dbResourceInsertDraftSql from '../../shell/database/stmts/db-resource-insert-draft.sql' with { type: 'text' };
import dbResourceReadNextDraftChangeSequenceSql from '../../shell/database/stmts/db-resource-read-next-draft-change-sequence.sql' with { type: 'text' };
import dbResourceReadDraftChangeSql from '../../shell/database/stmts/db-resource-read-draft-change.sql' with { type: 'text' };
import dbResourceReadResourceKindStatusSql from '../../shell/database/stmts/db-resource-read-resource-kind-status.sql' with { type: 'text' };
import dbResourceUpdateDraftNameSql from '../../shell/database/stmts/db-resource-update-draft-name.sql' with { type: 'text' };
import dbResourceDiscardDraftSql from '../../shell/database/stmts/db-resource-discard-draft.sql' with { type: 'text' };
import encryptionKeyReadByResourceSql from '../../shell/database/stmts/encryption-key-read-by-resource.sql' with { type: 'text' };
import encryptionKeyInsertForResourceSql from '../../shell/database/stmts/encryption-key-insert-for-resource.sql' with { type: 'text' };
import keyValueReadByNameSql from '../../shell/database/stmts/key-value-read-by-name.sql' with { type: 'text' };
import keyValueDeleteSql from '../../shell/database/stmts/key-value-delete.sql' with { type: 'text' };
import keyValueUpsertSql from '../../shell/database/stmts/key-value-upsert.sql' with { type: 'text' };
import mediaFileListSql from '../../shell/database/stmts/media-file-list.sql' with { type: 'text' };
import mediaFileReadByIdSql from '../../shell/database/stmts/media-file-read-by-id.sql' with { type: 'text' };
import mediaFileDeleteSql from '../../shell/database/stmts/media-file-delete.sql' with { type: 'text' };
import mediaFileInsertSql from '../../shell/database/stmts/media-file-insert.sql' with { type: 'text' };
import migrationStateReadPragmaApplicationIdSql from '../../shell/database/stmts/migration-state-read-pragma-application-id.sql' with { type: 'text' };
import migrationStateReadPragmaTableListSql from '../../shell/database/stmts/migration-state-read-pragma-table-list.sql' with { type: 'text' };
import migrationStateReadPragmaUserVersionSql from '../../shell/database/stmts/migration-state-read-pragma-user-version.sql' with { type: 'text' };
import migrationStateReadSchemaMigrationsSql from '../../shell/database/stmts/migration-state-read-schema-migrations.sql' with { type: 'text' };
import migrationStateReadSqliteSchemaSql from '../../shell/database/stmts/migration-state-read-sqlite-schema.sql' with { type: 'text' };
import migrationInsertLedgerEntrySql from '../../shell/database/stmts/migration-insert-ledger-entry.sql' with { type: 'text' };
import pragmaReadPragmaBusyTimeoutSql from '../../shell/database/stmts/pragma-read-pragma-busy-timeout.sql' with { type: 'text' };
import pragmaReadPragmaCacheSizeSql from '../../shell/database/stmts/pragma-read-pragma-cache-size.sql' with { type: 'text' };
import pragmaReadPragmaForeignKeysSql from '../../shell/database/stmts/pragma-read-pragma-foreign-keys.sql' with { type: 'text' };
import pragmaReadPragmaIgnoreCheckConstraintsSql from '../../shell/database/stmts/pragma-read-pragma-ignore-check-constraints.sql' with { type: 'text' };
import pragmaReadPragmaJournalModeSql from '../../shell/database/stmts/pragma-read-pragma-journal-mode.sql' with { type: 'text' };
import pragmaReadPragmaSynchronousSql from '../../shell/database/stmts/pragma-read-pragma-synchronous.sql' with { type: 'text' };
import pragmaReadPragmaTempStoreSql from '../../shell/database/stmts/pragma-read-pragma-temp-store.sql' with { type: 'text' };
import resourceControlDeleteDbResourceApplyRunsSql from '../../shell/database/stmts/resource-control-delete-db-resource-apply-runs.sql' with { type: 'text' };
import resourceControlDeleteDbResourceBackupsSql from '../../shell/database/stmts/resource-control-delete-db-resource-backups.sql' with { type: 'text' };
import resourceControlDeleteResourceCatalogSql from '../../shell/database/stmts/resource-control-delete-resource-catalog.sql' with { type: 'text' };
import resourceControlDeleteResourcePlacementsSql from '../../shell/database/stmts/resource-control-delete-resource-placements.sql' with { type: 'text' };
import resourceControlInsertDbResourceApplyRunsSql from '../../shell/database/stmts/resource-control-insert-db-resource-apply-runs.sql' with { type: 'text' };
import resourceControlInsertDbResourceBackupsSql from '../../shell/database/stmts/resource-control-insert-db-resource-backups.sql' with { type: 'text' };
import resourceControlInsertDbResourceDraftsSql from '../../shell/database/stmts/resource-control-insert-db-resource-drafts.sql' with { type: 'text' };
import resourceControlInsertResourceCatalogSql from '../../shell/database/stmts/resource-control-insert-resource-catalog.sql' with { type: 'text' };
import resourceControlInsertResourcePlacementsSql from '../../shell/database/stmts/resource-control-insert-resource-placements.sql' with { type: 'text' };
import resourceControlReadDbResourceApplyRunsSql from '../../shell/database/stmts/resource-control-read-db-resource-apply-runs.sql' with { type: 'text' };
import resourceControlReadBackupByApplySql from '../../shell/database/stmts/resource-control-read-backup-by-apply.sql' with { type: 'text' };
import resourceControlListBackupsSql from '../../shell/database/stmts/resource-control-list-backups.sql' with { type: 'text' };
import resourceControlReadDbResourceDraftChangesSql from '../../shell/database/stmts/resource-control-read-db-resource-draft-changes.sql' with { type: 'text' };
import resourceControlListDraftsSql from '../../shell/database/stmts/resource-control-list-drafts.sql' with { type: 'text' };
import resourceControlListDraftsByStatusSql from '../../shell/database/stmts/resource-control-list-drafts-by-status.sql' with { type: 'text' };
import resourceControlReadResourceSql from '../../shell/database/stmts/resource-control-read-resource.sql' with { type: 'text' };
import resourceControlReadDeletingResourceSql from '../../shell/database/stmts/resource-control-read-deleting-resource.sql' with { type: 'text' };
import resourceControlListResourceIdentitiesSql from '../../shell/database/stmts/resource-control-list-resource-identities.sql' with { type: 'text' };
import resourceControlReadResourcePlacementsSql from '../../shell/database/stmts/resource-control-read-resource-placements.sql' with { type: 'text' };
import resourceControlUpdateDbResourceApplyRunsSql from '../../shell/database/stmts/resource-control-update-db-resource-apply-runs.sql' with { type: 'text' };
import resourceControlUpdateDbResourceBackupsSql from '../../shell/database/stmts/resource-control-update-db-resource-backups.sql' with { type: 'text' };
import resourceControlUpdateResourceCatalogSql from '../../shell/database/stmts/resource-control-update-resource-catalog.sql' with { type: 'text' };
import resourceControlUpdateResourcePlacementsSql from '../../shell/database/stmts/resource-control-update-resource-placements.sql' with { type: 'text' };
import schemaContractListObjectsSql from '../../shell/database/stmts/schema-contract-list-objects.sql' with { type: 'text' };
import schemaContractReadTableSqlSql from '../../shell/database/stmts/schema-contract-read-table-sql.sql' with { type: 'text' };
import schemaContractListExplicitIndexesSql from '../../shell/database/stmts/schema-contract-list-explicit-indexes.sql' with { type: 'text' };
import schemaContractReadTursoInternalTypesSql from '../../shell/database/stmts/schema-contract-read-turso-internal-types.sql' with { type: 'text' };
import transactionDisableForeignKeysSql from '../../shell/database/stmts/transaction-disable-foreign-keys.sql' with { type: 'text' };
import transactionEnableForeignKeysSql from '../../shell/database/stmts/transaction-enable-foreign-keys.sql' with { type: 'text' };
import widgetStateInsertWidgetInstanceStatesSql from '../../shell/database/stmts/widget-state-insert-widget-instance-states.sql' with { type: 'text' };
import widgetStateReadCanvasItemsSql from '../../shell/database/stmts/widget-state-read-canvas-items.sql' with { type: 'text' };
import widgetStateReadWidgetInstanceStatesSql from '../../shell/database/stmts/widget-state-read-widget-instance-states.sql' with { type: 'text' };
import widgetStateUpdateWidgetInstanceStatesSql from '../../shell/database/stmts/widget-state-update-widget-instance-states.sql' with { type: 'text' };

import canvasItemReadAllSql from '../../shell/database/stmts/canvas-item-read-all.sql' with { type: 'text' };
import canvasItemReadAllAfterIdSql from '../../shell/database/stmts/canvas-item-read-all-after-id.sql' with { type: 'text' };
import canvasItemReadByIdsSql from '../../shell/database/stmts/canvas-item-read-by-ids.sql' with { type: 'text' };
import canvasItemReadByIdsAfterIdSql from '../../shell/database/stmts/canvas-item-read-by-ids-after-id.sql' with { type: 'text' };
import canvasItemReadByKindSql from '../../shell/database/stmts/canvas-item-read-by-kind.sql' with { type: 'text' };
import canvasItemReadByKindAfterIdSql from '../../shell/database/stmts/canvas-item-read-by-kind-after-id.sql' with { type: 'text' };
import canvasItemReadChildrenSql from '../../shell/database/stmts/canvas-item-read-children.sql' with { type: 'text' };
import canvasItemReadChildrenAfterOrderSql from '../../shell/database/stmts/canvas-item-read-children-after-order.sql' with { type: 'text' };
import canvasItemReadImageResourceClaimsSql from '../../shell/database/stmts/canvas-item-read-image-resource-claims.sql' with { type: 'text' };
import canvasItemReadImageResourceClaimsExcludingItemsSql from '../../shell/database/stmts/canvas-item-read-image-resource-claims-excluding-items.sql' with { type: 'text' };
import canvasItemReadLocatedWidgetSql from '../../shell/database/stmts/canvas-item-read-located-widget.sql' with { type: 'text' };
import canvasItemReadRootChildrenSql from '../../shell/database/stmts/canvas-item-read-root-children.sql' with { type: 'text' };
import canvasItemReadRootChildrenAfterOrderSql from '../../shell/database/stmts/canvas-item-read-root-children-after-order.sql' with { type: 'text' };
import canvasItemReadSnapshotSql from '../../shell/database/stmts/canvas-item-read-snapshot.sql' with { type: 'text' };
import canvasItemReadWidgetInstanceSql from '../../shell/database/stmts/canvas-item-read-widget-instance.sql' with { type: 'text' };
import canvasItemReadWidgetKeySql from '../../shell/database/stmts/canvas-item-read-widget-key.sql' with { type: 'text' };
import canvasItemReadWidgetKeyAfterIdentitySql from '../../shell/database/stmts/canvas-item-read-widget-key-after-identity.sql' with { type: 'text' };
import chatListAllSql from '../../shell/database/stmts/chat-list-all.sql' with { type: 'text' };
import chatListAllByStatusSql from '../../shell/database/stmts/chat-list-all-by-status.sql' with { type: 'text' };
import chatListByCanvasSql from '../../shell/database/stmts/chat-list-by-canvas.sql' with { type: 'text' };
import chatListByCanvasAndStatusSql from '../../shell/database/stmts/chat-list-by-canvas-and-status.sql' with { type: 'text' };
import chatListWithoutCanvasSql from '../../shell/database/stmts/chat-list-without-canvas.sql' with { type: 'text' };
import chatListWithoutCanvasByStatusSql from '../../shell/database/stmts/chat-list-without-canvas-by-status.sql' with { type: 'text' };
import chatUpdateCanvasSql from '../../shell/database/stmts/chat-update-canvas.sql' with { type: 'text' };
import chatUpdateCanvasAndNameSql from '../../shell/database/stmts/chat-update-canvas-and-name.sql' with { type: 'text' };
import chatUpdateCanvasAndStatusSql from '../../shell/database/stmts/chat-update-canvas-and-status.sql' with { type: 'text' };
import chatUpdateCanvasNameAndStatusSql from '../../shell/database/stmts/chat-update-canvas-name-and-status.sql' with { type: 'text' };
import chatUpdateNameSql from '../../shell/database/stmts/chat-update-name.sql' with { type: 'text' };
import chatUpdateNameAndStatusSql from '../../shell/database/stmts/chat-update-name-and-status.sql' with { type: 'text' };
import chatUpdateStatusSql from '../../shell/database/stmts/chat-update-status.sql' with { type: 'text' };
import chatDetachArchiveByCanvasSql from '../../shell/database/stmts/chat-detach-archive-by-canvas.sql' with { type: 'text' };
import dbResourceReadListAppliesSql from '../../shell/database/stmts/db-resource-read-list-applies.sql' with { type: 'text' };
import dbResourceReadListAppliesBeforeSql from '../../shell/database/stmts/db-resource-read-list-applies-before.sql' with { type: 'text' };
import dbResourceReadListAppliesByStatusSql from '../../shell/database/stmts/db-resource-read-list-applies-by-status.sql' with { type: 'text' };
import dbResourceReadListAppliesByStatusBeforeSql from '../../shell/database/stmts/db-resource-read-list-applies-by-status-before.sql' with { type: 'text' };
import dbResourceReadListDraftsSql from '../../shell/database/stmts/db-resource-read-list-drafts.sql' with { type: 'text' };
import dbResourceReadListDraftsBeforeSql from '../../shell/database/stmts/db-resource-read-list-drafts-before.sql' with { type: 'text' };
import dbResourceReadListDraftsByStatusSql from '../../shell/database/stmts/db-resource-read-list-drafts-by-status.sql' with { type: 'text' };
import dbResourceReadListDraftsByStatusBeforeSql from '../../shell/database/stmts/db-resource-read-list-drafts-by-status-before.sql' with { type: 'text' };
import dbResourceUpdateApplySql from '../../shell/database/stmts/db-resource-update-apply.sql' with { type: 'text' };
import dbResourceUpdateApplyExpectedSql from '../../shell/database/stmts/db-resource-update-apply-expected.sql' with { type: 'text' };
import dbResourceUpdateDraftStatusSql from '../../shell/database/stmts/db-resource-update-draft-status.sql' with { type: 'text' };
import dbResourceUpdateDraftStatusExpectedSql from '../../shell/database/stmts/db-resource-update-draft-status-expected.sql' with { type: 'text' };
import migrationSetApplicationIdSql from '../../shell/database/stmts/migration-set-application-id.sql' with { type: 'text' };
import migrationSetUserVersionSql from '../../shell/database/stmts/migration-set-user-version.sql' with { type: 'text' };
import pragmaSetBusyTimeoutSql from '../../shell/database/stmts/pragma-set-busy-timeout.sql' with { type: 'text' };
import pragmaSetCacheSizeSql from '../../shell/database/stmts/pragma-set-cache-size.sql' with { type: 'text' };
import pragmaSetForeignKeysOnSql from '../../shell/database/stmts/pragma-set-foreign-keys-on.sql' with { type: 'text' };
import pragmaSetIgnoreCheckConstraintsSql from '../../shell/database/stmts/pragma-set-ignore-check-constraints.sql' with { type: 'text' };
import pragmaSetJournalModeWalSql from '../../shell/database/stmts/pragma-set-journal-mode-wal.sql' with { type: 'text' };
import pragmaSetSynchronousFullSql from '../../shell/database/stmts/pragma-set-synchronous-full.sql' with { type: 'text' };
import pragmaSetTempStoreMemorySql from '../../shell/database/stmts/pragma-set-temp-store-memory.sql' with { type: 'text' };
import resourceControlListAllSql from '../../shell/database/stmts/resource-control-list-all.sql' with { type: 'text' };
import resourceControlListByKindSql from '../../shell/database/stmts/resource-control-list-by-kind.sql' with { type: 'text' };
import resourceControlListByKindAndStatusSql from '../../shell/database/stmts/resource-control-list-by-kind-and-status.sql' with { type: 'text' };
import resourceControlListByStatusSql from '../../shell/database/stmts/resource-control-list-by-status.sql' with { type: 'text' };
import resourceControlUpdateApplySql from '../../shell/database/stmts/resource-control-update-apply.sql' with { type: 'text' };
import resourceControlUpdateDraftSql from '../../shell/database/stmts/resource-control-update-draft.sql' with { type: 'text' };
import resourceControlUpdateStateSql from '../../shell/database/stmts/resource-control-update-state.sql' with { type: 'text' };
import schemaContractFindForeignKeyOrphanSql from '../../shell/database/stmts/schema-contract-find-foreign-key-orphan.sql' with { type: 'text' };
import schemaContractReadForeignKeyListSql from '../../shell/database/stmts/schema-contract-read-foreign-key-list.sql' with { type: 'text' };
import schemaContractReadIndexInfoSql from '../../shell/database/stmts/schema-contract-read-index-info.sql' with { type: 'text' };
import schemaContractReadIndexListSql from '../../shell/database/stmts/schema-contract-read-index-list.sql' with { type: 'text' };
import schemaContractReadTableInfoSql from '../../shell/database/stmts/schema-contract-read-table-info.sql' with { type: 'text' };
import resourceKvCreateMetadataTableSql from '../../shell/database/stmts/resource-kv-create-metadata-table.sql' with { type: 'text' };
import resourceKvCreateEntriesTableSql from '../../shell/database/stmts/resource-kv-create-entries-table.sql' with { type: 'text' };
import resourceKvCreateUpdatedAtTriggerSql from '../../shell/database/stmts/resource-kv-create-updated-at-trigger.sql' with { type: 'text' };
import resourceKvInsertMetadataSql from '../../shell/database/stmts/resource-kv-insert-metadata.sql' with { type: 'text' };
import resourceKvReadEntryPresentSql from '../../shell/database/stmts/resource-kv-read-entry-present.sql' with { type: 'text' };
import resourceKvCountEntriesSql from '../../shell/database/stmts/resource-kv-count-entries.sql' with { type: 'text' };
import resourceKvListEntriesSql from '../../shell/database/stmts/resource-kv-list-entries.sql' with { type: 'text' };
import resourceKvListEntryMetadataSql from '../../shell/database/stmts/resource-kv-list-entry-metadata.sql' with { type: 'text' };
import resourceKvUpsertEntrySql from '../../shell/database/stmts/resource-kv-upsert-entry.sql' with { type: 'text' };
import resourceKvDeleteEntrySql from '../../shell/database/stmts/resource-kv-delete-entry.sql' with { type: 'text' };
import resourceKvInsertEntryIfAbsentSql from '../../shell/database/stmts/resource-kv-insert-entry-if-absent.sql' with { type: 'text' };
import resourceKvUpdateEntryIfRevisionSql from '../../shell/database/stmts/resource-kv-update-entry-if-revision.sql' with { type: 'text' };
import resourceKvReadMetadataSql from '../../shell/database/stmts/resource-kv-read-metadata.sql' with { type: 'text' };
import resourceKvValidateEntryShapeSql from '../../shell/database/stmts/resource-kv-validate-entry-shape.sql' with { type: 'text' };
import resourceKvReadMetadataTableInfoSql from '../../shell/database/stmts/resource-kv-read-metadata-table-info.sql' with { type: 'text' };
import resourceKvReadEntriesTableInfoSql from '../../shell/database/stmts/resource-kv-read-entries-table-info.sql' with { type: 'text' };
import resourceKvReadTableListSql from '../../shell/database/stmts/resource-kv-read-table-list.sql' with { type: 'text' };
import resourceKvReadSchemaObjectsSql from '../../shell/database/stmts/resource-kv-read-schema-objects.sql' with { type: 'text' };
import resourceKvInsertCopyEntrySql from '../../shell/database/stmts/resource-kv-insert-copy-entry.sql' with { type: 'text' };
import resourceKvReadCopyPageSql from '../../shell/database/stmts/resource-kv-read-copy-page.sql' with { type: 'text' };
import resourceKvReadResourceIdentitySql from '../../shell/database/stmts/resource-kv-read-resource-identity.sql' with { type: 'text' };
import resourceKvReadEntrySql from '../../shell/database/stmts/resource-kv-read-entry.sql' with { type: 'text' };
import resourceKvReadEntryMetadataSql from '../../shell/database/stmts/resource-kv-read-entry-metadata.sql' with { type: 'text' };
import transactionBeginImmediateSql from '../../shell/database/stmts/transaction-begin-immediate.sql' with { type: 'text' };
import transactionCommitSql from '../../shell/database/stmts/transaction-commit.sql' with { type: 'text' };
import transactionRollbackSql from '../../shell/database/stmts/transaction-rollback.sql' with { type: 'text' };
import pragmaCheckpointWalTruncateSql from '../../shell/database/stmts/pragma-checkpoint-wal-truncate.sql' with { type: 'text' };
import pragmaSetQueryOnlySql from '../../shell/database/stmts/pragma-set-query-only.sql' with { type: 'text' };
import pragmaReadQueryOnlySql from '../../shell/database/stmts/pragma-read-query-only.sql' with { type: 'text' };
import dbResourceCreateApplyMarkerTableSql from '../../shell/database/stmts/db-resource-create-apply-marker-table.sql' with { type: 'text' };
import dbResourceCreateDraftEvidenceTableSql from '../../shell/database/stmts/db-resource-create-draft-evidence-table.sql' with { type: 'text' };
import dbResourceReadNextDraftSequenceSql from '../../shell/database/stmts/db-resource-read-next-draft-sequence.sql' with { type: 'text' };
import dbResourceInsertDraftEvidenceSql from '../../shell/database/stmts/db-resource-insert-draft-evidence.sql' with { type: 'text' };
import dbResourceListDraftEvidenceSql from '../../shell/database/stmts/db-resource-list-draft-evidence.sql' with { type: 'text' };
import dbResourceInsertApplyMarkerSql from '../../shell/database/stmts/db-resource-insert-apply-marker.sql' with { type: 'text' };
import dbResourceInsertApplyMarkerIfAbsentSql from '../../shell/database/stmts/db-resource-insert-apply-marker-if-absent.sql' with { type: 'text' };
import dbResourceReadApplyMarkerSql from '../../shell/database/stmts/db-resource-read-apply-marker.sql' with { type: 'text' };
import dbResourceInspectObjectsSql from '../../shell/database/stmts/db-resource-inspect-objects.sql' with { type: 'text' };
import dbResourceReadIndexSchemaSql from '../../shell/database/stmts/db-resource-read-index-schema.sql' with { type: 'text' };
import dbResourceReadTriggersSql from '../../shell/database/stmts/db-resource-read-triggers.sql' with { type: 'text' };
import dbResourceReadBrowseRowsSql from '../../shell/database/stmts/db-resource-read-browse-rows.sql' with { type: 'text' };
import dbResourceReadRowSql from '../../shell/database/stmts/db-resource-read-row.sql' with { type: 'text' };
import dbResourceInsertDefaultRowSql from '../../shell/database/stmts/db-resource-insert-default-row.sql' with { type: 'text' };
import dbResourceInsertRowSql from '../../shell/database/stmts/db-resource-insert-row.sql' with { type: 'text' };
import dbResourceUpdateRowSql from '../../shell/database/stmts/db-resource-update-row.sql' with { type: 'text' };
import dbResourceDeleteRowSql from '../../shell/database/stmts/db-resource-delete-row.sql' with { type: 'text' };
import dbResourceCreateTableSql from '../../shell/database/stmts/db-resource-create-table.sql' with { type: 'text' };
import dbResourceRenameTableSql from '../../shell/database/stmts/db-resource-rename-table.sql' with { type: 'text' };
import dbResourceDropTableSql from '../../shell/database/stmts/db-resource-drop-table.sql' with { type: 'text' };
import dbResourceDropTableIfExistsSql from '../../shell/database/stmts/db-resource-drop-table-if-exists.sql' with { type: 'text' };
import dbResourceAddColumnSql from '../../shell/database/stmts/db-resource-add-column.sql' with { type: 'text' };
import dbResourceRenameColumnSql from '../../shell/database/stmts/db-resource-rename-column.sql' with { type: 'text' };
import dbResourceDropColumnSql from '../../shell/database/stmts/db-resource-drop-column.sql' with { type: 'text' };
import dbResourceCreateIndexSql from '../../shell/database/stmts/db-resource-create-index.sql' with { type: 'text' };
import dbResourceDropIndexSql from '../../shell/database/stmts/db-resource-drop-index.sql' with { type: 'text' };
import dbResourceCopyTableRowsSql from '../../shell/database/stmts/db-resource-copy-table-rows.sql' with { type: 'text' };
import dbResourceReadUserTablesSql from '../../shell/database/stmts/db-resource-read-user-tables.sql' with { type: 'text' };
import dbResourceReadTableSchemaSql from '../../shell/database/stmts/db-resource-read-table-schema.sql' with { type: 'text' };
import dbResourceReadIndexXinfoSql from '../../shell/database/stmts/db-resource-read-index-xinfo.sql' with { type: 'text' };
import dbResourceFindForeignKeyViolationsSql from '../../shell/database/stmts/db-resource-find-foreign-key-violations.sql' with { type: 'text' };
import dbResourceFindMissingParentTableViolationsSql from '../../shell/database/stmts/db-resource-find-missing-parent-table-violations.sql' with { type: 'text' };

export const DATABASE_STATEMENT_NAMES = Object.freeze([
  'canvasItemDeleteCanvasItems',
  'canvasItemInsertCanvasItems',
  'canvasItemInsertKeyValues',
  'canvasItemReadCanvases',
  'canvasItemReadKeyValues',
  'canvasItemUpdateCanvasItems',
  'canvasItemUpdateCanvases',
  'canvasList',
  'canvasReadByName',
  'canvasReadById',
  'canvasDelete',
  'canvasDeletionCountItems',
  'canvasDeletionCountMedia',
  'canvasDeletionCountChats',
  'canvasInsert',
  'canvasUpdateName',
  'chatInsertChats',
  'chatReadChats',
  'databaseCheckReadPragmaIntegrityCheck',
  'databaseCheckReadPragmaQuickCheck',
  'dbResourceReadApplyRun',
  'dbResourceListDraftChanges',
  'dbResourceReadDraft',
  'dbResourceReadActiveDraft',
  'dbResourceInsertApplyRun',
  'dbResourceInsertDraftChange',
  'dbResourceInsertDraft',
  'dbResourceReadNextDraftChangeSequence',
  'dbResourceReadDraftChange',
  'dbResourceReadResourceKindStatus',
  'dbResourceUpdateDraftName',
  'dbResourceDiscardDraft',
  'encryptionKeyReadByResource',
  'encryptionKeyInsertForResource',
  'keyValueReadByName',
  'keyValueDelete',
  'keyValueUpsert',
  'mediaFileList',
  'mediaFileReadById',
  'mediaFileDelete',
  'mediaFileInsert',
  'migrationStateReadPragmaApplicationId',
  'migrationStateReadPragmaTableList',
  'migrationStateReadPragmaUserVersion',
  'migrationStateReadSchemaMigrations',
  'migrationStateReadSqliteSchema',
  'migrationInsertLedgerEntry',
  'pragmaReadPragmaBusyTimeout',
  'pragmaReadPragmaCacheSize',
  'pragmaReadPragmaForeignKeys',
  'pragmaReadPragmaIgnoreCheckConstraints',
  'pragmaReadPragmaJournalMode',
  'pragmaReadPragmaSynchronous',
  'pragmaReadPragmaTempStore',
  'resourceControlDeleteDbResourceApplyRuns',
  'resourceControlDeleteDbResourceBackups',
  'resourceControlDeleteResourceCatalog',
  'resourceControlDeleteResourcePlacements',
  'resourceControlInsertDbResourceApplyRuns',
  'resourceControlInsertDbResourceBackups',
  'resourceControlInsertDbResourceDrafts',
  'resourceControlInsertResourceCatalog',
  'resourceControlInsertResourcePlacements',
  'resourceControlReadDbResourceApplyRuns',
  'resourceControlReadBackupByApply',
  'resourceControlListBackups',
  'resourceControlReadDbResourceDraftChanges',
  'resourceControlListDrafts',
  'resourceControlListDraftsByStatus',
  'resourceControlReadResource',
  'resourceControlReadDeletingResource',
  'resourceControlListResourceIdentities',
  'resourceControlReadResourcePlacements',
  'resourceControlUpdateDbResourceApplyRuns',
  'resourceControlUpdateDbResourceBackups',
  'resourceControlUpdateResourceCatalog',
  'resourceControlUpdateResourcePlacements',
  'schemaContractListObjects',
  'schemaContractReadTableSql',
  'schemaContractListExplicitIndexes',
  'schemaContractReadTursoInternalTypes',
  'transactionDisableForeignKeys',
  'transactionEnableForeignKeys',
  'widgetStateInsertWidgetInstanceStates',
  'widgetStateReadCanvasItems',
  'widgetStateReadWidgetInstanceStates',
  'widgetStateUpdateWidgetInstanceStates',
  'canvasItemReadAll',
  'canvasItemReadAllAfterId',
  'canvasItemReadByIds',
  'canvasItemReadByIdsAfterId',
  'canvasItemReadByKind',
  'canvasItemReadByKindAfterId',
  'canvasItemReadChildren',
  'canvasItemReadChildrenAfterOrder',
  'canvasItemReadImageResourceClaims',
  'canvasItemReadImageResourceClaimsExcludingItems',
  'canvasItemReadLocatedWidget',
  'canvasItemReadRootChildren',
  'canvasItemReadRootChildrenAfterOrder',
  'canvasItemReadSnapshot',
  'canvasItemReadWidgetInstance',
  'canvasItemReadWidgetKey',
  'canvasItemReadWidgetKeyAfterIdentity',
  'chatListAll',
  'chatListAllByStatus',
  'chatListByCanvas',
  'chatListByCanvasAndStatus',
  'chatListWithoutCanvas',
  'chatListWithoutCanvasByStatus',
  'chatUpdateCanvas',
  'chatUpdateCanvasAndName',
  'chatUpdateCanvasAndStatus',
  'chatUpdateCanvasNameAndStatus',
  'chatUpdateName',
  'chatUpdateNameAndStatus',
  'chatUpdateStatus',
  'chatDetachArchiveByCanvas',
  'dbResourceReadListApplies',
  'dbResourceReadListAppliesBefore',
  'dbResourceReadListAppliesByStatus',
  'dbResourceReadListAppliesByStatusBefore',
  'dbResourceReadListDrafts',
  'dbResourceReadListDraftsBefore',
  'dbResourceReadListDraftsByStatus',
  'dbResourceReadListDraftsByStatusBefore',
  'dbResourceUpdateApply',
  'dbResourceUpdateApplyExpected',
  'dbResourceUpdateDraftStatus',
  'dbResourceUpdateDraftStatusExpected',
  'migrationSetApplicationId',
  'migrationSetUserVersion',
  'pragmaSetBusyTimeout',
  'pragmaSetCacheSize',
  'pragmaSetForeignKeysOn',
  'pragmaSetIgnoreCheckConstraints',
  'pragmaSetJournalModeWal',
  'pragmaSetSynchronousFull',
  'pragmaSetTempStoreMemory',
  'resourceControlListAll',
  'resourceControlListByKind',
  'resourceControlListByKindAndStatus',
  'resourceControlListByStatus',
  'resourceControlUpdateApply',
  'resourceControlUpdateDraft',
  'resourceControlUpdateState',
  'schemaContractFindForeignKeyOrphan',
  'schemaContractReadForeignKeyList',
  'schemaContractReadIndexInfo',
  'schemaContractReadIndexList',
  'schemaContractReadTableInfo',
  'resourceKvCreateMetadataTable',
  'resourceKvCreateEntriesTable',
  'resourceKvCreateUpdatedAtTrigger',
  'resourceKvInsertMetadata',
  'resourceKvReadEntryPresent',
  'resourceKvCountEntries',
  'resourceKvListEntries',
  'resourceKvListEntryMetadata',
  'resourceKvUpsertEntry',
  'resourceKvDeleteEntry',
  'resourceKvInsertEntryIfAbsent',
  'resourceKvUpdateEntryIfRevision',
  'resourceKvReadMetadata',
  'resourceKvValidateEntryShape',
  'resourceKvReadMetadataTableInfo',
  'resourceKvReadEntriesTableInfo',
  'resourceKvReadTableList',
  'resourceKvReadSchemaObjects',
  'resourceKvInsertCopyEntry',
  'resourceKvReadCopyPage',
  'resourceKvReadResourceIdentity',
  'resourceKvReadEntry',
  'resourceKvReadEntryMetadata',
  'transactionBeginImmediate',
  'transactionCommit',
  'transactionRollback',
  'pragmaCheckpointWalTruncate',
  'pragmaSetQueryOnly',
  'pragmaReadQueryOnly',
  'dbResourceCreateApplyMarkerTable',
  'dbResourceCreateDraftEvidenceTable',
  'dbResourceReadNextDraftSequence',
  'dbResourceInsertDraftEvidence',
  'dbResourceListDraftEvidence',
  'dbResourceInsertApplyMarker',
  'dbResourceInsertApplyMarkerIfAbsent',
  'dbResourceReadApplyMarker',
  'dbResourceInspectObjects',
  'dbResourceReadIndexSchema',
  'dbResourceReadTriggers',
  'dbResourceReadBrowseRows',
  'dbResourceReadRow',
  'dbResourceInsertDefaultRow',
  'dbResourceInsertRow',
  'dbResourceUpdateRow',
  'dbResourceDeleteRow',
  'dbResourceCreateTable',
  'dbResourceRenameTable',
  'dbResourceDropTable',
  'dbResourceDropTableIfExists',
  'dbResourceAddColumn',
  'dbResourceRenameColumn',
  'dbResourceDropColumn',
  'dbResourceCreateIndex',
  'dbResourceDropIndex',
  'dbResourceCopyTableRows',
  'dbResourceReadUserTables',
  'dbResourceReadTableSchema',
  'dbResourceReadIndexXinfo',
  'dbResourceFindForeignKeyViolations',
  'dbResourceFindMissingParentTableViolations',
] as const);

export type TDatabaseStatementName = (typeof DATABASE_STATEMENT_NAMES)[number];

export const DATABASE_STATEMENTS = Object.freeze({
  canvasItemDeleteCanvasItems: canvasItemDeleteCanvasItemsSql,
  canvasItemInsertCanvasItems: canvasItemInsertCanvasItemsSql,
  canvasItemInsertKeyValues: canvasItemInsertKeyValuesSql,
  canvasItemReadCanvases: canvasItemReadCanvasesSql,
  canvasItemReadKeyValues: canvasItemReadKeyValuesSql,
  canvasItemUpdateCanvasItems: canvasItemUpdateCanvasItemsSql,
  canvasItemUpdateCanvases: canvasItemUpdateCanvasesSql,
  canvasList: canvasListSql,
  canvasReadByName: canvasReadByNameSql,
  canvasReadById: canvasReadByIdSql,
  canvasDelete: canvasDeleteSql,
  canvasDeletionCountItems: canvasDeletionCountItemsSql,
  canvasDeletionCountMedia: canvasDeletionCountMediaSql,
  canvasDeletionCountChats: canvasDeletionCountChatsSql,
  canvasInsert: canvasInsertSql,
  canvasUpdateName: canvasUpdateNameSql,
  chatInsertChats: chatInsertChatsSql,
  chatReadChats: chatReadChatsSql,
  databaseCheckReadPragmaIntegrityCheck: databaseCheckReadPragmaIntegrityCheckSql,
  databaseCheckReadPragmaQuickCheck: databaseCheckReadPragmaQuickCheckSql,
  dbResourceReadApplyRun: dbResourceReadApplyRunSql,
  dbResourceListDraftChanges: dbResourceListDraftChangesSql,
  dbResourceReadDraft: dbResourceReadDraftSql,
  dbResourceReadActiveDraft: dbResourceReadActiveDraftSql,
  dbResourceInsertApplyRun: dbResourceInsertApplyRunSql,
  dbResourceInsertDraftChange: dbResourceInsertDraftChangeSql,
  dbResourceInsertDraft: dbResourceInsertDraftSql,
  dbResourceReadNextDraftChangeSequence: dbResourceReadNextDraftChangeSequenceSql,
  dbResourceReadDraftChange: dbResourceReadDraftChangeSql,
  dbResourceReadResourceKindStatus: dbResourceReadResourceKindStatusSql,
  dbResourceUpdateDraftName: dbResourceUpdateDraftNameSql,
  dbResourceDiscardDraft: dbResourceDiscardDraftSql,
  encryptionKeyReadByResource: encryptionKeyReadByResourceSql,
  encryptionKeyInsertForResource: encryptionKeyInsertForResourceSql,
  keyValueReadByName: keyValueReadByNameSql,
  keyValueDelete: keyValueDeleteSql,
  keyValueUpsert: keyValueUpsertSql,
  mediaFileList: mediaFileListSql,
  mediaFileReadById: mediaFileReadByIdSql,
  mediaFileDelete: mediaFileDeleteSql,
  mediaFileInsert: mediaFileInsertSql,
  migrationStateReadPragmaApplicationId: migrationStateReadPragmaApplicationIdSql,
  migrationStateReadPragmaTableList: migrationStateReadPragmaTableListSql,
  migrationStateReadPragmaUserVersion: migrationStateReadPragmaUserVersionSql,
  migrationStateReadSchemaMigrations: migrationStateReadSchemaMigrationsSql,
  migrationStateReadSqliteSchema: migrationStateReadSqliteSchemaSql,
  migrationInsertLedgerEntry: migrationInsertLedgerEntrySql,
  pragmaReadPragmaBusyTimeout: pragmaReadPragmaBusyTimeoutSql,
  pragmaReadPragmaCacheSize: pragmaReadPragmaCacheSizeSql,
  pragmaReadPragmaForeignKeys: pragmaReadPragmaForeignKeysSql,
  pragmaReadPragmaIgnoreCheckConstraints: pragmaReadPragmaIgnoreCheckConstraintsSql,
  pragmaReadPragmaJournalMode: pragmaReadPragmaJournalModeSql,
  pragmaReadPragmaSynchronous: pragmaReadPragmaSynchronousSql,
  pragmaReadPragmaTempStore: pragmaReadPragmaTempStoreSql,
  resourceControlDeleteDbResourceApplyRuns: resourceControlDeleteDbResourceApplyRunsSql,
  resourceControlDeleteDbResourceBackups: resourceControlDeleteDbResourceBackupsSql,
  resourceControlDeleteResourceCatalog: resourceControlDeleteResourceCatalogSql,
  resourceControlDeleteResourcePlacements: resourceControlDeleteResourcePlacementsSql,
  resourceControlInsertDbResourceApplyRuns: resourceControlInsertDbResourceApplyRunsSql,
  resourceControlInsertDbResourceBackups: resourceControlInsertDbResourceBackupsSql,
  resourceControlInsertDbResourceDrafts: resourceControlInsertDbResourceDraftsSql,
  resourceControlInsertResourceCatalog: resourceControlInsertResourceCatalogSql,
  resourceControlInsertResourcePlacements: resourceControlInsertResourcePlacementsSql,
  resourceControlReadDbResourceApplyRuns: resourceControlReadDbResourceApplyRunsSql,
  resourceControlReadBackupByApply: resourceControlReadBackupByApplySql,
  resourceControlListBackups: resourceControlListBackupsSql,
  resourceControlReadDbResourceDraftChanges: resourceControlReadDbResourceDraftChangesSql,
  resourceControlListDrafts: resourceControlListDraftsSql,
  resourceControlListDraftsByStatus: resourceControlListDraftsByStatusSql,
  resourceControlReadResource: resourceControlReadResourceSql,
  resourceControlReadDeletingResource: resourceControlReadDeletingResourceSql,
  resourceControlListResourceIdentities: resourceControlListResourceIdentitiesSql,
  resourceControlReadResourcePlacements: resourceControlReadResourcePlacementsSql,
  resourceControlUpdateDbResourceApplyRuns: resourceControlUpdateDbResourceApplyRunsSql,
  resourceControlUpdateDbResourceBackups: resourceControlUpdateDbResourceBackupsSql,
  resourceControlUpdateResourceCatalog: resourceControlUpdateResourceCatalogSql,
  resourceControlUpdateResourcePlacements: resourceControlUpdateResourcePlacementsSql,
  schemaContractListObjects: schemaContractListObjectsSql,
  schemaContractReadTableSql: schemaContractReadTableSqlSql,
  schemaContractListExplicitIndexes: schemaContractListExplicitIndexesSql,
  schemaContractReadTursoInternalTypes: schemaContractReadTursoInternalTypesSql,
  transactionDisableForeignKeys: transactionDisableForeignKeysSql,
  transactionEnableForeignKeys: transactionEnableForeignKeysSql,
  widgetStateInsertWidgetInstanceStates: widgetStateInsertWidgetInstanceStatesSql,
  widgetStateReadCanvasItems: widgetStateReadCanvasItemsSql,
  widgetStateReadWidgetInstanceStates: widgetStateReadWidgetInstanceStatesSql,
  widgetStateUpdateWidgetInstanceStates: widgetStateUpdateWidgetInstanceStatesSql,
  canvasItemReadAll: canvasItemReadAllSql,
  canvasItemReadAllAfterId: canvasItemReadAllAfterIdSql,
  canvasItemReadByIds: canvasItemReadByIdsSql,
  canvasItemReadByIdsAfterId: canvasItemReadByIdsAfterIdSql,
  canvasItemReadByKind: canvasItemReadByKindSql,
  canvasItemReadByKindAfterId: canvasItemReadByKindAfterIdSql,
  canvasItemReadChildren: canvasItemReadChildrenSql,
  canvasItemReadChildrenAfterOrder: canvasItemReadChildrenAfterOrderSql,
  canvasItemReadImageResourceClaims: canvasItemReadImageResourceClaimsSql,
  canvasItemReadImageResourceClaimsExcludingItems: canvasItemReadImageResourceClaimsExcludingItemsSql,
  canvasItemReadLocatedWidget: canvasItemReadLocatedWidgetSql,
  canvasItemReadRootChildren: canvasItemReadRootChildrenSql,
  canvasItemReadRootChildrenAfterOrder: canvasItemReadRootChildrenAfterOrderSql,
  canvasItemReadSnapshot: canvasItemReadSnapshotSql,
  canvasItemReadWidgetInstance: canvasItemReadWidgetInstanceSql,
  canvasItemReadWidgetKey: canvasItemReadWidgetKeySql,
  canvasItemReadWidgetKeyAfterIdentity: canvasItemReadWidgetKeyAfterIdentitySql,
  chatListAll: chatListAllSql,
  chatListAllByStatus: chatListAllByStatusSql,
  chatListByCanvas: chatListByCanvasSql,
  chatListByCanvasAndStatus: chatListByCanvasAndStatusSql,
  chatListWithoutCanvas: chatListWithoutCanvasSql,
  chatListWithoutCanvasByStatus: chatListWithoutCanvasByStatusSql,
  chatUpdateCanvas: chatUpdateCanvasSql,
  chatUpdateCanvasAndName: chatUpdateCanvasAndNameSql,
  chatUpdateCanvasAndStatus: chatUpdateCanvasAndStatusSql,
  chatUpdateCanvasNameAndStatus: chatUpdateCanvasNameAndStatusSql,
  chatUpdateName: chatUpdateNameSql,
  chatUpdateNameAndStatus: chatUpdateNameAndStatusSql,
  chatUpdateStatus: chatUpdateStatusSql,
  chatDetachArchiveByCanvas: chatDetachArchiveByCanvasSql,
  dbResourceReadListApplies: dbResourceReadListAppliesSql,
  dbResourceReadListAppliesBefore: dbResourceReadListAppliesBeforeSql,
  dbResourceReadListAppliesByStatus: dbResourceReadListAppliesByStatusSql,
  dbResourceReadListAppliesByStatusBefore: dbResourceReadListAppliesByStatusBeforeSql,
  dbResourceReadListDrafts: dbResourceReadListDraftsSql,
  dbResourceReadListDraftsBefore: dbResourceReadListDraftsBeforeSql,
  dbResourceReadListDraftsByStatus: dbResourceReadListDraftsByStatusSql,
  dbResourceReadListDraftsByStatusBefore: dbResourceReadListDraftsByStatusBeforeSql,
  dbResourceUpdateApply: dbResourceUpdateApplySql,
  dbResourceUpdateApplyExpected: dbResourceUpdateApplyExpectedSql,
  dbResourceUpdateDraftStatus: dbResourceUpdateDraftStatusSql,
  dbResourceUpdateDraftStatusExpected: dbResourceUpdateDraftStatusExpectedSql,
  migrationSetApplicationId: migrationSetApplicationIdSql,
  migrationSetUserVersion: migrationSetUserVersionSql,
  pragmaSetBusyTimeout: pragmaSetBusyTimeoutSql,
  pragmaSetCacheSize: pragmaSetCacheSizeSql,
  pragmaSetForeignKeysOn: pragmaSetForeignKeysOnSql,
  pragmaSetIgnoreCheckConstraints: pragmaSetIgnoreCheckConstraintsSql,
  pragmaSetJournalModeWal: pragmaSetJournalModeWalSql,
  pragmaSetSynchronousFull: pragmaSetSynchronousFullSql,
  pragmaSetTempStoreMemory: pragmaSetTempStoreMemorySql,
  resourceControlListAll: resourceControlListAllSql,
  resourceControlListByKind: resourceControlListByKindSql,
  resourceControlListByKindAndStatus: resourceControlListByKindAndStatusSql,
  resourceControlListByStatus: resourceControlListByStatusSql,
  resourceControlUpdateApply: resourceControlUpdateApplySql,
  resourceControlUpdateDraft: resourceControlUpdateDraftSql,
  resourceControlUpdateState: resourceControlUpdateStateSql,
  schemaContractFindForeignKeyOrphan: schemaContractFindForeignKeyOrphanSql,
  schemaContractReadForeignKeyList: schemaContractReadForeignKeyListSql,
  schemaContractReadIndexInfo: schemaContractReadIndexInfoSql,
  schemaContractReadIndexList: schemaContractReadIndexListSql,
  schemaContractReadTableInfo: schemaContractReadTableInfoSql,
  resourceKvCreateMetadataTable: resourceKvCreateMetadataTableSql,
  resourceKvCreateEntriesTable: resourceKvCreateEntriesTableSql,
  resourceKvCreateUpdatedAtTrigger: resourceKvCreateUpdatedAtTriggerSql,
  resourceKvInsertMetadata: resourceKvInsertMetadataSql,
  resourceKvReadEntryPresent: resourceKvReadEntryPresentSql,
  resourceKvCountEntries: resourceKvCountEntriesSql,
  resourceKvListEntries: resourceKvListEntriesSql,
  resourceKvListEntryMetadata: resourceKvListEntryMetadataSql,
  resourceKvUpsertEntry: resourceKvUpsertEntrySql,
  resourceKvDeleteEntry: resourceKvDeleteEntrySql,
  resourceKvInsertEntryIfAbsent: resourceKvInsertEntryIfAbsentSql,
  resourceKvUpdateEntryIfRevision: resourceKvUpdateEntryIfRevisionSql,
  resourceKvReadMetadata: resourceKvReadMetadataSql,
  resourceKvValidateEntryShape: resourceKvValidateEntryShapeSql,
  resourceKvReadMetadataTableInfo: resourceKvReadMetadataTableInfoSql,
  resourceKvReadEntriesTableInfo: resourceKvReadEntriesTableInfoSql,
  resourceKvReadTableList: resourceKvReadTableListSql,
  resourceKvReadSchemaObjects: resourceKvReadSchemaObjectsSql,
  resourceKvInsertCopyEntry: resourceKvInsertCopyEntrySql,
  resourceKvReadCopyPage: resourceKvReadCopyPageSql,
  resourceKvReadResourceIdentity: resourceKvReadResourceIdentitySql,
  resourceKvReadEntry: resourceKvReadEntrySql,
  resourceKvReadEntryMetadata: resourceKvReadEntryMetadataSql,
  transactionBeginImmediate: transactionBeginImmediateSql,
  transactionCommit: transactionCommitSql,
  transactionRollback: transactionRollbackSql,
  pragmaCheckpointWalTruncate: pragmaCheckpointWalTruncateSql,
  pragmaSetQueryOnly: pragmaSetQueryOnlySql,
  pragmaReadQueryOnly: pragmaReadQueryOnlySql,
  dbResourceCreateApplyMarkerTable: dbResourceCreateApplyMarkerTableSql,
  dbResourceCreateDraftEvidenceTable: dbResourceCreateDraftEvidenceTableSql,
  dbResourceReadNextDraftSequence: dbResourceReadNextDraftSequenceSql,
  dbResourceInsertDraftEvidence: dbResourceInsertDraftEvidenceSql,
  dbResourceListDraftEvidence: dbResourceListDraftEvidenceSql,
  dbResourceInsertApplyMarker: dbResourceInsertApplyMarkerSql,
  dbResourceInsertApplyMarkerIfAbsent: dbResourceInsertApplyMarkerIfAbsentSql,
  dbResourceReadApplyMarker: dbResourceReadApplyMarkerSql,
  dbResourceInspectObjects: dbResourceInspectObjectsSql,
  dbResourceReadIndexSchema: dbResourceReadIndexSchemaSql,
  dbResourceReadTriggers: dbResourceReadTriggersSql,
  dbResourceReadBrowseRows: dbResourceReadBrowseRowsSql,
  dbResourceReadRow: dbResourceReadRowSql,
  dbResourceInsertDefaultRow: dbResourceInsertDefaultRowSql,
  dbResourceInsertRow: dbResourceInsertRowSql,
  dbResourceUpdateRow: dbResourceUpdateRowSql,
  dbResourceDeleteRow: dbResourceDeleteRowSql,
  dbResourceCreateTable: dbResourceCreateTableSql,
  dbResourceRenameTable: dbResourceRenameTableSql,
  dbResourceDropTable: dbResourceDropTableSql,
  dbResourceDropTableIfExists: dbResourceDropTableIfExistsSql,
  dbResourceAddColumn: dbResourceAddColumnSql,
  dbResourceRenameColumn: dbResourceRenameColumnSql,
  dbResourceDropColumn: dbResourceDropColumnSql,
  dbResourceCreateIndex: dbResourceCreateIndexSql,
  dbResourceDropIndex: dbResourceDropIndexSql,
  dbResourceCopyTableRows: dbResourceCopyTableRowsSql,
  dbResourceReadUserTables: dbResourceReadUserTablesSql,
  dbResourceReadTableSchema: dbResourceReadTableSchemaSql,
  dbResourceReadIndexXinfo: dbResourceReadIndexXinfoSql,
  dbResourceFindForeignKeyViolations: dbResourceFindForeignKeyViolationsSql,
  dbResourceFindMissingParentTableViolations: dbResourceFindMissingParentTableViolationsSql,
} satisfies Record<TDatabaseStatementName, string>);

export const DATABASE_STATEMENT_TEMPLATE_MARKERS = Object.freeze({
  canvasItemReadByIds: Object.freeze(['__IDS__']),
  canvasItemReadByIdsAfterId: Object.freeze(['__IDS__']),
  canvasItemReadImageResourceClaims: Object.freeze(['__RESOURCE_IDS__']),
  canvasItemReadImageResourceClaimsExcludingItems: Object.freeze(['__RESOURCE_IDS__', '__EXCLUDED_ITEM_IDS__']),
  migrationSetApplicationId: Object.freeze(['__APPLICATION_ID__']),
  migrationSetUserVersion: Object.freeze(['__USER_VERSION__']),
  resourceControlUpdateApply: Object.freeze(['__EXPECTED_STATUSES__']),
  resourceControlUpdateDraft: Object.freeze(['__EXPECTED_STATUSES__']),
  resourceControlUpdateState: Object.freeze(['__EXPECTED_STATUSES__']),
  schemaContractFindForeignKeyOrphan: Object.freeze(['__CHILD_TABLE__', '__CHILD_ALIAS__', '__CHILD_VALUES_PRESENT__', '__PARENT_TABLE__', '__PARENT_ALIAS__', '__PARENT_MATCHES__']),
  schemaContractReadForeignKeyList: Object.freeze(['__TABLE_IDENTIFIER__']),
  schemaContractReadIndexInfo: Object.freeze(['__INDEX_IDENTIFIER__']),
  schemaContractReadIndexList: Object.freeze(['__TABLE_IDENTIFIER__']),
  schemaContractReadTableInfo: Object.freeze(['__TABLE_IDENTIFIER__']),
  dbResourceReadBrowseRows: Object.freeze(['__SELECT_COLUMNS__', '__TABLE__', '__CURSOR__', '__ORDER__', '__LIMIT__']),
  dbResourceReadRow: Object.freeze(['__COLUMNS__', '__TABLE__', '__IDENTITY__']),
  dbResourceInsertDefaultRow: Object.freeze(['__TABLE__']),
  dbResourceInsertRow: Object.freeze(['__TABLE__', '__COLUMNS__', '__VALUES__']),
  dbResourceUpdateRow: Object.freeze(['__TABLE__', '__ASSIGNMENTS__', '__IDENTITY__', '__EXPECTED__']),
  dbResourceDeleteRow: Object.freeze(['__TABLE__', '__IDENTITY__', '__EXPECTED__']),
  dbResourceCreateTable: Object.freeze(['__TABLE__', '__DEFINITIONS__', '__OPTIONS__']),
  dbResourceRenameTable: Object.freeze(['__TABLE__', '__NEW_TABLE__']),
  dbResourceDropTable: Object.freeze(['__TABLE__']),
  dbResourceDropTableIfExists: Object.freeze(['__TABLE__']),
  dbResourceAddColumn: Object.freeze(['__TABLE__', '__COLUMN__']),
  dbResourceRenameColumn: Object.freeze(['__TABLE__', '__COLUMN__', '__NEW_COLUMN__']),
  dbResourceDropColumn: Object.freeze(['__TABLE__', '__COLUMN__']),
  dbResourceCreateIndex: Object.freeze(['__UNIQUE_PREFIX__', '__INDEX__', '__TABLE__', '__COLUMNS__']),
  dbResourceDropIndex: Object.freeze(['__INDEX__']),
  dbResourceCopyTableRows: Object.freeze(['__TARGET_TABLE__', '__TARGET_COLUMNS__', '__SOURCE_COLUMNS__', '__SOURCE_TABLE__']),
  dbResourceReadIndexXinfo: Object.freeze(['__INDEX_IDENTIFIER__']),
  dbResourceFindForeignKeyViolations: Object.freeze(['__SELECTED__', '__CHILD_TABLE__', '__CHILD_VALUES_PRESENT__', '__PARENT_TABLE__', '__PARENT_MATCH__', '__CHILD_EXPRESSIONS__']),
  dbResourceFindMissingParentTableViolations: Object.freeze(['__SELECTED__', '__CHILD_TABLE__', '__CHILD_VALUES_PRESENT__', '__CHILD_EXPRESSIONS__']),
} as const satisfies Partial<Record<TDatabaseStatementName, readonly string[]>>);

export type TDatabaseStatementTemplateName = keyof typeof DATABASE_STATEMENT_TEMPLATE_MARKERS;

type TDatabaseStatementMarker<TName extends TDatabaseStatementTemplateName> =
  (typeof DATABASE_STATEMENT_TEMPLATE_MARKERS)[TName][number];

export function renderDatabaseStatement<TName extends TDatabaseStatementTemplateName>(
  name: TName,
  replacements: Readonly<Record<TDatabaseStatementMarker<TName>, string>>,
): string {
  const expected = DATABASE_STATEMENT_TEMPLATE_MARKERS[name] as readonly string[];
  const supplied = Object.keys(replacements).sort();
  if (supplied.length !== expected.length || supplied.some((value, index) => value !== [...expected].sort()[index])) {
    throw new TypeError(`Database statement '${name}' received an invalid replacement set.`);
  }
  let sql: string = DATABASE_STATEMENTS[name];
  for (const marker of expected) {
    const replacement = (replacements as Readonly<Record<string, string>>)[marker];
    if (typeof replacement !== 'string' || /[;\u0000]|--|\/\*/.test(replacement)) {
      throw new TypeError(`Database statement '${name}' received an unsafe replacement for ${marker}.`);
    }
    sql = sql.replaceAll(marker, replacement);
  }
  if (/__[A-Z0-9_]+__/.test(sql)) {
    throw new TypeError(`Database statement '${name}' retains an unresolved replacement marker.`);
  }
  return sql;
}

export function databaseParameterPlaceholders(count: number): string {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_024) {
    throw new RangeError('Database parameter placeholder count is outside the supported range.');
  }
  return Array.from({ length: count }, () => '?').join(', ');
}
