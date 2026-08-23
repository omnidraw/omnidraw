UPDATE chats
SET canvas_id = ?, name = ?, status = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ?
