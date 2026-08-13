DELETE FROM resource_entries
WHERE key = ? AND (? IS NULL OR revision = ?)
