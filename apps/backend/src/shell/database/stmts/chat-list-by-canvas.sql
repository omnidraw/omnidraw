SELECT *
FROM chats
WHERE canvas_id = ?
ORDER BY updated_at_sec DESC, id DESC
LIMIT ?
