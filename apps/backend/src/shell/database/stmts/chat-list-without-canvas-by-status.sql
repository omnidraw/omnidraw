SELECT *
FROM chats
WHERE canvas_id IS NULL AND status = ?
ORDER BY updated_at_sec DESC, id DESC
LIMIT ?
