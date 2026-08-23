SELECT COUNT(*) AS count
FROM canvas_items
WHERE canvas_id = ?
-- Count Canvas-owned authored items for an exact deletion plan.
