SELECT *
FROM chats
WHERE canvas_id IS NULL
ORDER BY updated_at_sec DESC, id DESC
LIMIT ?
