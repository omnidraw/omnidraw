SELECT DISTINCT
  json_extract(item_json, '$.resourceId') AS resource_id,
  json_extract(item_json, '$.extensions."omnidraw:image".url') AS url,
  json_extract(item_json, '$.extensions."omnidraw:image".mimeType') AS mime_type
FROM canvas_items
WHERE canvas_id = ?
  AND kind = 'image'
  AND json_extract(item_json, '$.resourceId') IN (__RESOURCE_IDS__)
ORDER BY resource_id, url, mime_type
LIMIT ?
