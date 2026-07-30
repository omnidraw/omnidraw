-- Preview-only generated source maps remain trusted metadata outside Capsule
-- artifacts and are owned by the exact immutable Preview revision.

CREATE TABLE agent_preview_source_maps (
  org_id TEXT NOT NULL,
  preview_id TEXT NOT NULL CHECK (length(trim(preview_id)) BETWEEN 1 AND 300),
  revision_id TEXT NOT NULL CHECK (length(trim(revision_id)) BETWEEN 1 AND 300),
  artifact_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL DEFAULT 'source_map' CHECK (artifact_kind = 'source_map'),
  artifact_digest_sha256 sha256_hex NOT NULL,
  PRIMARY KEY (org_id, preview_id, revision_id),
  FOREIGN KEY (org_id, preview_id, revision_id)
    REFERENCES agent_preview_revisions (org_id, preview_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, artifact_id, artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_agent_preview_source_maps_artifact
  ON agent_preview_source_maps (org_id, artifact_id, artifact_kind);
