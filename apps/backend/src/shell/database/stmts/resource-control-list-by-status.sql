SELECT *
FROM resource_catalog
WHERE status = ?
ORDER BY created_at_sec ASC, id ASC
