SELECT * FROM db_resource_drafts
WHERE resource_id = ? AND status = ?
ORDER BY created_at_sec DESC, id DESC
LIMIT ?
-- List recent drafts for a resource and status.
