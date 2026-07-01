
-- ONLY ONE VALUE MUST BE NOT NULL
CREATE TABLE IF NOT EXISTS `kv` (
	`name` TEXT PRIMARY KEY NOT NULL,
	`text` TEXT,
	`json` JSON,
	`number` INTEGER,
	`bool` BOOLEAN,
	CONSTRAINT `kv_exactly_one_value_not_null` CHECK (
		(`text` IS NOT NULL) +
		(`json` IS NOT NULL) +
		(`number` IS NOT NULL) +
		(`bool` IS NOT NULL) = 1
	)
) STRICT;
