SELECT *
FROM db_resource_drafts
WHERE resource_id = ? AND status IN ('editing', 'applying')
ORDER BY created_at_sec DESC, id DESC
LIMIT 1
-- Read the newest active draft for a resource.
