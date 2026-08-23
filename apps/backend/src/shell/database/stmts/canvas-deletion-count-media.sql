SELECT COUNT(*) AS count
FROM media_files
WHERE canvas_id = ?
-- Count Canvas-scoped media for an exact deletion plan.
