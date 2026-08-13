SELECT * FROM db_resource_drafts
WHERE resource_id = ?
ORDER BY created_at_sec DESC, id DESC
LIMIT ?
