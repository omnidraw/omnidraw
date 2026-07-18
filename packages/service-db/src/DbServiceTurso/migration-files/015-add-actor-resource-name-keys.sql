ALTER TABLE `actor_resources`
	ADD COLUMN `name_key` TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `actor_resources_name_key_idx`
	ON `actor_resources` (`name_key`);
