PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `__new_actor_inbox`;--> statement-breakpoint
CREATE TABLE `__new_actor_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`canvas_id` text NOT NULL,
	`actor_instance_id` text NOT NULL,
	`seq` integer NOT NULL,
	`message_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`causation_id` text,
	`idempotency_key` text NOT NULL,
	`source_actor_instance_id` text,
	`source_output_id` text,
	`connection_id` text,
	`event_name` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`claimed_by_run_id` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer,
	`error` text,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_instance_id`) REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_actor_instance_id`) REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `actor_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_actor_inbox`("id", "workspace_id", "canvas_id", "actor_instance_id", "seq", "message_id", "correlation_id", "causation_id", "idempotency_key", "source_actor_instance_id", "source_output_id", "connection_id", "event_name", "params", "status", "claimed_by_run_id", "attempt", "created_at", "processed_at", "error") SELECT "id", "workspace_id", "canvas_id", "actor_instance_id", "seq", "message_id", "correlation_id", "causation_id", "idempotency_key", "source_actor_instance_id", "source_output_id", "connection_id", "event_name", "params", "status", "claimed_by_run_id", "attempt", "created_at", "processed_at", "error" FROM `actor_inbox`
WHERE EXISTS (SELECT 1 FROM `canvas` WHERE `canvas`.`id` = `actor_inbox`.`canvas_id`)
  AND EXISTS (SELECT 1 FROM `actor_instances` WHERE `actor_instances`.`id` = `actor_inbox`.`actor_instance_id`)
  AND (`actor_inbox`.`source_actor_instance_id` IS NULL OR EXISTS (SELECT 1 FROM `actor_instances` WHERE `actor_instances`.`id` = `actor_inbox`.`source_actor_instance_id`))
  AND (`actor_inbox`.`connection_id` IS NULL OR EXISTS (SELECT 1 FROM `actor_connections` WHERE `actor_connections`.`id` = `actor_inbox`.`connection_id`));--> statement-breakpoint
DROP TABLE `actor_inbox`;--> statement-breakpoint
ALTER TABLE `__new_actor_inbox` RENAME TO `actor_inbox`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `actor_inbox_message_id_unique` ON `actor_inbox` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `actor_inbox_idempotency_key_unique` ON `actor_inbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `actor_inbox_queue_idx` ON `actor_inbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `actor_inbox_actor_seq_idx` ON `actor_inbox` (`actor_instance_id`,`seq`);