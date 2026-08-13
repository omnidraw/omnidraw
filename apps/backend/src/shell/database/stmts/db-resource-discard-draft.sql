UPDATE db_resource_drafts
SET
  status = 'discarded',
  last_error_json = ?,
  applied_at_sec = NULL,
  updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ? AND status IN ('editing', 'error')
-- Discard an editable or failed draft.
