SELECT key, value, revision, created_at, updated_at
FROM resource_entries
WHERE (? IS NULL OR substr(key, 1, length(?)) = ?)
  AND (? IS NULL OR instr(key, ?) > 0)
  AND (? IS NULL OR key > ?)
ORDER BY key ASC
LIMIT ?
