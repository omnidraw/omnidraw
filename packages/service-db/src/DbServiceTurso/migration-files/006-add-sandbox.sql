CREATE DOMAIN IF NOT EXISTS SANDBOX_INSTANCE_STATUS AS text
	DEFAULT 'creating'
	NOT NULL
	CONSTRAINT sandbox_instance_status_allowed CHECK (value IN ('creating', 'running', 'stopped', 'missing', 'failed', 'obsolete'));
--> statement-breakpoint

CREATE DOMAIN IF NOT EXISTS SANDBOX_VOLUME_STATUS AS text
	DEFAULT 'creating'
	NOT NULL
	CONSTRAINT sandbox_volume_status_allowed CHECK (value IN ('creating', 'ready', 'missing', 'failed', 'obsolete'));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sandbox_instances` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`namespace` TEXT DEFAULT 'default' NOT NULL,
	`sandbox_name` TEXT NOT NULL,
	`sandbox_tag` TEXT NOT NULL,
	`image` TEXT NOT NULL,
	`setup_hash` TEXT NOT NULL,
	`status` SANDBOX_INSTANCE_STATUS,
	`metadata` JSON DEFAULT '{}' NOT NULL,
	`last_error` TEXT,
	`host_checked_at` TIMESTAMP,
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	`updated_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `sandbox_instances_sandbox_name_unique` ON `sandbox_instances` (`sandbox_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sandbox_instances_tag_idx` ON `sandbox_instances` (`namespace`, `sandbox_tag`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sandbox_instances_image_idx` ON `sandbox_instances` (`image`);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sandbox_instances_updated_at_after_update`
AFTER UPDATE ON `sandbox_instances`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `sandbox_instances`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `sandbox_volumes` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`sandbox_instance_id` TEXT NOT NULL REFERENCES `sandbox_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	`namespace` TEXT DEFAULT 'default' NOT NULL,
	`volume_name` TEXT NOT NULL,
	`volume_tag` TEXT NOT NULL,
	`setup_hash` TEXT NOT NULL,
	`status` SANDBOX_VOLUME_STATUS,
	`reusable` BOOLEAN DEFAULT false NOT NULL,
	`metadata` JSON DEFAULT '{}' NOT NULL,
	`last_error` TEXT,
	`host_checked_at` TIMESTAMP,
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	`updated_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `sandbox_volumes_volume_name_unique` ON `sandbox_volumes` (`volume_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sandbox_volumes_instance_idx` ON `sandbox_volumes` (`sandbox_instance_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sandbox_volumes_tag_idx` ON `sandbox_volumes` (`namespace`, `volume_tag`, `status`);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `sandbox_volumes_updated_at_after_update`
AFTER UPDATE ON `sandbox_volumes`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `sandbox_volumes`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
