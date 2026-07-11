CREATE TABLE IF NOT EXISTS `tool_groups` (
	`name` TEXT PRIMARY KEY NOT NULL,
	`json` JSON,
	CONSTRAINT `tool_groups_name_not_empty`
		CHECK (length(trim(`name`)) > 0)
) STRICT;
