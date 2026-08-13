SELECT key, CAST(value AS TEXT) AS serialized_value, revision, created_at, updated_at
FROM resource_entries
WHERE (? IS NULL OR key > ?)
ORDER BY key ASC
LIMIT ?
