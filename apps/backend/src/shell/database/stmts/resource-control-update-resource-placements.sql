UPDATE resource_placements
SET
  cell_id = ?,
  placement_epoch = ?,
  relative_path = ?,
  status = ?,
  updated_at_sec = CURRENT_TIMESTAMP
WHERE resource_id = ? AND placement_epoch = ?
