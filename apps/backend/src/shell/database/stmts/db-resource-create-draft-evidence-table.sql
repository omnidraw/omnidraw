CREATE TABLE IF NOT EXISTS `_omnidraw_draft_change_evidence` (
  `sequence` INTEGER PRIMARY KEY NOT NULL CHECK (`sequence` >= 1),
  `kind` TEXT NOT NULL CHECK (`kind` IN ('structure', 'sql')),
  `sql` TEXT NOT NULL CHECK (length(trim(`sql`)) > 0)
) STRICT
