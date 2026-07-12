CREATE DOMAIN IF NOT EXISTS DB_RESOURCE_SCHEMA_STATUS AS TEXT
	DEFAULT 'draft'
	NOT NULL
	CONSTRAINT db_resource_schema_status_allowed
		CHECK (value IN ('draft', 'published', 'deprecated'));
--> statement-breakpoint
CREATE DOMAIN IF NOT EXISTS DB_RESOURCE_MIGRATION_STATUS AS TEXT
	DEFAULT 'draft'
	NOT NULL
	CONSTRAINT db_resource_migration_status_allowed
		CHECK (value IN ('draft', 'published'));
--> statement-breakpoint
CREATE DOMAIN IF NOT EXISTS DB_RESOURCE_MIGRATION_BLOCK_REASON AS TEXT
	NOT NULL
	CONSTRAINT db_resource_migration_block_reason_allowed
		CHECK (value IN ('migrating', 'schemaMismatch', 'versionMismatch', 'migrationError'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_schemas` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`name` TEXT NOT NULL CHECK (length(trim(`name`)) > 0),
	`description` TEXT,
	`status` DB_RESOURCE_SCHEMA_STATUS,
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now'))
) STRICT;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `db_resource_schemas_updated_at_after_update`
AFTER UPDATE ON `db_resource_schemas`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `db_resource_schemas`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_schema_migrations` (
	`schema_id` TEXT NOT NULL
		REFERENCES `db_resource_schemas` (`id`)
		ON UPDATE NO ACTION
		ON DELETE RESTRICT,
	`version` INTEGER NOT NULL CHECK (`version` >= 1),
	`name` TEXT NOT NULL CHECK (length(trim(`name`)) > 0),
	`sql` TEXT NOT NULL CHECK (length(trim(`sql`)) > 0),
	`checksum` TEXT NOT NULL CHECK (length(trim(`checksum`)) > 0),
	`status` DB_RESOURCE_MIGRATION_STATUS,
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`published_at` TIMESTAMP,
	PRIMARY KEY (`schema_id`, `version`),
	UNIQUE (`schema_id`, `name`)
) STRICT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_configurations` (
	`resource_id` TEXT PRIMARY KEY NOT NULL
		REFERENCES `actor_resources` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`schema_id` TEXT NOT NULL
		REFERENCES `db_resource_schemas` (`id`)
		ON UPDATE NO ACTION
		ON DELETE RESTRICT,
	`applied_version` INTEGER NOT NULL DEFAULT 0 CHECK (`applied_version` >= 0),
	`target_version` INTEGER NOT NULL DEFAULT 0 CHECK (`target_version` >= 0),
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	CHECK (`target_version` >= `applied_version`)
) STRICT;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `db_resource_configurations_updated_at_after_update`
AFTER UPDATE ON `db_resource_configurations`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `db_resource_configurations`
	SET `updated_at` = datetime('now')
	WHERE `resource_id` = OLD.`resource_id`;
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `db_resource_migration_blocks` (
	`resource_id` TEXT NOT NULL
		REFERENCES `actor_resources` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`actor_instance_id` TEXT NOT NULL
		REFERENCES `actor_instances` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`reason` DB_RESOURCE_MIGRATION_BLOCK_REASON,
	`restart_when_compatible` BOOLEAN NOT NULL DEFAULT false,
	`expected_schema_id` TEXT NOT NULL,
	`expected_version` INTEGER NOT NULL CHECK (`expected_version` >= 0),
	`actual_schema_id` TEXT NOT NULL,
	`actual_version` INTEGER NOT NULL CHECK (`actual_version` >= 0),
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (`resource_id`, `actor_instance_id`)
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `db_resource_migration_blocks_instance_idx`
	ON `db_resource_migration_blocks` (`actor_instance_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `db_resource_migration_blocks_updated_at_after_update`
AFTER UPDATE ON `db_resource_migration_blocks`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `db_resource_migration_blocks`
	SET `updated_at` = datetime('now')
	WHERE `resource_id` = OLD.`resource_id`
		AND `actor_instance_id` = OLD.`actor_instance_id`;
END;
