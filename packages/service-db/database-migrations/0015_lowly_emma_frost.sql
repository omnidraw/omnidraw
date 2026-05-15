DROP TABLE IF EXISTS `sandbox_volumes`;--> statement-breakpoint
DROP TABLE IF EXISTS `sandbox_instances`;--> statement-breakpoint
CREATE TABLE `sandbox_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text DEFAULT 'default' NOT NULL,
	`sandbox_name` text NOT NULL,
	`sandbox_tag` text NOT NULL,
	`image` text NOT NULL,
	`setup_hash` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`host_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_instances_sandbox_name_unique` ON `sandbox_instances` (`sandbox_name`);--> statement-breakpoint
CREATE INDEX `sandbox_instances_tag_idx` ON `sandbox_instances` (`namespace`,`sandbox_tag`,`status`);--> statement-breakpoint
CREATE INDEX `sandbox_instances_image_idx` ON `sandbox_instances` (`image`);--> statement-breakpoint
CREATE TABLE `sandbox_volumes` (
	`id` text PRIMARY KEY NOT NULL,
	`sandbox_instance_id` text NOT NULL,
	`namespace` text DEFAULT 'default' NOT NULL,
	`volume_name` text NOT NULL,
	`volume_tag` text NOT NULL,
	`setup_hash` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`reusable` integer DEFAULT false NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`host_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sandbox_instance_id`) REFERENCES `sandbox_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_volumes_volume_name_unique` ON `sandbox_volumes` (`volume_name`);--> statement-breakpoint
CREATE INDEX `sandbox_volumes_instance_idx` ON `sandbox_volumes` (`sandbox_instance_id`);--> statement-breakpoint
CREATE INDEX `sandbox_volumes_tag_idx` ON `sandbox_volumes` (`namespace`,`volume_tag`,`status`);