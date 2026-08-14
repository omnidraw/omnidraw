SELECT COUNT(*) AS count
FROM chats
WHERE canvas_id = ?
-- Count retained chats attached to an exact Canvas.
