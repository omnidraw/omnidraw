CREATE DOMAIN IF NOT EXISTS CANVAS_MEMBER_ROLE AS TEXT
	DEFAULT 'viewer'
	NOT NULL
	CONSTRAINT canvas_member_role_allowed CHECK (value IN ('owner', 'editor', 'viewer'));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `canvas` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`name` TEXT NOT NULL,
	`automerge_url` TEXT NOT NULL,
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `canvas_name_unique` ON `canvas` (`name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `canvas_members` (
	`canvas_id` TEXT NOT NULL REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE cascade,
	`account_id` TEXT NOT NULL REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	`role` CANVAS_MEMBER_ROLE DEFAULT 'viewer' NOT NULL,
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	`updated_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`canvas_id`, `account_id`)
) STRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `canvas_members_account_id_idx` ON `canvas_members` (`account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `canvas_members_role_idx` ON `canvas_members` (`role`);

CREATE TRIGGER IF NOT EXISTS `canvas_updated_at_after_update`
AFTER UPDATE ON `canvas`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `canvas`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
