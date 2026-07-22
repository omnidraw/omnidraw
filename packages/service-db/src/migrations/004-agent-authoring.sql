ALTER TABLE agent_previews
  ADD COLUMN active_revision_id TEXT CHECK (
    active_revision_id IS NULL OR (
      length(active_revision_id) = 36 AND active_revision_id = lower(active_revision_id)
      AND substr(active_revision_id, 9, 1) = '-' AND substr(active_revision_id, 14, 1) = '-'
      AND substr(active_revision_id, 19, 1) = '-' AND substr(active_revision_id, 24, 1) = '-'
      AND length(replace(active_revision_id, '-', '')) = 32
      AND replace(active_revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE agent_chats
  ADD COLUMN external_session_key TEXT CHECK (
    external_session_key IS NULL OR (
      length(external_session_key) BETWEEN 1 AND 300
      AND external_session_key = trim(external_session_key)
    )
  );

CREATE UNIQUE INDEX agent_chats_external_session_idx
  ON agent_chats (org_id, account_id, external_session_key)
  WHERE external_session_key IS NOT NULL;

ALTER TABLE agent_drafts
  ADD COLUMN definition_id TEXT CHECK (
    definition_id IS NULL OR (
      length(definition_id) = 36 AND definition_id = lower(definition_id)
      AND substr(definition_id, 9, 1) = '-' AND substr(definition_id, 14, 1) = '-'
      AND substr(definition_id, 19, 1) = '-' AND substr(definition_id, 24, 1) = '-'
      AND length(replace(definition_id, '-', '')) = 32
      AND replace(definition_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE agent_drafts
  ADD COLUMN published_revision_id TEXT CHECK (
    published_revision_id IS NULL OR (
      length(published_revision_id) = 36 AND published_revision_id = lower(published_revision_id)
      AND substr(published_revision_id, 9, 1) = '-' AND substr(published_revision_id, 14, 1) = '-'
      AND substr(published_revision_id, 19, 1) = '-' AND substr(published_revision_id, 24, 1) = '-'
      AND length(replace(published_revision_id, '-', '')) = 32
      AND replace(published_revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  );

CREATE INDEX agent_drafts_definition_idx
  ON agent_drafts (org_id, definition_id, published_revision_id);

CREATE TABLE widget_revision_sources (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  definition_id TEXT NOT NULL CHECK (
    length(definition_id) = 36 AND definition_id = lower(definition_id)
    AND substr(definition_id, 9, 1) = '-' AND substr(definition_id, 14, 1) = '-'
    AND substr(definition_id, 19, 1) = '-' AND substr(definition_id, 24, 1) = '-'
    AND length(replace(definition_id, '-', '')) = 32
    AND replace(definition_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  revision_id TEXT NOT NULL CHECK (
    length(revision_id) = 36 AND revision_id = lower(revision_id)
    AND substr(revision_id, 9, 1) = '-' AND substr(revision_id, 14, 1) = '-'
    AND substr(revision_id, 19, 1) = '-' AND substr(revision_id, 24, 1) = '-'
    AND length(replace(revision_id, '-', '')) = 32
    AND replace(revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  source_snapshot_id TEXT NOT NULL CHECK (
    length(source_snapshot_id) = 36 AND source_snapshot_id = lower(source_snapshot_id)
    AND substr(source_snapshot_id, 9, 1) = '-' AND substr(source_snapshot_id, 14, 1) = '-'
    AND substr(source_snapshot_id, 19, 1) = '-' AND substr(source_snapshot_id, 24, 1) = '-'
    AND length(replace(source_snapshot_id, '-', '')) = 32
    AND replace(source_snapshot_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  source_artifact_id TEXT NOT NULL CHECK (
    length(source_artifact_id) = 36 AND source_artifact_id = lower(source_artifact_id)
    AND substr(source_artifact_id, 9, 1) = '-' AND substr(source_artifact_id, 14, 1) = '-'
    AND substr(source_artifact_id, 19, 1) = '-' AND substr(source_artifact_id, 24, 1) = '-'
    AND length(replace(source_artifact_id, '-', '')) = 32
    AND replace(source_artifact_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  source_artifact_kind TEXT NOT NULL DEFAULT 'source' CHECK (source_artifact_kind = 'source'),
  source_digest_sha256 TEXT NOT NULL CHECK (
    length(source_digest_sha256) = 64
    AND source_digest_sha256 = lower(source_digest_sha256)
    AND source_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  builder_identity TEXT NOT NULL CHECK (length(trim(builder_identity)) BETWEEN 1 AND 300),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, revision_id),
  UNIQUE (org_id, definition_id, revision_id),
  UNIQUE (org_id, source_snapshot_id, revision_id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, definition_id, revision_id)
    REFERENCES widget_definition_revisions (org_id, definition_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, source_artifact_id, source_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT
) STRICT;

CREATE INDEX widget_revision_sources_artifact_idx
  ON widget_revision_sources (org_id, source_artifact_id, source_artifact_kind);

CREATE TABLE agent_preview_revisions (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  id TEXT NOT NULL CHECK (
    length(id) = 36 AND id = lower(id)
    AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
    AND length(replace(id, '-', '')) = 32
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  preview_id TEXT NOT NULL CHECK (
    length(preview_id) = 36 AND preview_id = lower(preview_id)
    AND substr(preview_id, 9, 1) = '-' AND substr(preview_id, 14, 1) = '-'
    AND substr(preview_id, 19, 1) = '-' AND substr(preview_id, 24, 1) = '-'
    AND length(replace(preview_id, '-', '')) = 32
    AND replace(preview_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  draft_id TEXT NOT NULL CHECK (
    length(draft_id) = 36 AND draft_id = lower(draft_id)
    AND substr(draft_id, 9, 1) = '-' AND substr(draft_id, 14, 1) = '-'
    AND substr(draft_id, 19, 1) = '-' AND substr(draft_id, 24, 1) = '-'
    AND length(replace(draft_id, '-', '')) = 32
    AND replace(draft_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  definition_id TEXT NOT NULL CHECK (
    length(definition_id) = 36 AND definition_id = lower(definition_id)
    AND substr(definition_id, 9, 1) = '-' AND substr(definition_id, 14, 1) = '-'
    AND substr(definition_id, 19, 1) = '-' AND substr(definition_id, 24, 1) = '-'
    AND length(replace(definition_id, '-', '')) = 32
    AND replace(definition_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  draft_revision_sha256 TEXT NOT NULL CHECK (
    length(draft_revision_sha256) = 64
    AND draft_revision_sha256 = lower(draft_revision_sha256)
    AND draft_revision_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_snapshot_id TEXT NOT NULL CHECK (
    length(source_snapshot_id) = 36 AND source_snapshot_id = lower(source_snapshot_id)
    AND substr(source_snapshot_id, 9, 1) = '-' AND substr(source_snapshot_id, 14, 1) = '-'
    AND substr(source_snapshot_id, 19, 1) = '-' AND substr(source_snapshot_id, 24, 1) = '-'
    AND length(replace(source_snapshot_id, '-', '')) = 32
    AND replace(source_snapshot_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  source_artifact_id TEXT NOT NULL CHECK (
    length(source_artifact_id) = 36 AND source_artifact_id = lower(source_artifact_id)
    AND substr(source_artifact_id, 9, 1) = '-' AND substr(source_artifact_id, 14, 1) = '-'
    AND substr(source_artifact_id, 19, 1) = '-' AND substr(source_artifact_id, 24, 1) = '-'
    AND length(replace(source_artifact_id, '-', '')) = 32
    AND replace(source_artifact_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  source_artifact_kind TEXT NOT NULL DEFAULT 'source' CHECK (source_artifact_kind = 'source'),
  source_digest_sha256 TEXT NOT NULL CHECK (
    length(source_digest_sha256) = 64
    AND source_digest_sha256 = lower(source_digest_sha256)
    AND source_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json) AND json_type(manifest_json) = 'object'),
  runtime_abi TEXT CHECK (runtime_abi IS NULL OR length(trim(runtime_abi)) BETWEEN 1 AND 100),
  function_descriptors_json TEXT NOT NULL CHECK (
    json_valid(function_descriptors_json)
    AND json_type(function_descriptors_json) = 'object'
    AND json_extract(function_descriptors_json, '$.format') = 'vibecanvas.server-functions.v1'
    AND json_type(function_descriptors_json, '$.functions') = 'array'
  ),
  function_descriptors_digest_sha256 TEXT NOT NULL CHECK (
    length(function_descriptors_digest_sha256) = 64
    AND function_descriptors_digest_sha256 = lower(function_descriptors_digest_sha256)
    AND function_descriptors_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  contract_digest_sha256 TEXT NOT NULL CHECK (
    length(contract_digest_sha256) = 64
    AND contract_digest_sha256 = lower(contract_digest_sha256)
    AND contract_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  builder_identity TEXT NOT NULL CHECK (length(trim(builder_identity)) BETWEEN 1 AND 300),
  ui_artifact_id TEXT NOT NULL CHECK (
    length(ui_artifact_id) = 36 AND ui_artifact_id = lower(ui_artifact_id)
    AND substr(ui_artifact_id, 9, 1) = '-' AND substr(ui_artifact_id, 14, 1) = '-'
    AND substr(ui_artifact_id, 19, 1) = '-' AND substr(ui_artifact_id, 24, 1) = '-'
    AND length(replace(ui_artifact_id, '-', '')) = 32
    AND replace(ui_artifact_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  ui_artifact_kind TEXT NOT NULL DEFAULT 'ui' CHECK (ui_artifact_kind = 'ui'),
  ui_artifact_digest_sha256 TEXT NOT NULL CHECK (
    length(ui_artifact_digest_sha256) = 64
    AND ui_artifact_digest_sha256 = lower(ui_artifact_digest_sha256)
    AND ui_artifact_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  server_artifact_id TEXT CHECK (
    server_artifact_id IS NULL OR (
      length(server_artifact_id) = 36 AND server_artifact_id = lower(server_artifact_id)
      AND substr(server_artifact_id, 9, 1) = '-' AND substr(server_artifact_id, 14, 1) = '-'
      AND substr(server_artifact_id, 19, 1) = '-' AND substr(server_artifact_id, 24, 1) = '-'
      AND length(replace(server_artifact_id, '-', '')) = 32
      AND replace(server_artifact_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  server_artifact_kind TEXT CHECK (
    (server_artifact_id IS NULL AND server_artifact_kind IS NULL)
    OR (server_artifact_id IS NOT NULL AND server_artifact_kind = 'server')
  ),
  server_artifact_digest_sha256 TEXT CHECK (
    server_artifact_digest_sha256 IS NULL OR (
      length(server_artifact_digest_sha256) = 64
      AND server_artifact_digest_sha256 = lower(server_artifact_digest_sha256)
      AND server_artifact_digest_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  retain_until_ms INTEGER NOT NULL CHECK (retain_until_ms >= created_at_ms),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, preview_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, preview_id) REFERENCES agent_previews (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, draft_id) REFERENCES agent_drafts (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, source_artifact_id, source_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, ui_artifact_id, ui_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, server_artifact_id, server_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  CHECK (
    (runtime_abi IS NULL AND server_artifact_id IS NULL
      AND server_artifact_kind IS NULL AND server_artifact_digest_sha256 IS NULL)
    OR (runtime_abi IS NOT NULL AND server_artifact_id IS NOT NULL
      AND server_artifact_kind = 'server' AND server_artifact_digest_sha256 IS NOT NULL)
  ),
  CHECK (source_artifact_id <> ui_artifact_id),
  CHECK (server_artifact_id IS NULL OR (
    server_artifact_id <> source_artifact_id AND server_artifact_id <> ui_artifact_id
  ))
) STRICT;

CREATE INDEX agent_preview_revisions_preview_idx
  ON agent_preview_revisions (org_id, preview_id, expires_at_ms, retain_until_ms);
CREATE INDEX agent_preview_revisions_source_artifact_idx
  ON agent_preview_revisions (org_id, source_artifact_id, source_artifact_kind);
CREATE INDEX agent_preview_revisions_ui_artifact_idx
  ON agent_preview_revisions (org_id, ui_artifact_id, ui_artifact_kind);
CREATE INDEX agent_preview_revisions_server_artifact_idx
  ON agent_preview_revisions (org_id, server_artifact_id, server_artifact_kind);
CREATE INDEX agent_previews_active_revision_idx
  ON agent_previews (org_id, id, active_revision_id, status, expires_at_ms);

CREATE TABLE agent_preview_resource_bindings (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  preview_id TEXT NOT NULL CHECK (
    length(preview_id) = 36 AND preview_id = lower(preview_id)
    AND substr(preview_id, 9, 1) = '-' AND substr(preview_id, 14, 1) = '-'
    AND substr(preview_id, 19, 1) = '-' AND substr(preview_id, 24, 1) = '-'
    AND length(replace(preview_id, '-', '')) = 32
    AND replace(preview_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  revision_id TEXT NOT NULL CHECK (
    length(revision_id) = 36 AND revision_id = lower(revision_id)
    AND substr(revision_id, 9, 1) = '-' AND substr(revision_id, 14, 1) = '-'
    AND substr(revision_id, 19, 1) = '-' AND substr(revision_id, 24, 1) = '-'
    AND length(replace(revision_id, '-', '')) = 32
    AND replace(revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  slot_name TEXT NOT NULL CHECK (length(trim(slot_name)) BETWEEN 1 AND 100),
  resource_id TEXT NOT NULL CHECK (
    length(resource_id) = 36 AND resource_id = lower(resource_id)
    AND substr(resource_id, 9, 1) = '-' AND substr(resource_id, 14, 1) = '-'
    AND substr(resource_id, 19, 1) = '-' AND substr(resource_id, 24, 1) = '-'
    AND length(replace(resource_id, '-', '')) = 32
    AND replace(resource_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('kv', 'secretStore', 'db')),
  is_required INTEGER NOT NULL CHECK (is_required IN (0, 1)),
  manifest_allow_read INTEGER NOT NULL CHECK (manifest_allow_read IN (0, 1)),
  manifest_allow_write INTEGER NOT NULL CHECK (manifest_allow_write IN (0, 1)),
  allow_read INTEGER NOT NULL CHECK (allow_read IN (0, 1)),
  allow_write INTEGER NOT NULL CHECK (allow_write IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, preview_id, revision_id, slot_name),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, preview_id, revision_id)
    REFERENCES agent_preview_revisions (org_id, preview_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, resource_id, resource_kind)
    REFERENCES resource_catalog (org_id, id, kind) ON DELETE RESTRICT,
  CHECK (allow_read = 1 OR allow_write = 1),
  CHECK (allow_read <= manifest_allow_read),
  CHECK (allow_write <= manifest_allow_write)
) STRICT;

CREATE INDEX agent_preview_resource_bindings_resource_idx
  ON agent_preview_resource_bindings (org_id, resource_id, resource_kind);

DROP INDEX function_invocations_queue_idx;
DROP INDEX function_invocations_revision_idx;
DROP INDEX function_invocations_account_idx;
DROP INDEX function_invocations_instance_idx;
DROP INDEX function_attempts_invocation_idx;
DROP INDEX invocation_leases_expiry_idx;
DROP INDEX invocation_leases_attempt_idx;
DROP INDEX idempotency_records_org_key_idx;
DROP INDEX idempotency_records_canvas_key_idx;
DROP INDEX idempotency_records_widget_key_idx;
DROP INDEX idempotency_records_expiry_idx;
DROP INDEX idempotency_records_revision_idx;
DROP INDEX idempotency_records_invocation_idx;
DROP INDEX resource_write_permits_expiry_idx;
DROP INDEX resource_write_permits_attempt_idx;
DROP INDEX usage_outbox_attempt_receipt_idx;
DROP INDEX usage_outbox_resource_receipt_idx;
DROP INDEX usage_outbox_import_idx;
DROP INDEX usage_outbox_account_idx;
DROP INDEX usage_outbox_resource_permit_idx;

ALTER TABLE usage_outbox RENAME TO usage_outbox_m8;
ALTER TABLE resource_write_permits RENAME TO resource_write_permits_m8;
ALTER TABLE idempotency_records RENAME TO idempotency_records_m8;
ALTER TABLE invocation_leases RENAME TO invocation_leases_m8;
ALTER TABLE function_attempts RENAME TO function_attempts_m8;
ALTER TABLE function_invocations RENAME TO function_invocations_m8;

CREATE TABLE function_invocations (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  id TEXT NOT NULL CHECK (
    length(id) = 36 AND id = lower(id)
    AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
    AND length(replace(id, '-', '')) = 32
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  account_id TEXT NOT NULL CHECK (
    length(account_id) = 36 AND account_id = lower(account_id)
    AND substr(account_id, 9, 1) = '-' AND substr(account_id, 14, 1) = '-'
    AND substr(account_id, 19, 1) = '-' AND substr(account_id, 24, 1) = '-'
    AND length(replace(account_id, '-', '')) = 32
    AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('widget_instance', 'agent_preview')),
  canvas_id TEXT CHECK (
    canvas_id IS NULL OR (
      length(canvas_id) = 36 AND canvas_id = lower(canvas_id)
      AND substr(canvas_id, 9, 1) = '-' AND substr(canvas_id, 14, 1) = '-'
      AND substr(canvas_id, 19, 1) = '-' AND substr(canvas_id, 24, 1) = '-'
      AND length(replace(canvas_id, '-', '')) = 32
      AND replace(canvas_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  widget_definition_id TEXT NOT NULL CHECK (
    length(widget_definition_id) = 36 AND widget_definition_id = lower(widget_definition_id)
    AND substr(widget_definition_id, 9, 1) = '-' AND substr(widget_definition_id, 14, 1) = '-'
    AND substr(widget_definition_id, 19, 1) = '-' AND substr(widget_definition_id, 24, 1) = '-'
    AND length(replace(widget_definition_id, '-', '')) = 32
    AND replace(widget_definition_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  widget_revision_id TEXT NOT NULL CHECK (
    length(widget_revision_id) = 36 AND widget_revision_id = lower(widget_revision_id)
    AND substr(widget_revision_id, 9, 1) = '-' AND substr(widget_revision_id, 14, 1) = '-'
    AND substr(widget_revision_id, 19, 1) = '-' AND substr(widget_revision_id, 24, 1) = '-'
    AND length(replace(widget_revision_id, '-', '')) = 32
    AND replace(widget_revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  widget_instance_id TEXT CHECK (
    widget_instance_id IS NULL OR (
      length(widget_instance_id) = 36 AND widget_instance_id = lower(widget_instance_id)
      AND substr(widget_instance_id, 9, 1) = '-' AND substr(widget_instance_id, 14, 1) = '-'
      AND substr(widget_instance_id, 19, 1) = '-' AND substr(widget_instance_id, 24, 1) = '-'
      AND length(replace(widget_instance_id, '-', '')) = 32
      AND replace(widget_instance_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  preview_id TEXT CHECK (
    preview_id IS NULL OR (
      length(preview_id) = 36 AND preview_id = lower(preview_id)
      AND substr(preview_id, 9, 1) = '-' AND substr(preview_id, 14, 1) = '-'
      AND substr(preview_id, 19, 1) = '-' AND substr(preview_id, 24, 1) = '-'
      AND length(replace(preview_id, '-', '')) = 32
      AND replace(preview_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  preview_revision_id TEXT CHECK (
    preview_revision_id IS NULL OR (
      length(preview_revision_id) = 36 AND preview_revision_id = lower(preview_revision_id)
      AND substr(preview_revision_id, 9, 1) = '-' AND substr(preview_revision_id, 14, 1) = '-'
      AND substr(preview_revision_id, 19, 1) = '-' AND substr(preview_revision_id, 24, 1) = '-'
      AND length(replace(preview_revision_id, '-', '')) = 32
      AND replace(preview_revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  function_id TEXT NOT NULL CHECK (length(trim(function_id)) BETWEEN 1 AND 200),
  function_name TEXT NOT NULL CHECK (length(trim(function_name)) BETWEEN 1 AND 200),
  definition_revision INTEGER NOT NULL CHECK (definition_revision >= 1),
  artifact_digest_sha256 TEXT NOT NULL CHECK (
    length(artifact_digest_sha256) = 64
    AND artifact_digest_sha256 = lower(artifact_digest_sha256)
    AND artifact_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  contract_digest_sha256 TEXT NOT NULL CHECK (
    length(contract_digest_sha256) = 64
    AND contract_digest_sha256 = lower(contract_digest_sha256)
    AND contract_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  runtime_abi TEXT NOT NULL CHECK (length(trim(runtime_abi)) BETWEEN 1 AND 100),
  tenant_cell_id TEXT NOT NULL CHECK (length(trim(tenant_cell_id)) BETWEEN 1 AND 200),
  tenant_placement_epoch INTEGER NOT NULL CHECK (tenant_placement_epoch >= 1),
  tenant_request_id TEXT NOT NULL CHECK (length(trim(tenant_request_id)) BETWEEN 1 AND 300),
  tenant_roles_json TEXT NOT NULL CHECK (
    json_valid(tenant_roles_json) AND json_type(tenant_roles_json) = 'array'
  ),
  tenant_capabilities_json TEXT NOT NULL CHECK (
    json_valid(tenant_capabilities_json) AND json_type(tenant_capabilities_json) = 'array'
  ),
  input_json TEXT CHECK (input_json IS NULL OR json_valid(input_json)),
  input_digest_sha256 TEXT NOT NULL CHECK (
    length(input_digest_sha256) = 64 AND input_digest_sha256 = lower(input_digest_sha256)
    AND input_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 300),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms >= 1),
  memory_tier TEXT NOT NULL CHECK (memory_tier IN ('small', 'medium', 'large')),
  output_byte_limit INTEGER NOT NULL CHECK (output_byte_limit >= 1),
  log_byte_limit INTEGER NOT NULL CHECK (log_byte_limit >= 0),
  retry_mode TEXT NOT NULL CHECK (retry_mode IN ('none', 'idempotent')),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  initial_backoff_ms INTEGER NOT NULL CHECK (initial_backoff_ms >= 0),
  max_backoff_ms INTEGER NOT NULL CHECK (max_backoff_ms >= initial_backoff_ms),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')
  ),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  failure_json TEXT CHECK (
    failure_json IS NULL OR (json_valid(failure_json) AND json_type(failure_json) = 'object')
  ),
  result_digest_sha256 TEXT CHECK (
    result_digest_sha256 IS NULL OR (
      length(result_digest_sha256) = 64
      AND result_digest_sha256 = lower(result_digest_sha256)
      AND result_digest_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  output_byte_size INTEGER NOT NULL CHECK (output_byte_size >= 0),
  log_byte_size INTEGER NOT NULL CHECK (log_byte_size >= 0),
  body_state TEXT NOT NULL CHECK (body_state IN ('full', 'compacted')),
  retains_revision INTEGER NOT NULL CHECK (retains_revision IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  available_at_ms INTEGER NOT NULL CHECK (available_at_ms >= created_at_ms),
  deadline_at_ms INTEGER NOT NULL CHECK (deadline_at_ms >= created_at_ms),
  cancel_requested_at_ms INTEGER CHECK (
    cancel_requested_at_ms IS NULL OR cancel_requested_at_ms >= created_at_ms
  ),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= created_at_ms),
  finished_at_ms INTEGER CHECK (
    finished_at_ms IS NULL OR finished_at_ms >= coalesce(started_at_ms, created_at_ms)
  ),
  bodies_compacted_at_ms INTEGER CHECK (
    bodies_compacted_at_ms IS NULL
    OR (finished_at_ms IS NOT NULL AND bodies_compacted_at_ms >= finished_at_ms)
  ),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, account_id)
    REFERENCES organization_memberships (org_id, account_id) ON DELETE RESTRICT,
  CHECK (
    (subject_kind = 'widget_instance' AND canvas_id IS NOT NULL
      AND widget_instance_id IS NOT NULL AND preview_id IS NULL AND preview_revision_id IS NULL)
    OR (subject_kind = 'agent_preview' AND canvas_id IS NULL
      AND widget_instance_id IS NULL AND preview_id IS NOT NULL AND preview_revision_id IS NOT NULL)
  ),
  CHECK (
    (status IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND finished_at_ms IS NOT NULL)
    OR (status IN ('queued', 'claimed', 'running') AND finished_at_ms IS NULL)
  ),
  CHECK ((status IN ('queued', 'claimed') AND started_at_ms IS NULL) OR status NOT IN ('queued', 'claimed')),
  CHECK ((status IN ('running', 'succeeded') AND started_at_ms IS NOT NULL) OR status NOT IN ('running', 'succeeded')),
  CHECK (
    (status IN ('failed', 'cancelled', 'timed_out') AND failure_json IS NOT NULL)
    OR (status NOT IN ('failed', 'cancelled', 'timed_out') AND failure_json IS NULL)
  ),
  CHECK (
    (body_state = 'full' AND input_json IS NOT NULL AND bodies_compacted_at_ms IS NULL)
    OR (body_state = 'compacted' AND input_json IS NULL AND result_json IS NULL
      AND bodies_compacted_at_ms IS NOT NULL)
  ),
  CHECK (output_byte_size <= output_byte_limit),
  CHECK (log_byte_size <= log_byte_limit),
  CHECK ((retry_mode = 'none' AND max_attempts = 1) OR retry_mode = 'idempotent')
) STRICT;

CREATE INDEX function_invocations_queue_idx
  ON function_invocations (
    org_id, status, memory_tier, available_at_ms, priority DESC, created_at_ms
  );
CREATE INDEX function_invocations_revision_idx
  ON function_invocations (
    org_id, widget_definition_id, widget_revision_id, retains_revision, created_at_ms
  );
CREATE INDEX function_invocations_account_idx
  ON function_invocations (org_id, account_id, created_at_ms);
CREATE INDEX function_invocations_instance_idx
  ON function_invocations (
    org_id, widget_definition_id, widget_revision_id, widget_instance_id
  );
CREATE INDEX function_invocations_preview_idx
  ON function_invocations (org_id, preview_id, preview_revision_id, created_at_ms);

CREATE TABLE function_attempts (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  id TEXT NOT NULL CHECK (
    length(id) = 36 AND id = lower(id)
    AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
    AND length(replace(id, '-', '')) = 32
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  invocation_id TEXT NOT NULL CHECK (
    length(invocation_id) = 36 AND invocation_id = lower(invocation_id)
    AND substr(invocation_id, 9, 1) = '-' AND substr(invocation_id, 14, 1) = '-'
    AND substr(invocation_id, 19, 1) = '-' AND substr(invocation_id, 24, 1) = '-'
    AND length(replace(invocation_id, '-', '')) = 32
    AND replace(invocation_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch >= 1),
  status TEXT NOT NULL CHECK (
    status IN ('starting', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'lost')
  ),
  sandbox_driver TEXT NOT NULL CHECK (length(trim(sandbox_driver)) BETWEEN 1 AND 100),
  memory_tier TEXT NOT NULL CHECK (memory_tier IN ('small', 'medium', 'large')),
  active_wall_ms INTEGER NOT NULL CHECK (active_wall_ms >= 0),
  cpu_ms INTEGER NOT NULL CHECK (cpu_ms >= 0),
  allocated_memory_byte_ms INTEGER NOT NULL CHECK (allocated_memory_byte_ms >= 0),
  peak_rss_bytes INTEGER NOT NULL CHECK (peak_rss_bytes >= 0),
  disk_read_bytes INTEGER NOT NULL CHECK (disk_read_bytes >= 0),
  disk_write_bytes INTEGER NOT NULL CHECK (disk_write_bytes >= 0),
  network_rx_bytes INTEGER NOT NULL CHECK (network_rx_bytes >= 0),
  network_tx_bytes INTEGER NOT NULL CHECK (network_tx_bytes >= 0),
  output_byte_size INTEGER NOT NULL CHECK (output_byte_size >= 0),
  log_byte_size INTEGER NOT NULL CHECK (log_byte_size >= 0),
  cold_start INTEGER NOT NULL CHECK (cold_start IN (0, 1)),
  failure_owner TEXT CHECK (failure_owner IS NULL OR failure_owner IN ('user', 'platform', 'cancelled')),
  failure_json TEXT CHECK (
    failure_json IS NULL OR (json_valid(failure_json) AND json_type(failure_json) = 'object')
  ),
  billable INTEGER NOT NULL CHECK (billable IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= created_at_ms),
  guest_code_entered_at_ms INTEGER CHECK (
    guest_code_entered_at_ms IS NULL
    OR (started_at_ms IS NOT NULL AND guest_code_entered_at_ms >= started_at_ms)
  ),
  finished_at_ms INTEGER CHECK (
    finished_at_ms IS NULL OR finished_at_ms >= coalesce(started_at_ms, created_at_ms)
  ),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, invocation_id, id),
  UNIQUE (org_id, invocation_id, attempt_number),
  UNIQUE (org_id, invocation_id, lease_epoch),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id) REFERENCES function_invocations (org_id, id) ON DELETE RESTRICT,
  CHECK (
    (status IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'lost') AND finished_at_ms IS NOT NULL)
    OR (status IN ('starting', 'running') AND finished_at_ms IS NULL)
  ),
  CHECK ((status = 'starting' AND started_at_ms IS NULL) OR status <> 'starting'),
  CHECK ((status IN ('running', 'succeeded') AND started_at_ms IS NOT NULL)
    OR status NOT IN ('running', 'succeeded')),
  CHECK ((status = 'succeeded' AND failure_owner IS NULL AND failure_json IS NULL) OR status <> 'succeeded'),
  CHECK (
    (status IN ('failed', 'cancelled', 'timed_out', 'lost')
      AND failure_owner IS NOT NULL AND failure_json IS NOT NULL)
    OR status NOT IN ('failed', 'cancelled', 'timed_out', 'lost')
  )
) STRICT;

CREATE INDEX function_attempts_invocation_idx
  ON function_attempts (org_id, invocation_id, attempt_number);

CREATE TABLE invocation_leases (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  invocation_id TEXT NOT NULL CHECK (
    length(invocation_id) = 36 AND invocation_id = lower(invocation_id)
    AND substr(invocation_id, 9, 1) = '-' AND substr(invocation_id, 14, 1) = '-'
    AND substr(invocation_id, 19, 1) = '-' AND substr(invocation_id, 24, 1) = '-'
    AND length(replace(invocation_id, '-', '')) = 32
    AND replace(invocation_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  attempt_id TEXT NOT NULL CHECK (
    length(attempt_id) = 36 AND attempt_id = lower(attempt_id)
    AND substr(attempt_id, 9, 1) = '-' AND substr(attempt_id, 14, 1) = '-'
    AND substr(attempt_id, 19, 1) = '-' AND substr(attempt_id, 24, 1) = '-'
    AND length(replace(attempt_id, '-', '')) = 32
    AND replace(attempt_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch >= 1),
  worker_id TEXT NOT NULL CHECK (length(trim(worker_id)) BETWEEN 1 AND 200),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  heartbeat_at_ms INTEGER NOT NULL CHECK (heartbeat_at_ms >= created_at_ms),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > heartbeat_at_ms),
  PRIMARY KEY (org_id, invocation_id),
  UNIQUE (org_id, invocation_id, lease_epoch),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id) REFERENCES function_invocations (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, invocation_id, attempt_id)
    REFERENCES function_attempts (org_id, invocation_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX invocation_leases_expiry_idx ON invocation_leases (expires_at_ms, org_id);
CREATE INDEX invocation_leases_attempt_idx
  ON invocation_leases (org_id, invocation_id, attempt_id);

CREATE TABLE idempotency_records (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  id TEXT NOT NULL CHECK (
    length(id) = 36 AND id = lower(id)
    AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
    AND length(replace(id, '-', '')) = 32
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  function_id TEXT NOT NULL CHECK (length(trim(function_id)) BETWEEN 1 AND 200),
  scope_kind TEXT NOT NULL CHECK (
    scope_kind IN ('organization', 'canvas', 'widget_instance', 'agent_preview')
  ),
  canvas_id TEXT CHECK (
    canvas_id IS NULL OR (
      length(canvas_id) = 36 AND canvas_id = lower(canvas_id)
      AND substr(canvas_id, 9, 1) = '-' AND substr(canvas_id, 14, 1) = '-'
      AND substr(canvas_id, 19, 1) = '-' AND substr(canvas_id, 24, 1) = '-'
      AND length(replace(canvas_id, '-', '')) = 32
      AND replace(canvas_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  widget_instance_id TEXT CHECK (
    widget_instance_id IS NULL OR (
      length(widget_instance_id) = 36 AND widget_instance_id = lower(widget_instance_id)
      AND substr(widget_instance_id, 9, 1) = '-' AND substr(widget_instance_id, 14, 1) = '-'
      AND substr(widget_instance_id, 19, 1) = '-' AND substr(widget_instance_id, 24, 1) = '-'
      AND length(replace(widget_instance_id, '-', '')) = 32
      AND replace(widget_instance_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  preview_id TEXT CHECK (
    preview_id IS NULL OR (
      length(preview_id) = 36 AND preview_id = lower(preview_id)
      AND substr(preview_id, 9, 1) = '-' AND substr(preview_id, 14, 1) = '-'
      AND substr(preview_id, 19, 1) = '-' AND substr(preview_id, 24, 1) = '-'
      AND length(replace(preview_id, '-', '')) = 32
      AND replace(preview_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  preview_revision_id TEXT CHECK (
    preview_revision_id IS NULL OR (
      length(preview_revision_id) = 36 AND preview_revision_id = lower(preview_revision_id)
      AND substr(preview_revision_id, 9, 1) = '-' AND substr(preview_revision_id, 14, 1) = '-'
      AND substr(preview_revision_id, 19, 1) = '-' AND substr(preview_revision_id, 24, 1) = '-'
      AND length(replace(preview_revision_id, '-', '')) = 32
      AND replace(preview_revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 300),
  request_fingerprint_sha256 TEXT NOT NULL CHECK (
    length(request_fingerprint_sha256) = 64
    AND request_fingerprint_sha256 = lower(request_fingerprint_sha256)
    AND request_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  widget_definition_id TEXT NOT NULL CHECK (
    length(widget_definition_id) = 36 AND widget_definition_id = lower(widget_definition_id)
    AND substr(widget_definition_id, 9, 1) = '-' AND substr(widget_definition_id, 14, 1) = '-'
    AND substr(widget_definition_id, 19, 1) = '-' AND substr(widget_definition_id, 24, 1) = '-'
    AND length(replace(widget_definition_id, '-', '')) = 32
    AND replace(widget_definition_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  widget_revision_id TEXT NOT NULL CHECK (
    length(widget_revision_id) = 36 AND widget_revision_id = lower(widget_revision_id)
    AND substr(widget_revision_id, 9, 1) = '-' AND substr(widget_revision_id, 14, 1) = '-'
    AND substr(widget_revision_id, 19, 1) = '-' AND substr(widget_revision_id, 24, 1) = '-'
    AND length(replace(widget_revision_id, '-', '')) = 32
    AND replace(widget_revision_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  invocation_id TEXT NOT NULL CHECK (
    length(invocation_id) = 36 AND invocation_id = lower(invocation_id)
    AND substr(invocation_id, 9, 1) = '-' AND substr(invocation_id, 14, 1) = '-'
    AND substr(invocation_id, 19, 1) = '-' AND substr(invocation_id, 24, 1) = '-'
    AND length(replace(invocation_id, '-', '')) = 32
    AND replace(invocation_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms INTEGER CHECK (expires_at_ms IS NULL OR expires_at_ms > created_at_ms),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, canvas_id) REFERENCES canvases (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, widget_instance_id) REFERENCES widget_instances (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, preview_id, preview_revision_id)
    REFERENCES agent_preview_revisions (org_id, preview_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id) REFERENCES function_invocations (org_id, id) ON DELETE RESTRICT,
  CHECK (
    (scope_kind = 'organization' AND canvas_id IS NULL AND widget_instance_id IS NULL
      AND preview_id IS NULL AND preview_revision_id IS NULL)
    OR (scope_kind = 'canvas' AND canvas_id IS NOT NULL AND widget_instance_id IS NULL
      AND preview_id IS NULL AND preview_revision_id IS NULL)
    OR (scope_kind = 'widget_instance' AND canvas_id IS NULL AND widget_instance_id IS NOT NULL
      AND preview_id IS NULL AND preview_revision_id IS NULL)
    OR (scope_kind = 'agent_preview' AND canvas_id IS NULL AND widget_instance_id IS NULL
      AND preview_id IS NOT NULL AND preview_revision_id IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX idempotency_records_org_key_idx
  ON idempotency_records (org_id, function_id, idempotency_key)
  WHERE scope_kind = 'organization';
CREATE UNIQUE INDEX idempotency_records_canvas_key_idx
  ON idempotency_records (org_id, canvas_id, function_id, idempotency_key)
  WHERE scope_kind = 'canvas';
CREATE UNIQUE INDEX idempotency_records_widget_key_idx
  ON idempotency_records (org_id, widget_instance_id, function_id, idempotency_key)
  WHERE scope_kind = 'widget_instance';
CREATE UNIQUE INDEX idempotency_records_preview_key_idx
  ON idempotency_records (
    org_id, preview_id, preview_revision_id, function_id, idempotency_key
  ) WHERE scope_kind = 'agent_preview';
CREATE INDEX idempotency_records_expiry_idx
  ON idempotency_records (org_id, expires_at_ms);
CREATE INDEX idempotency_records_revision_idx
  ON idempotency_records (org_id, widget_definition_id, widget_revision_id);
CREATE INDEX idempotency_records_invocation_idx
  ON idempotency_records (org_id, invocation_id);

CREATE TABLE resource_write_permits (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  id TEXT NOT NULL CHECK (
    length(id) = 36 AND id = lower(id)
    AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
    AND length(replace(id, '-', '')) = 32
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  resource_id TEXT NOT NULL CHECK (
    length(resource_id) = 36 AND resource_id = lower(resource_id)
    AND substr(resource_id, 9, 1) = '-' AND substr(resource_id, 14, 1) = '-'
    AND substr(resource_id, 19, 1) = '-' AND substr(resource_id, 24, 1) = '-'
    AND length(replace(resource_id, '-', '')) = 32
    AND replace(resource_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  invocation_id TEXT NOT NULL CHECK (
    length(invocation_id) = 36 AND invocation_id = lower(invocation_id)
    AND substr(invocation_id, 9, 1) = '-' AND substr(invocation_id, 14, 1) = '-'
    AND substr(invocation_id, 19, 1) = '-' AND substr(invocation_id, 24, 1) = '-'
    AND length(replace(invocation_id, '-', '')) = 32
    AND replace(invocation_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  attempt_id TEXT NOT NULL CHECK (
    length(attempt_id) = 36 AND attempt_id = lower(attempt_id)
    AND substr(attempt_id, 9, 1) = '-' AND substr(attempt_id, 14, 1) = '-'
    AND substr(attempt_id, 19, 1) = '-' AND substr(attempt_id, 24, 1) = '-'
    AND length(replace(attempt_id, '-', '')) = 32
    AND replace(attempt_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  lease_epoch INTEGER NOT NULL CHECK (lease_epoch >= 1),
  operation_name TEXT NOT NULL CHECK (length(trim(operation_name)) BETWEEN 1 AND 200),
  operation_id TEXT NOT NULL CHECK (length(trim(operation_id)) BETWEEN 1 AND 200),
  operation_fingerprint_sha256 TEXT NOT NULL CHECK (
    length(operation_fingerprint_sha256) = 64
    AND operation_fingerprint_sha256 = lower(operation_fingerprint_sha256)
    AND operation_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  result_digest_sha256 TEXT CHECK (
    result_digest_sha256 IS NULL OR (
      length(result_digest_sha256) = 64
      AND result_digest_sha256 = lower(result_digest_sha256)
      AND result_digest_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > issued_at_ms),
  consumed_at_ms INTEGER CHECK (consumed_at_ms IS NULL OR consumed_at_ms >= issued_at_ms),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, resource_id, id),
  UNIQUE (org_id, resource_id, invocation_id, operation_id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, resource_id) REFERENCES resource_catalog (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id) REFERENCES function_invocations (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id, attempt_id)
    REFERENCES function_attempts (org_id, invocation_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'consumed' AND consumed_at_ms IS NOT NULL)
    OR (status <> 'consumed' AND consumed_at_ms IS NULL)
  ),
  CHECK (
    (status = 'consumed' AND result_json IS NOT NULL AND result_digest_sha256 IS NOT NULL)
    OR (status <> 'consumed' AND result_json IS NULL AND result_digest_sha256 IS NULL)
  )
) STRICT;

CREATE INDEX resource_write_permits_expiry_idx
  ON resource_write_permits (org_id, status, expires_at_ms);
CREATE INDEX resource_write_permits_attempt_idx
  ON resource_write_permits (org_id, invocation_id, attempt_id, lease_epoch);

CREATE TABLE usage_outbox (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  id TEXT NOT NULL CHECK (
    length(id) = 36 AND id = lower(id)
    AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
    AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
    AND length(replace(id, '-', '')) = 32
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  account_id TEXT NOT NULL CHECK (
    length(account_id) = 36 AND account_id = lower(account_id)
    AND substr(account_id, 9, 1) = '-' AND substr(account_id, 14, 1) = '-'
    AND substr(account_id, 19, 1) = '-' AND substr(account_id, 24, 1) = '-'
    AND length(replace(account_id, '-', '')) = 32
    AND replace(account_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  attempt_id TEXT CHECK (
    attempt_id IS NULL OR (
      length(attempt_id) = 36 AND attempt_id = lower(attempt_id)
      AND substr(attempt_id, 9, 1) = '-' AND substr(attempt_id, 14, 1) = '-'
      AND substr(attempt_id, 19, 1) = '-' AND substr(attempt_id, 24, 1) = '-'
      AND length(replace(attempt_id, '-', '')) = 32
      AND replace(attempt_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  invocation_id TEXT NOT NULL CHECK (
    length(invocation_id) = 36 AND invocation_id = lower(invocation_id)
    AND substr(invocation_id, 9, 1) = '-' AND substr(invocation_id, 14, 1) = '-'
    AND substr(invocation_id, 19, 1) = '-' AND substr(invocation_id, 24, 1) = '-'
    AND length(replace(invocation_id, '-', '')) = 32
    AND replace(invocation_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  function_id TEXT NOT NULL CHECK (length(trim(function_id)) BETWEEN 1 AND 200),
  definition_revision INTEGER NOT NULL CHECK (definition_revision >= 1),
  sandbox_driver TEXT NOT NULL CHECK (length(trim(sandbox_driver)) BETWEEN 1 AND 100),
  memory_tier TEXT NOT NULL CHECK (memory_tier IN ('small', 'medium', 'large')),
  queued_at_ms INTEGER NOT NULL CHECK (queued_at_ms >= 0),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= queued_at_ms),
  finished_at_ms INTEGER NOT NULL CHECK (
    finished_at_ms >= queued_at_ms
    AND (started_at_ms IS NULL OR finished_at_ms >= started_at_ms)
  ),
  cold_start INTEGER NOT NULL CHECK (cold_start IN (0, 1)),
  resource_id TEXT CHECK (
    resource_id IS NULL OR (
      length(resource_id) = 36 AND resource_id = lower(resource_id)
      AND substr(resource_id, 9, 1) = '-' AND substr(resource_id, 14, 1) = '-'
      AND substr(resource_id, 19, 1) = '-' AND substr(resource_id, 24, 1) = '-'
      AND length(replace(resource_id, '-', '')) = 32
      AND replace(resource_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  resource_permit_id TEXT CHECK (
    resource_permit_id IS NULL OR (
      length(resource_permit_id) = 36 AND resource_permit_id = lower(resource_permit_id)
      AND substr(resource_permit_id, 9, 1) = '-' AND substr(resource_permit_id, 14, 1) = '-'
      AND substr(resource_permit_id, 19, 1) = '-' AND substr(resource_permit_id, 24, 1) = '-'
      AND length(replace(resource_permit_id, '-', '')) = 32
      AND replace(resource_permit_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    )
  ),
  state TEXT NOT NULL CHECK (state IN ('pending', 'importing', 'imported', 'error')),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'lost')),
  failure_owner TEXT CHECK (failure_owner IS NULL OR failure_owner IN ('user', 'platform', 'cancelled')),
  billable INTEGER NOT NULL CHECK (billable IN (0, 1)),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  active_wall_ms INTEGER NOT NULL CHECK (active_wall_ms >= 0),
  cpu_ms INTEGER NOT NULL CHECK (cpu_ms >= 0),
  allocated_memory_byte_ms INTEGER NOT NULL CHECK (allocated_memory_byte_ms >= 0),
  peak_rss_bytes INTEGER NOT NULL CHECK (peak_rss_bytes >= 0),
  disk_read_bytes INTEGER NOT NULL CHECK (disk_read_bytes >= 0),
  disk_write_bytes INTEGER NOT NULL CHECK (disk_write_bytes >= 0),
  network_rx_bytes INTEGER NOT NULL CHECK (network_rx_bytes >= 0),
  network_tx_bytes INTEGER NOT NULL CHECK (network_tx_bytes >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  imported_at_ms INTEGER CHECK (imported_at_ms IS NULL OR imported_at_ms >= created_at_ms),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, account_id)
    REFERENCES organization_memberships (org_id, account_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id)
    REFERENCES function_invocations (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, attempt_id) REFERENCES function_attempts (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, resource_id, resource_permit_id)
    REFERENCES resource_write_permits (org_id, resource_id, id) ON DELETE RESTRICT,
  CHECK (
    (attempt_id IS NOT NULL AND resource_id IS NULL AND resource_permit_id IS NULL)
    OR (attempt_id IS NULL AND resource_id IS NOT NULL AND resource_permit_id IS NOT NULL)
  ),
  CHECK ((state = 'imported' AND imported_at_ms IS NOT NULL) OR (state <> 'imported' AND imported_at_ms IS NULL)),
  CHECK ((outcome = 'succeeded' AND failure_owner IS NULL) OR outcome <> 'succeeded'),
  CHECK ((outcome <> 'succeeded' AND failure_owner IS NOT NULL) OR outcome = 'succeeded')
) STRICT;

CREATE UNIQUE INDEX usage_outbox_attempt_receipt_idx
  ON usage_outbox (org_id, attempt_id) WHERE attempt_id IS NOT NULL;
CREATE UNIQUE INDEX usage_outbox_resource_receipt_idx
  ON usage_outbox (org_id, resource_permit_id) WHERE resource_permit_id IS NOT NULL;
CREATE INDEX usage_outbox_import_idx ON usage_outbox (org_id, state, created_at_ms);
CREATE INDEX usage_outbox_account_idx ON usage_outbox (org_id, account_id, created_at_ms);
CREATE INDEX usage_outbox_resource_permit_idx
  ON usage_outbox (org_id, resource_id, resource_permit_id);

INSERT INTO function_invocations (
  org_id, id, account_id, subject_kind, canvas_id,
  widget_definition_id, widget_revision_id, widget_instance_id,
  preview_id, preview_revision_id,
  function_id, function_name, definition_revision, artifact_digest_sha256,
  contract_digest_sha256, runtime_abi, tenant_cell_id, tenant_placement_epoch,
  tenant_request_id, tenant_roles_json, tenant_capabilities_json, input_json,
  input_digest_sha256, idempotency_key, policy_version, priority, timeout_ms, memory_tier,
  output_byte_limit, log_byte_limit, retry_mode, max_attempts, initial_backoff_ms, max_backoff_ms,
  status, result_json, failure_json, result_digest_sha256, output_byte_size,
  log_byte_size, body_state, retains_revision, created_at_ms, available_at_ms,
  deadline_at_ms, cancel_requested_at_ms, started_at_ms, finished_at_ms,
  bodies_compacted_at_ms
)
SELECT
  org_id, id, account_id, 'widget_instance', canvas_id,
  widget_definition_id, widget_revision_id, widget_instance_id,
  NULL, NULL,
  function_id, function_name, definition_revision, artifact_digest_sha256,
  contract_digest_sha256, runtime_abi, tenant_cell_id, tenant_placement_epoch,
  tenant_request_id, tenant_roles_json, tenant_capabilities_json, input_json,
  input_digest_sha256, idempotency_key, policy_version, priority, timeout_ms, memory_tier,
  output_byte_limit, log_byte_limit, retry_mode, max_attempts, initial_backoff_ms, max_backoff_ms,
  status, result_json, failure_json, result_digest_sha256, output_byte_size,
  log_byte_size, body_state, retains_revision, created_at_ms, available_at_ms,
  deadline_at_ms, cancel_requested_at_ms, started_at_ms, finished_at_ms,
  bodies_compacted_at_ms
FROM function_invocations_m8;

INSERT INTO function_attempts SELECT * FROM function_attempts_m8;
INSERT INTO invocation_leases SELECT * FROM invocation_leases_m8;

INSERT INTO idempotency_records (
  org_id, id, function_id, scope_kind, canvas_id, widget_instance_id,
  preview_id, preview_revision_id, idempotency_key, request_fingerprint_sha256,
  widget_definition_id, widget_revision_id, invocation_id, created_at_ms, expires_at_ms
)
SELECT
  org_id, id, function_id, scope_kind, canvas_id, widget_instance_id,
  NULL, NULL, idempotency_key, request_fingerprint_sha256,
  widget_definition_id, widget_revision_id, invocation_id, created_at_ms, expires_at_ms
FROM idempotency_records_m8;

INSERT INTO resource_write_permits SELECT * FROM resource_write_permits_m8;
INSERT INTO usage_outbox SELECT * FROM usage_outbox_m8;

DROP TABLE usage_outbox_m8;
DROP TABLE resource_write_permits_m8;
DROP TABLE idempotency_records_m8;
DROP TABLE invocation_leases_m8;
DROP TABLE function_attempts_m8;
DROP TABLE function_invocations_m8;
