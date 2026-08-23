UPDATE resource_catalog
SET name = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ?
