DROP TABLE `actor_revisions`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actor_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`canvas_id` text NOT NULL,
	`element_id` text NOT NULL,
	`actor_definition_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`machine_state` text NOT NULL,
	`machine_context` text DEFAULT '{}' NOT NULL,
	`workflow_run_id` text,
	`created_by_system_id` text DEFAULT 'system' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_definition_id`) REFERENCES `actor_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_actor_instances`("id", "workspace_id", "canvas_id", "element_id", "actor_definition_id", "display_name", "status", "machine_state", "machine_context", "workflow_run_id", "created_by_system_id", "created_at") SELECT "id", "workspace_id", "canvas_id", "element_id", "actor_definition_id", "display_name", "status", "machine_state", "machine_context", "workflow_run_id", "created_by_system_id", "created_at" FROM `actor_instances`;--> statement-breakpoint
DROP TABLE `actor_instances`;--> statement-breakpoint
ALTER TABLE `__new_actor_instances` RENAME TO `actor_instances`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `actor_instances_canvas_idx` ON `actor_instances` (`canvas_id`);--> statement-breakpoint
CREATE INDEX `actor_instances_status_idx` ON `actor_instances` (`status`);--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `widget_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `widget_dir` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `actor_json_path` text DEFAULT 'actor/actor.json' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `functions_path` text DEFAULT 'actor/functions.ts' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `machine_schema` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `machine_config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `contract_schema` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `output_schema` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `server_manifest` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `ui_manifest` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `actor_definitions` SET `updated_at` = unixepoch() WHERE `updated_at` = 0;--> statement-breakpoint
CREATE INDEX `actor_definitions_widget_id_idx` ON `actor_definitions` (`widget_id`);