SELECT *
FROM chats
WHERE canvas_id = ? AND status = ?
ORDER BY updated_at_sec DESC, id DESC
LIMIT ?
