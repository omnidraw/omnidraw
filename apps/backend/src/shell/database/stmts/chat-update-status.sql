UPDATE chats
SET status = ?, updated_at_sec = CURRENT_TIMESTAMP
WHERE id = ?
