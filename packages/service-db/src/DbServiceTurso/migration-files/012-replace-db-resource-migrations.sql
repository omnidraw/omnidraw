DROP TABLE IF EXISTS `db_resource_migration_blocks`;
--> statement-breakpoint
DROP TABLE IF EXISTS `db_resource_configurations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `db_resource_schema_migrations`;
--> statement-breakpoint
DROP TABLE IF EXISTS `db_resource_schemas`;
--> statement-breakpoint
DROP DOMAIN IF EXISTS DB_RESOURCE_MIGRATION_BLOCK_REASON;
--> statement-breakpoint
DROP DOMAIN IF EXISTS DB_RESOURCE_MIGRATION_STATUS;
--> statement-breakpoint
DROP DOMAIN IF EXISTS DB_RESOURCE_SCHEMA_STATUS;
--> statement-breakpoint
CREATE DOMAIN IF NOT EXISTS DB_RESOURCE_DRAFT_STATUS AS TEXT
	DEFAULT 'editing'
	NOT NULL
	CONSTRAINT db_resource_draft_status_allowed
		CHECK (value IN ('editing', 'applying', 'applied', 'discarded', 'error'));
--> statement-breakpoint
CREATE DOMAIN IF NOT EXISTS DB_RESOURCE_DRAFT_CHANGE_KIND AS TEXT
	NOT NULL
	CONSTRAINT db_resource_draft_change_kind_allowed
		CHECK (value IN ('structure', 'sql'));
--> statement-breakpoint
CREATE DOMAIN IF NOT EXISTS DB_RESOURCE_APPLY_STATUS AS TEXT
	DEFAULT 'preparing'
	NOT NULL
	CONSTRAINT db_resource_apply_status_allowed
		CHECK (value IN ('preparing', 'stopping', 'applying', 'restarting', 'succeeded', 'failed', 'recovered'));
--> statement-breakpoint
CREATE DOMAIN IF NOT EXISTS DB_RESOURCE_APPLY_INSTANCE_STATUS AS TEXT
	NOT NULL
	CONSTRAINT db_resource_apply_instance_status_allowed
		CHECK (value IN (
			'notRunning', 'pendingStop', 'stopped', 'stopFailed',
			'pendingRestart', 'restarted', 'startFailed', 'crashed'
		));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_drafts` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`resource_id` TEXT NOT NULL
		REFERENCES `actor_resources` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`name` TEXT NOT NULL CHECK (length(trim(`name`)) > 0),
	`status` DB_RESOURCE_DRAFT_STATUS,
	`last_error` JSON CHECK (`last_error` IS NULL OR json_valid(`last_error`)),
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`applied_at` TIMESTAMP
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `db_resource_drafts_resource_idx`
	ON `db_resource_drafts` (`resource_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `db_resource_drafts_one_active_idx`
	ON `db_resource_drafts` (`resource_id`)
	WHERE `status` IN ('editing', 'applying');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `db_resource_drafts_updated_at_after_update`
AFTER UPDATE ON `db_resource_drafts`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `db_resource_drafts`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_draft_changes` (
	`draft_id` TEXT NOT NULL
		REFERENCES `db_resource_drafts` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`sequence` INTEGER NOT NULL CHECK (`sequence` >= 1),
	`kind` DB_RESOURCE_DRAFT_CHANGE_KIND,
	`operation` JSON CHECK (`operation` IS NULL OR json_valid(`operation`)),
	`sql` TEXT NOT NULL CHECK (length(trim(`sql`)) > 0),
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (`draft_id`, `sequence`)
) STRICT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_apply_runs` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`resource_id` TEXT NOT NULL
		REFERENCES `actor_resources` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`draft_id` TEXT
		REFERENCES `db_resource_drafts` (`id`)
		ON UPDATE NO ACTION
		ON DELETE SET NULL,
	`status` DB_RESOURCE_APPLY_STATUS,
	`last_error` JSON CHECK (`last_error` IS NULL OR json_valid(`last_error`)),
	`backup_retained` BOOLEAN NOT NULL DEFAULT false,
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`completed_at` TIMESTAMP
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `db_resource_apply_runs_resource_idx`
	ON `db_resource_apply_runs` (`resource_id`, `created_at`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `db_resource_apply_runs_one_active_idx`
	ON `db_resource_apply_runs` (`resource_id`)
	WHERE `status` IN ('preparing', 'stopping', 'applying', 'restarting');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_apply_instance_results` (
	`apply_id` TEXT NOT NULL
		REFERENCES `db_resource_apply_runs` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`actor_instance_id` TEXT NOT NULL
		REFERENCES `actor_instances` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`actor_definition_name` TEXT NOT NULL,
	`was_running` BOOLEAN NOT NULL,
	`status` DB_RESOURCE_APPLY_INSTANCE_STATUS,
	`error` JSON CHECK (`error` IS NULL OR json_valid(`error`)),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (`apply_id`, `actor_instance_id`)
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `db_resource_apply_instance_results_instance_idx`
	ON `db_resource_apply_instance_results` (`actor_instance_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `db_resource_apply_instance_results_updated_at_after_update`
AFTER UPDATE ON `db_resource_apply_instance_results`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `db_resource_apply_instance_results`
	SET `updated_at` = datetime('now')
	WHERE `apply_id` = OLD.`apply_id`
		AND `actor_instance_id` = OLD.`actor_instance_id`;
END;
