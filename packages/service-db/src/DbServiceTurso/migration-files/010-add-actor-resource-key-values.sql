CREATE TABLE IF NOT EXISTS `actor_resource_key_values` (
	`resource_id` TEXT NOT NULL
		REFERENCES `actor_resources` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`key` TEXT NOT NULL CHECK (length(trim(`key`)) > 0),
	`value` JSON NOT NULL,
	`revision` INTEGER NOT NULL DEFAULT 1 CHECK (`revision` >= 1),
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	`updated_at` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (`resource_id`, `key`)
) STRICT;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `actor_resource_key_values_updated_at_after_update`
AFTER UPDATE ON `actor_resource_key_values`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `actor_resource_key_values`
	SET `updated_at` = datetime('now')
	WHERE `resource_id` = OLD.`resource_id`
		AND `key` = OLD.`key`;
END;
