UPDATE chats
SET canvas_id = ?, name = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ?
