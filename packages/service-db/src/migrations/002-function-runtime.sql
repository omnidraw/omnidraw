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

ALTER TABLE usage_outbox RENAME TO usage_outbox_m1;
ALTER TABLE resource_write_permits RENAME TO resource_write_permits_m1;
ALTER TABLE idempotency_records RENAME TO idempotency_records_m1;
ALTER TABLE invocation_leases RENAME TO invocation_leases_m1;
ALTER TABLE function_attempts RENAME TO function_attempts_m1;
ALTER TABLE function_invocations RENAME TO function_invocations_m1;

ALTER TABLE widget_definition_revisions
  ADD COLUMN function_descriptors_json TEXT NOT NULL
  DEFAULT '{"format":"vibecanvas.server-functions.v1","functions":[]}'
  CHECK (
    json_valid(function_descriptors_json)
    AND json_type(function_descriptors_json) = 'object'
    AND json_extract(function_descriptors_json, '$.format') = 'vibecanvas.server-functions.v1'
    AND json_type(function_descriptors_json, '$.functions') = 'array'
  );

ALTER TABLE widget_definition_revisions
  ADD COLUMN function_descriptors_digest_sha256 TEXT NOT NULL
  DEFAULT '2ffcc4002f0abc5490138a0da6fcce85b1ee82bc9e56f0000fb552953839f40b'
  CHECK (
    length(function_descriptors_digest_sha256) = 64
    AND function_descriptors_digest_sha256 = lower(function_descriptors_digest_sha256)
    AND function_descriptors_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  );

ALTER TABLE widget_definition_revisions
  ADD COLUMN contract_format_version INTEGER NOT NULL DEFAULT 1
  CHECK (contract_format_version IN (1, 2));

