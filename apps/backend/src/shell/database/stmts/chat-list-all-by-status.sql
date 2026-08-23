SELECT *
FROM chats
WHERE status = ?
ORDER BY updated_at_sec DESC, id DESC
LIMIT ?
