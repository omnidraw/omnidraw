
CREATE TABLE IF NOT EXISTS `actor_definitions` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`name` TEXT NOT NULL,
	`slug` TEXT NOT NULL,
	`url` TEXT,
	`description` TEXT,
	`manifest_path` TEXT NOT NULL CHECK (manifest_path LIKE '/%'),
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	`updated_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS `actor_definitions_slug_unique` ON `actor_definitions` (`slug`);
CREATE INDEX IF NOT EXISTS `actor_definitions_slug_idx` ON `actor_definitions` (`slug`);

CREATE TRIGGER IF NOT EXISTS `actor_updated_at_after_update`
AFTER UPDATE ON `actor_definitions`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `actor_definitions`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
--
CREATE DOMAIN IF NOT EXISTS ACTOR_SYSTEM_STATUS AS TEXT
	DEFAULT 'created'
	NOT NULL
	CONSTRAINT actor_system_status_allowed CHECK (value IN ('created', 'starting', 'running', 'paused', 'stopping', 'stopped', 'error', 'blocked'));

CREATE TABLE IF NOT EXISTS `actor_instances` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`canvas_id` TEXT NOT NULL REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	`element_id` TEXT NOT NULL, -- canvas element
	`actor_definition_id` TEXT NOT NULL REFERENCES `actor_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	`filesystem_id` TEXT REFERENCES `file_systems`(`id`) ON UPDATE no action ON DELETE SET NULL,
	`display_name` TEXT NOT NULL,
	`status` ACTOR_SYSTEM_STATUS,
	`machine_state` TEXT NOT NULL,
	`machine_context` JSON DEFAULT '{}' NOT NULL,
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	`updated_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `actor_instances_canvas_idx` ON `actor_instances` (`canvas_id`);
CREATE INDEX IF NOT EXISTS `actor_instances_element_idx` ON `actor_instances` (`element_id`);
CREATE INDEX IF NOT EXISTS `actor_instances_status_idx` ON `actor_instances` (`status`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `actor_instances_updated_at_after_update`
AFTER UPDATE ON `actor_instances`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `actor_instances`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
--
CREATE TABLE IF NOT EXISTS `actor_inbox` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `actor_instance_id` TEXT NOT NULL REFERENCES `actor_instances`(`id`) ON DELETE CASCADE,
  `seq` INTEGER NOT NULL CHECK (seq >= 0),
  `msg_name` TEXT NOT NULL,
  `payload` JSON,
  `idempotency_key` UUID NOT NULL,
  `status` TEXT DEFAULT 'queued' NOT NULL CHECK (status IN ('queued', 'processing', 'processed', 'failed')),
  `created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
  `processed_at` TIMESTAMP,
  `error` TEXT
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS `actor_inbox_actor_seq_idx` ON `actor_inbox` (`actor_instance_id`, `seq`);
--
CREATE TABLE IF NOT EXISTS `actor_connections` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`canvas_id` TEXT NOT NULL REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	`source_actor_instance_id` TEXT NOT NULL REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	`target_actor_instance_id` TEXT NOT NULL REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	`enabled` BOOLEAN DEFAULT true NOT NULL,
	`label` TEXT,
	`msg_name_whitelist` TEXT,
	`style` JSON DEFAULT '{}' NOT NULL, -- used by canvas to render connection differently
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `actor_connections_source_idx` ON `actor_connections` (`source_actor_instance_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `actor_connections_target_idx` ON `actor_connections` (`target_actor_instance_id`);
