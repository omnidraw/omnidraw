SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
FROM db_resource_draft_changes
WHERE draft_id = ?
