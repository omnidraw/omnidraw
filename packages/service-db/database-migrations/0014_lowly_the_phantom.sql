CREATE TABLE `actor_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`source_element_id` text NOT NULL,
	`source_actor_instance_id` text NOT NULL,
	`target_element_id` text NOT NULL,
	`target_actor_instance_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`label` text,
	`event_name_whitelist` text,
	`style` text DEFAULT '{}' NOT NULL,
	`created_by_system_id` text DEFAULT 'system' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_actor_instance_id`) REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_actor_instance_id`) REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `actor_connections_source_idx` ON `actor_connections` (`source_actor_instance_id`);--> statement-breakpoint
CREATE INDEX `actor_connections_target_idx` ON `actor_connections` (`target_actor_instance_id`);--> statement-breakpoint
CREATE TABLE `actor_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`current_revision_id` text,
	`created_by_system_id` text DEFAULT 'system' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actor_definitions_slug_unique` ON `actor_definitions` (`slug`);--> statement-breakpoint
CREATE INDEX `actor_definitions_slug_idx` ON `actor_definitions` (`slug`);--> statement-breakpoint
CREATE TABLE `actor_inbox` (
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
	FOREIGN KEY (`source_actor_instance_id`) REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`connection_id`) REFERENCES `actor_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actor_inbox_message_id_unique` ON `actor_inbox` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `actor_inbox_idempotency_key_unique` ON `actor_inbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `actor_inbox_queue_idx` ON `actor_inbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `actor_inbox_actor_seq_idx` ON `actor_inbox` (`actor_instance_id`,`seq`);--> statement-breakpoint
CREATE TABLE `actor_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`canvas_id` text NOT NULL,
	`element_id` text NOT NULL,
	`actor_definition_id` text NOT NULL,
	`actor_revision_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`machine_state` text NOT NULL,
	`machine_context` text DEFAULT '{}' NOT NULL,
	`workflow_run_id` text,
	`created_by_system_id` text DEFAULT 'system' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_definition_id`) REFERENCES `actor_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_revision_id`) REFERENCES `actor_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `actor_instances_canvas_idx` ON `actor_instances` (`canvas_id`);--> statement-breakpoint
CREATE INDEX `actor_instances_status_idx` ON `actor_instances` (`status`);--> statement-breakpoint
CREATE TABLE `actor_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`canvas_id` text NOT NULL,
	`actor_instance_id` text NOT NULL,
	`seq` integer NOT NULL,
	`output_id` text NOT NULL,
	`message_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`causation_id` text,
	`output_name` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`machine_state` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`workflow_run_id` text,
	`workflow_step_id` text,
	`commit_status` text DEFAULT 'committed' NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_instance_id`) REFERENCES `actor_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workflow_step_id`) REFERENCES `workflow_steps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actor_outputs_output_id_unique` ON `actor_outputs` (`output_id`);--> statement-breakpoint
CREATE INDEX `actor_outputs_actor_seq_idx` ON `actor_outputs` (`actor_instance_id`,`seq`);--> statement-breakpoint
CREATE INDEX `actor_outputs_message_idx` ON `actor_outputs` (`message_id`);--> statement-breakpoint
CREATE TABLE `actor_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_definition_id` text NOT NULL,
	`version` text NOT NULL,
	`revision_hash` text NOT NULL,
	`parent_revision_id` text,
	`machine_schema` text DEFAULT '{}' NOT NULL,
	`machine_config` text DEFAULT '{}' NOT NULL,
	`contract_schema` text DEFAULT '{}' NOT NULL,
	`output_schema` text DEFAULT '{}' NOT NULL,
	`server_manifest` text DEFAULT '{}' NOT NULL,
	`ui_manifest` text DEFAULT '{}' NOT NULL,
	`server_bundle_file_id` text,
	`ui_bundle_file_id` text,
	`source_archive_file_id` text,
	`created_by_system_id` text DEFAULT 'system' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_definition_id`) REFERENCES `actor_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_bundle_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ui_bundle_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_archive_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `actor_revisions_definition_idx` ON `actor_revisions` (`actor_definition_id`);--> statement-breakpoint
CREATE INDEX `actor_revisions_hash_idx` ON `actor_revisions` (`revision_hash`);