SELECT COALESCE(MAX(`sequence`), 0) + 1 AS `next_sequence`
FROM `_omnidraw_draft_change_evidence`
