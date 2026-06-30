
CREATE TABLE IF NOT EXISTS `file_systems` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`name` TEXT NOT NULL UNIQUE,
	`slug` TEXT NOT NULL UNIQUE,
	`path` TEXT NOT NULL,
	`description` TEXT,
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	`updated_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS `file_systems_slug_idx` ON `file_systems` (`slug`);

CREATE TRIGGER IF NOT EXISTS `file_systems_updated_at_after_update`
AFTER UPDATE ON `file_systems`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `file_systems`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
