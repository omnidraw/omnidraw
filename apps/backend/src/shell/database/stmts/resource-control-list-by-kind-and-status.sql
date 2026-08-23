SELECT *
FROM resource_catalog
WHERE kind = ? AND status = ?
ORDER BY created_at_sec ASC, id ASC
