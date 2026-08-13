CREATE TABLE `resource_entries` (
  `key` TEXT PRIMARY KEY,
  `value` JSON NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 1 CHECK (`revision` >= 1),
  `created_at` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  `updated_at` TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT
