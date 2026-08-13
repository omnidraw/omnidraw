CREATE TABLE IF NOT EXISTS `_omnidraw_apply_markers` (
  `apply_id` TEXT PRIMARY KEY NOT NULL,
  `applied_at` TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT
