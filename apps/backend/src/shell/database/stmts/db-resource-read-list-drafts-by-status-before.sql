SELECT *
FROM db_resource_drafts
WHERE resource_id = ? AND status = ?
  AND (created_at_sec < ? OR (created_at_sec = ? AND id < ?))
ORDER BY created_at_sec DESC, id DESC
LIMIT ?
