PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actor_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_definition_id` text NOT NULL,
	`version` integer NOT NULL,
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
INSERT INTO `__new_actor_revisions`("id", "actor_definition_id", "version", "machine_schema", "machine_config", "contract_schema", "output_schema", "server_manifest", "ui_manifest", "server_bundle_file_id", "ui_bundle_file_id", "source_archive_file_id", "created_by_system_id", "created_at") SELECT "id", "actor_definition_id", ROW_NUMBER() OVER (PARTITION BY "actor_definition_id" ORDER BY "created_at", "id"), "machine_schema", "machine_config", "contract_schema", "output_schema", "server_manifest", "ui_manifest", "server_bundle_file_id", "ui_bundle_file_id", "source_archive_file_id", "created_by_system_id", "created_at" FROM `actor_revisions`;--> statement-breakpoint
DROP TABLE `actor_revisions`;--> statement-breakpoint
ALTER TABLE `__new_actor_revisions` RENAME TO `actor_revisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `actor_revisions_definition_version_idx` ON `actor_revisions` (`actor_definition_id`,`version`);--> statement-breakpoint
ALTER TABLE `actor_definitions` DROP COLUMN `current_revision_id`;