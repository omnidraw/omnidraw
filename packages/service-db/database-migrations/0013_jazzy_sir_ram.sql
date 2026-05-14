CREATE TABLE `sandbox_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text,
	`workflow_step_id` text,
	`portal_kind` text NOT NULL,
	`function_name` text NOT NULL,
	`idempotency_key` text,
	`portal_spec` text DEFAULT 'null' NOT NULL,
	`input` text DEFAULT 'null' NOT NULL,
	`sandbox_name` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	`stdout_file_id` text,
	`stderr_file_id` text,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workflow_step_id`) REFERENCES `workflow_steps`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stdout_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stderr_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sandbox_runs_step_idx` ON `sandbox_runs` (`workflow_step_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`canvas_id` text,
	`run_id` text NOT NULL,
	`workflow_kind` text NOT NULL,
	`subject_id` text,
	`trigger_id` text,
	`correlation_id` text NOT NULL,
	`causation_id` text,
	`current_step_index` integer DEFAULT 0 NOT NULL,
	`step_count` integer NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_heartbeat_at` integer,
	`completed_at` integer,
	`error` text,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_run_id_unique` ON `workflow_runs` (`run_id`);--> statement-breakpoint
CREATE INDEX `workflow_runs_status_idx` ON `workflow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `workflow_runs_kind_idx` ON `workflow_runs` (`workflow_kind`);--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`sandbox_run_id` text,
	`step_key` text NOT NULL,
	`step_index` integer NOT NULL,
	`phase` text,
	`function_kind` text NOT NULL,
	`function_name` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`portal_spec` text DEFAULT 'null' NOT NULL,
	`args` text DEFAULT 'null' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`error` text,
	`claimed_by_run_id` text,
	`claimed_at` integer,
	`lease_expires_at` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflow_steps_run_index_idx` ON `workflow_steps` (`workflow_run_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `workflow_steps_tx_idempotency_idx` ON `workflow_steps` (`function_kind`,`idempotency_key`);