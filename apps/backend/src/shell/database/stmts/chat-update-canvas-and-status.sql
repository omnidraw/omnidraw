UPDATE chats
SET canvas_id = ?, status = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ?
