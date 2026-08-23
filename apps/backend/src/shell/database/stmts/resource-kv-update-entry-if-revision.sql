UPDATE resource_entries
SET value = ?, revision = revision + 1
WHERE key = ? AND revision = ?
