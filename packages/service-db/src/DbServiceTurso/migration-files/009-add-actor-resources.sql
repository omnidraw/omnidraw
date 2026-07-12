CREATE DOMAIN IF NOT EXISTS ACTOR_RESOURCE_KIND AS TEXT
	NOT NULL
	CONSTRAINT actor_resource_kind_allowed
		CHECK (value IN ('kv', 'secretStore', 'db'));
--> statement-breakpoint
CREATE DOMAIN IF NOT EXISTS ACTOR_RESOURCE_STATUS AS TEXT
	DEFAULT 'created'
	NOT NULL
	CONSTRAINT actor_resource_status_allowed
		CHECK (value IN ('created', 'provisioning', 'ready', 'migrating', 'error', 'deleting'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `actor_resources` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`kind` ACTOR_RESOURCE_KIND,
	`name` TEXT NOT NULL CHECK (length(trim(`name`)) > 0),
	`status` ACTOR_RESOURCE_STATUS,
	`last_error` JSON,
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now'))
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `actor_resources_kind_idx`
	ON `actor_resources` (`kind`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `actor_resources_updated_at_after_update`
AFTER UPDATE ON `actor_resources`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `actor_resources`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `actor_resource_bindings` (
	`actor_definition_name` TEXT NOT NULL
		REFERENCES `actor_definitions` (`name`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`slot_name` TEXT NOT NULL CHECK (length(trim(`slot_name`)) > 0),
	`resource_id` TEXT NOT NULL
		REFERENCES `actor_resources` (`id`)
		ON UPDATE NO ACTION
		ON DELETE RESTRICT,
	`allow_read` BOOLEAN NOT NULL,
	`allow_write` BOOLEAN NOT NULL,
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	CHECK (`allow_read` OR `allow_write`),
	PRIMARY KEY (`actor_definition_name`, `slot_name`)
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `actor_resource_bindings_resource_idx`
	ON `actor_resource_bindings` (`resource_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `actor_resource_bindings_updated_at_after_update`
AFTER UPDATE ON `actor_resource_bindings`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `actor_resource_bindings`
	SET `updated_at` = datetime('now')
	WHERE `actor_definition_name` = OLD.`actor_definition_name`
		AND `slot_name` = OLD.`slot_name`;
END;
