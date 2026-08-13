UPDATE db_resource_drafts
SET name = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ? AND status = 'editing'
-- Rename an editable draft.
