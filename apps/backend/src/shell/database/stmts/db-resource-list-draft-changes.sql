SELECT *
FROM db_resource_draft_changes
WHERE draft_id = ?
ORDER BY sequence ASC
-- List all ordered changes for a draft.
