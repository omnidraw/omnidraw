CREATE TABLE IF NOT EXISTS `automerge_repo_data` (
	`key` TEXT PRIMARY KEY NOT NULL,
	`updated_at` TEXT DEFAULT (datetime()) NOT NULL,
	`data` BLOB NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `automerge_keys` ON `automerge_repo_data` (`key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `automerge_updated_at` ON `automerge_repo_data` (`updated_at`);
