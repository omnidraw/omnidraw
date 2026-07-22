ALTER TABLE collaboration_documents
  ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0 CHECK (content_version >= 0);

CREATE TABLE widget_instance_projection_heads (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  canvas_id TEXT NOT NULL CHECK (
    length(canvas_id) = 36 AND canvas_id = lower(canvas_id)
    AND substr(canvas_id, 9, 1) = '-' AND substr(canvas_id, 14, 1) = '-'
    AND substr(canvas_id, 19, 1) = '-' AND substr(canvas_id, 24, 1) = '-'
    AND length(replace(canvas_id, '-', '')) = 32
    AND replace(canvas_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  source_sequence INTEGER NOT NULL CHECK (source_sequence >= 0),
  snapshot_digest_sha256 TEXT NOT NULL CHECK (
    length(snapshot_digest_sha256) = 64
    AND snapshot_digest_sha256 = lower(snapshot_digest_sha256)
    AND snapshot_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  projected_at_ms INTEGER NOT NULL CHECK (projected_at_ms >= 0),
  PRIMARY KEY (org_id, canvas_id),
  FOREIGN KEY (org_id, canvas_id)
    REFERENCES canvases (org_id, id) ON DELETE CASCADE
) STRICT;
