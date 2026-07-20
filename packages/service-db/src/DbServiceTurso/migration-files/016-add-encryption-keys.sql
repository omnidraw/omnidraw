CREATE TABLE IF NOT EXISTS `encryption_keys` (
	`id` TEXT PRIMARY KEY NOT NULL
		CHECK (length(trim(`id`)) > 0),
	`purpose` TEXT NOT NULL
		CHECK (length(trim(`purpose`)) > 0),
	`algorithm` TEXT NOT NULL
		CHECK (length(trim(`algorithm`)) > 0),
	`key_hex` TEXT NOT NULL
		CHECK (
			length(`key_hex`) BETWEEN 2 AND 8192
			AND length(`key_hex`) % 2 = 0
			AND `key_hex` NOT GLOB '*[^0-9a-f]*'
		),
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now'))
) STRICT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `actor_resource_encryption_keys` (
	`actor_resource_id` TEXT PRIMARY KEY NOT NULL
		REFERENCES `actor_resources` (`id`)
		ON UPDATE NO ACTION
		ON DELETE CASCADE,
	`encryption_key_id` TEXT NOT NULL UNIQUE
		REFERENCES `encryption_keys` (`id`)
		ON UPDATE NO ACTION
		ON DELETE RESTRICT,
	`created_at` TIMESTAMP NOT NULL DEFAULT (datetime('now'))
) STRICT;
