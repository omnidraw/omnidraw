UPDATE chats
SET name = ?, status = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ?
