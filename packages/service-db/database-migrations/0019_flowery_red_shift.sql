DROP INDEX `actor_definitions_widget_id_idx`;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `input_schema` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` ADD `widget_config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `widget_id`;--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `widget_dir`;--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `actor_json_path`;--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `machine_schema`;--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `contract_schema`;--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `ui_manifest`;--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `created_by_system_id`;