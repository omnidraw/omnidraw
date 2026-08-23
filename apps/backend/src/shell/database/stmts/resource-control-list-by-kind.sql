SELECT *
FROM resource_catalog
WHERE kind = ?
ORDER BY created_at_sec ASC, id ASC