CREATE TABLE function_definitions (
  org_id TEXT NOT NULL CHECK (
    length(org_id) = 36 AND org_id = lower(org_id)
    AND substr(org_id, 9, 1) = '-' AND substr(org_id, 14, 1) = '-'
    AND substr(org_id, 19, 1) = '-' AND substr(org_id, 24, 1) = '-'
    AND length(replace(org_id, '-', '')) = 32
    AND replace(org_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 200),
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
  export_name TEXT NOT NULL CHECK (length(trim(export_name)) BETWEEN 1 AND 200),
  effect TEXT NOT NULL CHECK (effect IN ('fn', 'fx', 'tx')),
  definition_revision INTEGER NOT NULL CHECK (definition_revision >= 1),
  server_artifact_id TEXT NOT NULL CHECK (
    length(server_artifact_id) = 36 AND server_artifact_id = lower(server_artifact_id)
    AND substr(server_artifact_id, 9, 1) = '-' AND substr(server_artifact_id, 14, 1) = '-'
    AND substr(server_artifact_id, 19, 1) = '-' AND substr(server_artifact_id, 24, 1) = '-'
    AND length(replace(server_artifact_id, '-', '')) = 32
    AND replace(server_artifact_id, '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  server_artifact_kind TEXT NOT NULL DEFAULT 'server' CHECK (server_artifact_kind = 'server'),
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
  descriptor_digest_sha256 TEXT NOT NULL CHECK (
    length(descriptor_digest_sha256) = 64
    AND descriptor_digest_sha256 = lower(descriptor_digest_sha256)
    AND descriptor_digest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  runtime_abi TEXT NOT NULL CHECK (length(trim(runtime_abi)) BETWEEN 1 AND 100),
  input_schema_json TEXT NOT NULL CHECK (
    json_valid(input_schema_json) AND json_type(input_schema_json) = 'object'
  ),
  output_schema_json TEXT NOT NULL CHECK (
    json_valid(output_schema_json) AND json_type(output_schema_json) = 'object'
  ),
  resources_json TEXT NOT NULL CHECK (
    json_valid(resources_json) AND json_type(resources_json) = 'array'
  ),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms >= 1),
  memory_tier TEXT NOT NULL CHECK (memory_tier IN ('small', 'medium', 'large')),
  output_byte_limit INTEGER NOT NULL CHECK (output_byte_limit >= 1),
  log_byte_limit INTEGER NOT NULL CHECK (log_byte_limit >= 0),
  retry_mode TEXT NOT NULL CHECK (retry_mode IN ('none', 'idempotent')),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  initial_backoff_ms INTEGER NOT NULL CHECK (initial_backoff_ms >= 0),
  max_backoff_ms INTEGER NOT NULL CHECK (max_backoff_ms >= initial_backoff_ms),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, widget_definition_id, widget_revision_id, id),
  UNIQUE (org_id, widget_definition_id, widget_revision_id, export_name),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, widget_definition_id, widget_revision_id)
    REFERENCES widget_definition_revisions (org_id, definition_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, server_artifact_id, server_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  CHECK ((retry_mode = 'none' AND max_attempts = 1) OR retry_mode = 'idempotent')
) STRICT;

CREATE INDEX function_definitions_lookup_idx
  ON function_definitions (org_id, widget_revision_id, export_name);
CREATE INDEX function_definitions_artifact_idx
  ON function_definitions (org_id, server_artifact_id, server_artifact_kind);

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
  canvas_id TEXT NOT NULL CHECK (
    length(canvas_id) = 36 AND canvas_id = lower(canvas_id)
    AND substr(canvas_id, 9, 1) = '-' AND substr(canvas_id, 14, 1) = '-'
    AND substr(canvas_id, 19, 1) = '-' AND substr(canvas_id, 24, 1) = '-'
    AND length(replace(canvas_id, '-', '')) = 32
    AND replace(canvas_id, '-', '') NOT GLOB '*[^0-9a-f]*'
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
  widget_instance_id TEXT NOT NULL CHECK (
    length(widget_instance_id) = 36 AND widget_instance_id = lower(widget_instance_id)
    AND substr(widget_instance_id, 9, 1) = '-' AND substr(widget_instance_id, 14, 1) = '-'
    AND substr(widget_instance_id, 19, 1) = '-' AND substr(widget_instance_id, 24, 1) = '-'
    AND length(replace(widget_instance_id, '-', '')) = 32
    AND replace(widget_instance_id, '-', '') NOT GLOB '*[^0-9a-f]*'
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
  input_json TEXT CHECK (
    input_json IS NULL OR json_valid(input_json)
  ),
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
    finished_at_ms IS NULL
    OR finished_at_ms >= coalesce(started_at_ms, created_at_ms)
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
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('organization', 'canvas', 'widget_instance')),
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
  FOREIGN KEY (org_id, widget_definition_id, widget_revision_id)
    REFERENCES widget_definition_revisions (org_id, definition_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id) REFERENCES function_invocations (org_id, id) ON DELETE RESTRICT,
  CHECK (
    (scope_kind = 'organization' AND canvas_id IS NULL AND widget_instance_id IS NULL)
    OR (scope_kind = 'canvas' AND canvas_id IS NOT NULL AND widget_instance_id IS NULL)
    OR (scope_kind = 'widget_instance' AND canvas_id IS NULL AND widget_instance_id IS NOT NULL)
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
  org_id, id, account_id, canvas_id, widget_definition_id, widget_revision_id, widget_instance_id,
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
  invocation.org_id,
  invocation.id,
  invocation.account_id,
  instance.canvas_id,
  invocation.widget_definition_id,
  invocation.widget_revision_id,
  invocation.widget_instance_id,
  invocation.function_name,
  invocation.function_name,
  revision.revision_number,
  coalesce(server_artifact.digest_sha256, printf('%064d', 0)),
  revision.contract_digest_sha256,
  coalesce(json_extract(revision.manifest_json, '$.server.runtimeAbi'), 'vibecanvas.bun.v1'),
  '00000000-0000-4000-8000-000000000003',
  1,
  'pre-m6:' || invocation.id,
  json_array(membership.role),
  json_array(),
  invocation.input_json,
  invocation.input_digest_sha256,
  coalesce(
    (
      SELECT record.idempotency_key
      FROM idempotency_records_m1 AS record
      WHERE record.org_id = invocation.org_id AND record.invocation_id = invocation.id
      ORDER BY record.created_at_ms ASC, record.id ASC
      LIMIT 1
    ),
    'pre-m6:' || invocation.id
  ),
  invocation.policy_version,
  invocation.priority,
  max(1, invocation.deadline_at_ms - invocation.created_at_ms),
  'small',
  max(1048576, invocation.output_byte_size),
  max(262144, invocation.log_byte_size),
  'none',
  1,
  0,
  0,
  CASE
    WHEN invocation.status IN ('queued', 'claimed', 'running') THEN 'failed'
    ELSE invocation.status
  END,
  CASE WHEN invocation.status = 'succeeded' THEN coalesce(invocation.result_json, 'null') ELSE NULL END,
  CASE
    WHEN invocation.status IN ('queued', 'claimed', 'running') THEN json_object(
      'owner', 'platform',
      'code', 'PRE_M6_INVOCATION_NOT_RESUMABLE',
      'message', 'Pre-M6 invocation was terminalized because its exact function registration is unavailable',
      'retryable', json('false')
    )
    WHEN invocation.status IN ('failed', 'cancelled', 'timed_out') THEN json_object(
      'owner', CASE WHEN invocation.status = 'cancelled' THEN 'cancelled' ELSE 'platform' END,
      'code', 'PRE_M6_TERMINAL_STATE',
      'message', 'Migrated pre-M6 terminal invocation',
      'retryable', json('false')
    )
    ELSE NULL
  END,
  NULL,
  invocation.output_byte_size,
  invocation.log_byte_size,
  'full',
  1,
  invocation.created_at_ms,
  invocation.created_at_ms,
  invocation.deadline_at_ms,
  NULL,
  invocation.started_at_ms,
  CASE
    WHEN invocation.status IN ('queued', 'claimed', 'running')
      THEN max(invocation.created_at_ms, coalesce(invocation.started_at_ms, invocation.created_at_ms))
    ELSE invocation.finished_at_ms
  END,
  NULL
FROM function_invocations_m1 AS invocation
JOIN widget_definition_revisions AS revision
  ON revision.org_id = invocation.org_id
 AND revision.definition_id = invocation.widget_definition_id
 AND revision.id = invocation.widget_revision_id
JOIN organization_memberships AS membership
  ON membership.org_id = invocation.org_id
 AND membership.account_id = invocation.account_id
JOIN widget_instances AS instance
  ON instance.org_id = invocation.org_id
 AND instance.definition_id = invocation.widget_definition_id
 AND instance.revision_id = invocation.widget_revision_id
 AND instance.id = invocation.widget_instance_id
LEFT JOIN artifact_references AS server_artifact
  ON server_artifact.org_id = revision.org_id
 AND server_artifact.id = revision.server_artifact_id
 AND server_artifact.kind = 'server';

INSERT INTO function_attempts (
  org_id, id, invocation_id, attempt_number, lease_epoch, status, sandbox_driver,
  memory_tier, active_wall_ms, cpu_ms, allocated_memory_byte_ms, peak_rss_bytes,
  disk_read_bytes, disk_write_bytes, network_rx_bytes, network_tx_bytes,
  output_byte_size, log_byte_size, cold_start, failure_owner, failure_json,
  billable, created_at_ms, started_at_ms, guest_code_entered_at_ms, finished_at_ms
)
SELECT
  org_id, id, invocation_id, attempt_number, lease_epoch,
  CASE WHEN status IN ('starting', 'running') THEN 'lost' ELSE status END,
  sandbox_driver,
  memory_tier, active_wall_ms, cpu_ms, allocated_memory_byte_ms, peak_rss_bytes,
  disk_read_bytes, disk_write_bytes, network_rx_bytes, network_tx_bytes,
  0, 0, cold_start,
  CASE WHEN status IN ('starting', 'running') THEN 'platform' ELSE failure_owner END,
  CASE
    WHEN status IN ('starting', 'running') THEN json_object(
      'owner', 'platform',
      'code', 'PRE_M6_ATTEMPT_NOT_RESUMABLE',
      'message', 'Pre-M6 attempt was lost because its exact function registration is unavailable',
      'retryable', json('false')
    )
    WHEN failure_owner IS NOT NULL THEN json_object(
      'owner', failure_owner,
      'code', 'PRE_M6_ATTEMPT_STATE',
      'message', 'Migrated pre-M6 attempt',
      'retryable', json('false')
    )
    ELSE NULL
  END,
  billable,
  created_at_ms,
  CASE WHEN status = 'starting' THEN created_at_ms ELSE started_at_ms END,
  CASE WHEN status = 'starting' THEN NULL ELSE started_at_ms END,
  CASE
    WHEN status IN ('starting', 'running')
      THEN max(created_at_ms, coalesce(started_at_ms, created_at_ms))
    ELSE finished_at_ms
  END
FROM function_attempts_m1;

-- No pre-M6 lease survives the executable-registration cutover. Every old
-- nonterminal invocation/attempt above is terminalized fail-closed.

INSERT INTO idempotency_records (
  org_id, id, function_id, scope_kind, canvas_id, widget_instance_id,
  idempotency_key, request_fingerprint_sha256, widget_definition_id,
  widget_revision_id, invocation_id, created_at_ms, expires_at_ms
)
SELECT
  record.org_id, record.id, invocation.function_id, record.scope_kind,
  record.canvas_id, record.widget_instance_id, record.idempotency_key,
  record.request_fingerprint_sha256, record.widget_definition_id,
  record.widget_revision_id, record.invocation_id, record.created_at_ms,
  record.expires_at_ms
FROM idempotency_records_m1 AS record
JOIN function_invocations AS invocation
  ON invocation.org_id = record.org_id AND invocation.id = record.invocation_id;

INSERT INTO resource_write_permits (
  org_id, id, resource_id, invocation_id, attempt_id, lease_epoch,
  operation_name, operation_id, operation_fingerprint_sha256,
  status, result_json, result_digest_sha256,
  issued_at_ms, expires_at_ms, consumed_at_ms
)
SELECT
  org_id, id, resource_id, invocation_id, attempt_id, lease_epoch,
  operation_name, id, printf('%064d', 0),
  CASE WHEN status = 'active' THEN 'expired' ELSE status END,
  CASE WHEN status = 'consumed' THEN 'null' ELSE NULL END,
  CASE WHEN status = 'consumed' THEN printf('%064d', 0) ELSE NULL END,
  issued_at_ms, expires_at_ms, consumed_at_ms
FROM resource_write_permits_m1;

INSERT INTO usage_outbox (
  org_id, id, account_id, attempt_id, invocation_id, function_id,
  definition_revision, sandbox_driver, memory_tier, queued_at_ms,
  started_at_ms, finished_at_ms, cold_start, resource_id, resource_permit_id,
  state, outcome, failure_owner, billable, policy_version, active_wall_ms,
  cpu_ms, allocated_memory_byte_ms, peak_rss_bytes, disk_read_bytes,
  disk_write_bytes, network_rx_bytes, network_tx_bytes, created_at_ms,
  imported_at_ms
)
SELECT
  usage.org_id, usage.id, usage.account_id, usage.attempt_id,
  invocation.id, invocation.function_id, invocation.definition_revision,
  attempt.sandbox_driver, attempt.memory_tier, invocation.created_at_ms,
  attempt.started_at_ms, coalesce(attempt.finished_at_ms, usage.created_at_ms),
  attempt.cold_start, usage.resource_id, usage.resource_permit_id,
  usage.state, usage.outcome, usage.failure_owner, usage.billable,
  usage.policy_version, usage.active_wall_ms, usage.cpu_ms,
  usage.allocated_memory_byte_ms, usage.peak_rss_bytes, usage.disk_read_bytes,
  usage.disk_write_bytes, usage.network_rx_bytes, usage.network_tx_bytes,
  usage.created_at_ms, usage.imported_at_ms
FROM usage_outbox_m1 AS usage
LEFT JOIN resource_write_permits AS permit
  ON permit.org_id = usage.org_id AND permit.id = usage.resource_permit_id
JOIN function_attempts AS attempt
  ON attempt.org_id = usage.org_id
  AND attempt.id = coalesce(usage.attempt_id, permit.attempt_id)
JOIN function_invocations AS invocation
  ON invocation.org_id = attempt.org_id AND invocation.id = attempt.invocation_id;

INSERT OR IGNORE INTO usage_outbox (
  org_id, id, account_id, attempt_id, invocation_id, function_id,
  definition_revision, sandbox_driver, memory_tier, queued_at_ms,
  started_at_ms, finished_at_ms, cold_start, resource_id, resource_permit_id,
  state, outcome, failure_owner, billable, policy_version, active_wall_ms,
  cpu_ms, allocated_memory_byte_ms, peak_rss_bytes, disk_read_bytes,
  disk_write_bytes, network_rx_bytes, network_tx_bytes, created_at_ms,
  imported_at_ms
)
SELECT
  attempt.org_id,
  attempt.id,
  invocation.account_id,
  attempt.id,
  invocation.id,
  invocation.function_id,
  invocation.definition_revision,
  attempt.sandbox_driver,
  attempt.memory_tier,
  invocation.created_at_ms,
  attempt.started_at_ms,
  attempt.finished_at_ms,
  attempt.cold_start,
  NULL,
  NULL,
  'pending',
  'lost',
  'platform',
  attempt.billable,
  invocation.policy_version,
  attempt.active_wall_ms,
  attempt.cpu_ms,
  attempt.allocated_memory_byte_ms,
  attempt.peak_rss_bytes,
  attempt.disk_read_bytes,
  attempt.disk_write_bytes,
  attempt.network_rx_bytes,
  attempt.network_tx_bytes,
  attempt.finished_at_ms,
  NULL
FROM function_attempts AS attempt
JOIN function_invocations AS invocation
  ON invocation.org_id = attempt.org_id AND invocation.id = attempt.invocation_id
WHERE attempt.status = 'lost';

DROP TABLE usage_outbox_m1;
DROP TABLE resource_write_permits_m1;
DROP TABLE idempotency_records_m1;
DROP TABLE invocation_leases_m1;
DROP TABLE function_attempts_m1;
DROP TABLE function_invocations_m1;
