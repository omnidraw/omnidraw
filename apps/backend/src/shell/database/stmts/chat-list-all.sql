SELECT *
FROM chats
ORDER BY updated_at_sec DESC, id DESC
LIMIT ?
