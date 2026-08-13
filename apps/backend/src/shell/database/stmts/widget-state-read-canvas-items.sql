SELECT 1 AS present
FROM canvas_items
WHERE canvas_id = ?
  AND id = ?
  AND widget_instance_id = ?
LIMIT 1
