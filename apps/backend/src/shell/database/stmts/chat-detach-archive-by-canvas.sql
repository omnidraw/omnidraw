UPDATE chats
SET canvas_id = NULL, status = 'archived', updated_at_sec = CURRENT_TIMESTAMP
WHERE canvas_id = ?
-- Preserve retained chats while retiring their deleted Canvas scope.
