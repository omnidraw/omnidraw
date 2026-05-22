CREATE TABLE IF NOT EXISTS `files` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`format` text NOT NULL,
	`base64` text NOT NULL,
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS `files_hash_idx` ON `files` (`hash`);
