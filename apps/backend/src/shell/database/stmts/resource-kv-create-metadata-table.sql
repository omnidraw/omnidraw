CREATE TABLE `_omnidraw_resource_metadata` (
  `singleton` INTEGER PRIMARY KEY CHECK (`singleton` = 1),
  `resource_id` TEXT NOT NULL,
  `resource_kind` TEXT NOT NULL CHECK (`resource_kind` IN ('kv', 'secretStore')),
  `format_version` INTEGER NOT NULL CHECK (`format_version` >= 1)
) STRICT
