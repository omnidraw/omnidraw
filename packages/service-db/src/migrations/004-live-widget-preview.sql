-- Live widget Preview schema. Table rebuilds preserve the immutable v0-v3
-- schema while widening CHECK/FK contracts that SQLite cannot alter in place.
-- The managed migration runner disables FK enforcement for this transaction
-- and verifies every declared relationship through its schema contract before
-- commit.

CREATE TEMP TABLE a96_artifact_references_v3_data
AS SELECT * FROM artifact_references;

DROP TABLE artifact_references;

CREATE TABLE artifact_references (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ui', 'unsigned_ui', 'server', 'source', 'source_map')),
  digest_sha256 sha256_hex NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  retention_state TEXT NOT NULL CHECK (retention_state IN ('pinned', 'eligible', 'deleting')),
  retain_until_ms INTEGER CHECK (retain_until_ms IS NULL OR retain_until_ms >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, id, kind),
  UNIQUE (org_id, kind, digest_sha256),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  CHECK (retention_state <> 'eligible' OR retain_until_ms IS NOT NULL)
) STRICT;

INSERT INTO artifact_references
SELECT * FROM a96_artifact_references_v3_data;

DROP TABLE a96_artifact_references_v3_data;

CREATE TEMP TABLE a96_widget_definition_revisions_v3_data
AS SELECT * FROM widget_definition_revisions;

DROP TABLE widget_definition_revisions;

CREATE TABLE widget_definition_revisions (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  ui_artifact_id TEXT NOT NULL,
  ui_artifact_kind TEXT NOT NULL DEFAULT 'ui' CHECK (ui_artifact_kind = 'ui'),
  server_artifact_id TEXT,
  server_artifact_kind TEXT CHECK (
    (server_artifact_id IS NULL AND server_artifact_kind IS NULL)
    OR (server_artifact_id IS NOT NULL AND server_artifact_kind = 'server')
  ),
  manifest_json JSON NOT NULL CHECK (json_type(manifest_json) = 'object'),
  contract_digest_sha256 sha256_hex NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  function_descriptors_json JSON NOT NULL
    DEFAULT '{"format":"vibecanvas.server-functions.v1","functions":[]}'
    CHECK (
      json_type(function_descriptors_json) = 'object'
      AND json_extract(function_descriptors_json, '$.format') = 'vibecanvas.server-functions.v1'
      AND json_type(function_descriptors_json, '$.functions') = 'array'
    ),
  function_descriptors_digest_sha256 sha256_hex NOT NULL
    DEFAULT '2ffcc4002f0abc5490138a0da6fcce85b1ee82bc9e56f0000fb552953839f40b',
  ui_runtime_json JSON NOT NULL CHECK (
    json_type(ui_runtime_json) = 'object'
    AND json_extract(ui_runtime_json, '$.format') = 'vibecanvas.capsule-runtime.v1'
    AND json_type(ui_runtime_json, '$.target') = 'object'
    AND json_type(ui_runtime_json, '$.budgets') = 'object'
    AND json_type(ui_runtime_json, '$.capabilityRequests') = 'array'
    AND json_type(ui_runtime_json, '$.channels') IN ('null', 'object')
    AND json_extract(ui_runtime_json, '$.parkability.parkable') = 0
    AND json_type(ui_runtime_json, '$.signatureKeyIds') = 'array'
    AND json_array_length(ui_runtime_json, '$.signatureKeyIds') BETWEEN 1 AND 32
    AND json_remove(
      ui_runtime_json,
      '$.format',
      '$.capsuleArtifactHash',
      '$.target',
      '$.budgets',
      '$.capabilityRequests',
      '$.channels',
      '$.parkability',
      '$.signatureKeyIds'
    ) = '{}'
  ),
  capsule_artifact_hash TEXT NOT NULL CHECK (
    length(capsule_artifact_hash) = 71
    AND substr(capsule_artifact_hash, 1, 7) = 'sha256:'
    AND substr(capsule_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
    AND json_extract(ui_runtime_json, '$.capsuleArtifactHash') = capsule_artifact_hash
  ),
  capability_contract_digest_sha256 sha256_hex NOT NULL,
  channel_contract_digest_sha256 sha256_hex NOT NULL,
  capsule_build_identity_json JSON NOT NULL CHECK (
    json_type(capsule_build_identity_json) = 'object'
    AND json_extract(capsule_build_identity_json, '$.packageName') = '@omnidraw/capsule'
    AND length(json_extract(capsule_build_identity_json, '$.packageVersion')) BETWEEN 1 AND 100
    AND length(json_extract(capsule_build_identity_json, '$.buildApiVersion')) BETWEEN 1 AND 100
    AND length(json_extract(capsule_build_identity_json, '$.packageDigest')) = 71
    AND length(json_extract(capsule_build_identity_json, '$.runtimeBuildDigest')) = 71
    AND substr(json_extract(capsule_build_identity_json, '$.packageDigest'), 1, 7) = 'sha256:'
    AND substr(json_extract(capsule_build_identity_json, '$.runtimeBuildDigest'), 1, 7) = 'sha256:'
    AND json_remove(
      capsule_build_identity_json,
      '$.packageName',
      '$.packageVersion',
      '$.packageDigest',
      '$.buildApiVersion',
      '$.runtimeBuildDigest'
    ) = '{}'
  ),
  build_policy_id TEXT NOT NULL CHECK (length(trim(build_policy_id)) BETWEEN 1 AND 200),
  server_runtime_abi TEXT CHECK (
    (server_artifact_id IS NULL AND server_runtime_abi IS NULL)
    OR (server_artifact_id IS NOT NULL AND length(trim(server_runtime_abi)) BETWEEN 1 AND 100)
  ),
  construction_contract_digest_sha256 sha256_hex NOT NULL
    DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  distribution_provenance_json JSON NOT NULL
    DEFAULT '{"kind":"external-distribution","producer":{"name":"unavailable","version":"0","digest":"sha256:0000000000000000000000000000000000000000000000000000000000000000"},"sourceRevision":"0000000000000000000000000000000000000000000000000000000000000000","dependencyLockDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000","buildConfigurationDigest":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}'
  CHECK (
    json_type(distribution_provenance_json) = 'object'
    AND json_extract(distribution_provenance_json, '$.kind') = 'external-distribution'
    AND json_type(distribution_provenance_json, '$.producer') = 'object'
    AND length(json_extract(distribution_provenance_json, '$.producer.name')) BETWEEN 1 AND 300
    AND length(json_extract(distribution_provenance_json, '$.producer.version')) BETWEEN 1 AND 300
    AND length(json_extract(distribution_provenance_json, '$.producer.digest')) = 71
    AND substr(json_extract(distribution_provenance_json, '$.producer.digest'), 1, 7) = 'sha256:'
    AND length(json_extract(distribution_provenance_json, '$.sourceRevision')) = 64
    AND length(json_extract(distribution_provenance_json, '$.dependencyLockDigest')) = 71
    AND substr(json_extract(distribution_provenance_json, '$.dependencyLockDigest'), 1, 7) = 'sha256:'
    AND length(json_extract(distribution_provenance_json, '$.buildConfigurationDigest')) = 71
    AND substr(json_extract(distribution_provenance_json, '$.buildConfigurationDigest'), 1, 7) = 'sha256:'
  ),
  contract_format_version INTEGER NOT NULL DEFAULT 3 CHECK (contract_format_version = 3),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, definition_id, id),
  UNIQUE (org_id, definition_id, revision_number),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, definition_id) REFERENCES widget_definitions (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, ui_artifact_id, ui_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, server_artifact_id, server_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  CHECK (server_artifact_id IS NULL OR server_artifact_id <> ui_artifact_id)
) STRICT;

INSERT INTO widget_definition_revisions (
  org_id,
  id,
  definition_id,
  revision_number,
  ui_artifact_id,
  ui_artifact_kind,
  server_artifact_id,
  server_artifact_kind,
  manifest_json,
  contract_digest_sha256,
  created_at_ms,
  function_descriptors_json,
  function_descriptors_digest_sha256,
  ui_runtime_json,
  capsule_artifact_hash,
  capability_contract_digest_sha256,
  channel_contract_digest_sha256,
  capsule_build_identity_json,
  build_policy_id,
  server_runtime_abi,
  contract_format_version
)
SELECT
  org_id,
  id,
  definition_id,
  revision_number,
  ui_artifact_id,
  ui_artifact_kind,
  server_artifact_id,
  server_artifact_kind,
  manifest_json,
  contract_digest_sha256,
  created_at_ms,
  function_descriptors_json,
  function_descriptors_digest_sha256,
  ui_runtime_json,
  capsule_artifact_hash,
  capability_contract_digest_sha256,
  channel_contract_digest_sha256,
  capsule_build_identity_json,
  build_policy_id,
  server_runtime_abi,
  contract_format_version
FROM a96_widget_definition_revisions_v3_data;

DROP TABLE a96_widget_definition_revisions_v3_data;

CREATE TEMP TABLE a96_function_invocations_v3_data
AS SELECT * FROM function_invocations;

DROP TABLE function_invocations;

CREATE TABLE function_invocations (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('widget_instance', 'widget_preview')),
  canvas_id TEXT,
  widget_definition_id TEXT NOT NULL,
  widget_revision_id TEXT NOT NULL,
  widget_instance_id TEXT,
  function_id TEXT NOT NULL CHECK (length(trim(function_id)) BETWEEN 1 AND 200),
  function_name TEXT NOT NULL CHECK (length(trim(function_name)) BETWEEN 1 AND 200),
  definition_revision INTEGER NOT NULL CHECK (definition_revision >= 1),
  artifact_digest_sha256 sha256_hex NOT NULL,
  contract_digest_sha256 sha256_hex NOT NULL,
  runtime_abi TEXT NOT NULL CHECK (length(trim(runtime_abi)) BETWEEN 1 AND 100),
  tenant_cell_id TEXT NOT NULL CHECK (length(trim(tenant_cell_id)) BETWEEN 1 AND 200),
  tenant_placement_epoch INTEGER NOT NULL CHECK (tenant_placement_epoch >= 1),
  tenant_request_id TEXT NOT NULL CHECK (length(trim(tenant_request_id)) BETWEEN 1 AND 300),
  tenant_roles_json JSON NOT NULL CHECK (
    json_type(tenant_roles_json) = 'array'
  ),
  tenant_capabilities_json JSON NOT NULL CHECK (
    json_type(tenant_capabilities_json) = 'array'
  ),
  input_json JSON,
  input_digest_sha256 sha256_hex NOT NULL,
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
  status function_invocation_status NOT NULL,
  result_json JSON,
  failure_json JSON CHECK (
    failure_json IS NULL OR (json_type(failure_json) = 'object')
  ),
  result_digest_sha256 sha256_hex,
  output_byte_size INTEGER NOT NULL CHECK (output_byte_size >= 0),
  log_byte_size INTEGER NOT NULL CHECK (log_byte_size >= 0),
  body_state TEXT NOT NULL CHECK (body_state IN ('full', 'compacted')),
  retains_revision BOOLEAN NOT NULL,
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
  CHECK (canvas_id IS NOT NULL AND widget_instance_id IS NOT NULL),
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

INSERT INTO function_invocations
SELECT * FROM a96_function_invocations_v3_data;

DROP TABLE a96_function_invocations_v3_data;

CREATE TEMP TABLE a96_idempotency_records_v3_data
AS SELECT * FROM idempotency_records;

DROP TABLE idempotency_records;

CREATE TABLE idempotency_records (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  function_id TEXT NOT NULL CHECK (length(trim(function_id)) BETWEEN 1 AND 200),
  scope_kind TEXT NOT NULL CHECK (
    scope_kind IN ('organization', 'canvas', 'widget_instance', 'widget_preview')
  ),
  canvas_id TEXT,
  widget_instance_id TEXT,
  preview_id TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 300),
  request_fingerprint_sha256 sha256_hex NOT NULL,
  widget_definition_id TEXT NOT NULL,
  widget_revision_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms INTEGER CHECK (expires_at_ms IS NULL OR expires_at_ms > created_at_ms),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, canvas_id) REFERENCES canvases (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, widget_instance_id) REFERENCES widget_instances (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, preview_id) REFERENCES agent_previews (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, invocation_id) REFERENCES function_invocations (org_id, id) ON DELETE RESTRICT,
  CHECK (
    (scope_kind = 'organization' AND canvas_id IS NULL
      AND widget_instance_id IS NULL AND preview_id IS NULL)
    OR (scope_kind = 'canvas' AND canvas_id IS NOT NULL
      AND widget_instance_id IS NULL AND preview_id IS NULL)
    OR (scope_kind = 'widget_instance' AND canvas_id IS NULL
      AND widget_instance_id IS NOT NULL AND preview_id IS NULL)
    OR (scope_kind = 'widget_preview' AND canvas_id IS NULL
      AND widget_instance_id IS NULL AND preview_id IS NOT NULL)
  )
) STRICT;

INSERT INTO idempotency_records (
  org_id,
  id,
  function_id,
  scope_kind,
  canvas_id,
  widget_instance_id,
  preview_id,
  idempotency_key,
  request_fingerprint_sha256,
  widget_definition_id,
  widget_revision_id,
  invocation_id,
  created_at_ms,
  expires_at_ms
)
SELECT
  org_id,
  id,
  function_id,
  scope_kind,
  canvas_id,
  widget_instance_id,
  NULL,
  idempotency_key,
  request_fingerprint_sha256,
  widget_definition_id,
  widget_revision_id,
  invocation_id,
  created_at_ms,
  expires_at_ms
FROM a96_idempotency_records_v3_data;

DROP TABLE a96_idempotency_records_v3_data;

CREATE TEMP TABLE a96_agent_drafts_v3_data
AS SELECT * FROM agent_drafts;

DROP TABLE agent_drafts;

CREATE TABLE agent_drafts (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status agent_draft_status NOT NULL,
  source_relative_path TEXT NOT NULL CHECK (
    length(source_relative_path) BETWEEN 1 AND 1024
    AND source_relative_path = trim(source_relative_path)
    AND substr(source_relative_path, 1, 1) <> '/'
    AND source_relative_path NOT GLOB '[A-Za-z]:*'
    AND instr(source_relative_path, '\') = 0
    AND source_relative_path <> '.' AND source_relative_path <> '..'
    AND source_relative_path NOT LIKE './%' AND source_relative_path NOT LIKE '../%'
    AND source_relative_path NOT LIKE '%/./%' AND source_relative_path NOT LIKE '%/../%'
    AND source_relative_path NOT LIKE '%/.' AND source_relative_path NOT LIKE '%/..'
    AND source_relative_path NOT LIKE '%//%'
  ),
  source_digest_sha256 sha256_hex,
  committed_mutation_id TEXT CHECK (
    committed_mutation_id IS NULL
    OR length(trim(committed_mutation_id)) BETWEEN 1 AND 1024
  ),
  build_sequence INTEGER NOT NULL CHECK (build_sequence >= 0),
  last_error_json JSON CHECK (
    last_error_json IS NULL OR (json_type(last_error_json) = 'object')
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
  definition_id TEXT,
  published_revision_id TEXT,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, chat_id, source_relative_path),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, chat_id) REFERENCES agent_chats (org_id, id) ON DELETE CASCADE,
  CHECK (
    (source_digest_sha256 IS NULL AND committed_mutation_id IS NULL AND build_sequence = 0)
    OR (
      source_digest_sha256 IS NOT NULL
      AND committed_mutation_id IS NOT NULL
      AND build_sequence >= 1
    )
  )
) STRICT;

INSERT INTO agent_drafts (
  org_id,
  id,
  chat_id,
  name,
  status,
  source_relative_path,
  source_digest_sha256,
  committed_mutation_id,
  build_sequence,
  last_error_json,
  created_at_ms,
  updated_at_ms,
  definition_id,
  published_revision_id
)
SELECT
  org_id,
  id,
  chat_id,
  name,
  status,
  source_relative_path,
  source_digest_sha256,
  CASE
    WHEN source_digest_sha256 IS NULL THEN NULL
    ELSE 'v4-migration:' || substr(org_id, 1, 480) || ':' || substr(id, 1, 480)
  END,
  CASE WHEN source_digest_sha256 IS NULL THEN 0 ELSE 1 END,
  last_error_json,
  created_at_ms,
  updated_at_ms,
  definition_id,
  published_revision_id
FROM a96_agent_drafts_v3_data;

DROP TABLE a96_agent_drafts_v3_data;

CREATE TABLE agent_previews (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 300),
  account_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  frame_node_id TEXT NOT NULL CHECK (length(trim(frame_node_id)) BETWEEN 1 AND 300),
  draft_id TEXT NOT NULL,
  origin_chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('companion', 'placed')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'building', 'ready', 'failed', 'closed')),
  active_revision_id TEXT CHECK (
    active_revision_id IS NULL OR length(trim(active_revision_id)) BETWEEN 1 AND 300
  ),
  pending_build_id TEXT CHECK (
    pending_build_id IS NULL OR length(trim(pending_build_id)) BETWEEN 1 AND 300
  ),
  build_sequence INTEGER NOT NULL CHECK (build_sequence >= 0),
  binding_revision INTEGER NOT NULL CHECK (binding_revision >= 0),
  binding_plan_digest_sha256 sha256_hex,
  source_digest_sha256 sha256_hex,
  committed_mutation_id TEXT CHECK (
    committed_mutation_id IS NULL
    OR length(trim(committed_mutation_id)) BETWEEN 1 AND 1024
  ),
  runtime_diagnostics_json JSON NOT NULL DEFAULT '[]' CHECK (
    json_type(runtime_diagnostics_json) = 'array'
  ),
  published_preview_revision_id TEXT CHECK (
    published_preview_revision_id IS NULL
    OR length(trim(published_preview_revision_id)) BETWEEN 1 AND 300
  ),
  published_binding_revision INTEGER CHECK (
    published_binding_revision IS NULL OR published_binding_revision >= 0
  ),
  published_binding_plan_digest_sha256 sha256_hex,
  published_widget_revision_id TEXT CHECK (
    published_widget_revision_id IS NULL
    OR length(trim(published_widget_revision_id)) BETWEEN 1 AND 300
  ),
  published_idempotency_key TEXT CHECK (
    published_idempotency_key IS NULL
    OR (
      length(published_idempotency_key) BETWEEN 1 AND 200
      AND published_idempotency_key NOT GLOB '*[^A-Za-z0-9._~:+-]*'
    )
  ),
  last_error_json JSON CHECK (
    last_error_json IS NULL OR json_type(last_error_json) = 'object'
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
  closed_at_ms INTEGER CHECK (
    closed_at_ms IS NULL OR closed_at_ms >= created_at_ms
  ),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, canvas_id, frame_node_id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, account_id)
    REFERENCES organization_memberships (org_id, account_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, canvas_id)
    REFERENCES canvases (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, draft_id)
    REFERENCES agent_drafts (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, origin_chat_id)
    REFERENCES agent_chats (org_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'closed' AND closed_at_ms IS NOT NULL)
    OR (status <> 'closed' AND closed_at_ms IS NULL)
  ),
  CHECK (
    (
      source_digest_sha256 IS NULL
      AND committed_mutation_id IS NULL
      AND build_sequence = 0
    )
    OR (
      source_digest_sha256 IS NOT NULL
      AND committed_mutation_id IS NOT NULL
      AND build_sequence >= 1
    )
  ),
  CHECK (
    (
      published_preview_revision_id IS NULL
      AND published_binding_revision IS NULL
      AND published_binding_plan_digest_sha256 IS NULL
      AND published_widget_revision_id IS NULL
      AND published_idempotency_key IS NULL
    )
    OR (
      published_preview_revision_id IS NOT NULL
      AND published_binding_revision IS NOT NULL
      AND published_binding_plan_digest_sha256 IS NOT NULL
      AND published_widget_revision_id IS NOT NULL
      AND published_idempotency_key IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE agent_preview_revisions (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 300),
  preview_id TEXT NOT NULL CHECK (length(trim(preview_id)) BETWEEN 1 AND 300),
  draft_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  draft_revision_sha256 sha256_hex NOT NULL,
  committed_mutation_id TEXT NOT NULL CHECK (
    length(trim(committed_mutation_id)) BETWEEN 1 AND 1024
  ),
  source_snapshot_id TEXT NOT NULL CHECK (length(trim(source_snapshot_id)) BETWEEN 1 AND 300),
  source_digest_sha256 sha256_hex NOT NULL,
  source_artifact_id TEXT NOT NULL,
  source_artifact_kind TEXT NOT NULL DEFAULT 'source' CHECK (source_artifact_kind = 'source'),
  source_artifact_digest_sha256 sha256_hex NOT NULL,
  manifest_json JSON NOT NULL CHECK (json_type(manifest_json) = 'object'),
  function_descriptors_json JSON NOT NULL CHECK (
    json_type(function_descriptors_json) = 'object'
    AND json_extract(function_descriptors_json, '$.format') = 'vibecanvas.server-functions.v1'
    AND json_type(function_descriptors_json, '$.functions') = 'array'
  ),
  function_descriptors_digest_sha256 sha256_hex NOT NULL,
  capability_contract_digest_sha256 sha256_hex NOT NULL,
  channel_contract_digest_sha256 sha256_hex NOT NULL,
  construction_contract_digest_sha256 sha256_hex NOT NULL,
  preview_contract_digest_sha256 sha256_hex NOT NULL,
  builder_identity TEXT NOT NULL CHECK (length(trim(builder_identity)) BETWEEN 1 AND 300),
  capsule_build_identity_json JSON NOT NULL CHECK (
    json_type(capsule_build_identity_json) = 'object'
  ),
  build_policy_id TEXT NOT NULL CHECK (length(trim(build_policy_id)) BETWEEN 1 AND 300),
  distribution_provenance_json JSON NOT NULL CHECK (
    json_type(distribution_provenance_json) = 'object'
    AND json_extract(distribution_provenance_json, '$.kind') = 'external-distribution'
  ),
  unsigned_ui_artifact_id TEXT NOT NULL,
  unsigned_ui_artifact_kind TEXT NOT NULL DEFAULT 'unsigned_ui'
    CHECK (unsigned_ui_artifact_kind = 'unsigned_ui'),
  unsigned_ui_artifact_digest_sha256 sha256_hex NOT NULL,
  ui_artifact_id TEXT NOT NULL,
  ui_artifact_kind TEXT NOT NULL DEFAULT 'ui' CHECK (ui_artifact_kind = 'ui'),
  ui_artifact_digest_sha256 sha256_hex NOT NULL,
  ui_runtime_json JSON NOT NULL CHECK (
    json_type(ui_runtime_json) = 'object'
    AND json_extract(ui_runtime_json, '$.format') = 'vibecanvas.capsule-runtime.v1'
  ),
  capsule_artifact_hash TEXT NOT NULL CHECK (
    length(capsule_artifact_hash) = 71
    AND substr(capsule_artifact_hash, 1, 7) = 'sha256:'
    AND substr(capsule_artifact_hash, 8) = lower(substr(capsule_artifact_hash, 8))
    AND substr(capsule_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  server_artifact_id TEXT,
  server_artifact_kind TEXT CHECK (
    (server_artifact_id IS NULL AND server_artifact_kind IS NULL)
    OR (server_artifact_id IS NOT NULL AND server_artifact_kind = 'server')
  ),
  server_artifact_digest_sha256 sha256_hex,
  server_runtime_abi TEXT CHECK (
    server_runtime_abi IS NULL OR length(trim(server_runtime_abi)) BETWEEN 1 AND 100
  ),
  binding_revision INTEGER NOT NULL CHECK (binding_revision >= 0),
  binding_plan_digest_sha256 sha256_hex NOT NULL,
  build_sequence INTEGER NOT NULL CHECK (build_sequence >= 1),
  diagnostics_json JSON NOT NULL CHECK (
    json_type(diagnostics_json) = 'array'
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, preview_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, preview_id) REFERENCES agent_previews (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, draft_id) REFERENCES agent_drafts (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, source_artifact_id, source_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, unsigned_ui_artifact_id, unsigned_ui_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, ui_artifact_id, ui_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, server_artifact_id, server_artifact_kind)
    REFERENCES artifact_references (org_id, id, kind) ON DELETE RESTRICT,
  CHECK (draft_revision_sha256 = source_digest_sha256),
  CHECK (
    (server_artifact_id IS NULL AND server_artifact_kind IS NULL
      AND server_artifact_digest_sha256 IS NULL AND server_runtime_abi IS NULL)
    OR (server_artifact_id IS NOT NULL AND server_artifact_kind = 'server'
      AND server_artifact_digest_sha256 IS NOT NULL AND server_runtime_abi IS NOT NULL)
  ),
  CHECK (
    source_artifact_id <> unsigned_ui_artifact_id
    AND source_artifact_id <> ui_artifact_id
    AND unsigned_ui_artifact_id <> ui_artifact_id
    AND (server_artifact_id IS NULL OR (
      server_artifact_id <> source_artifact_id
      AND server_artifact_id <> unsigned_ui_artifact_id
      AND server_artifact_id <> ui_artifact_id
    ))
  )
) STRICT;

CREATE TABLE agent_preview_resource_bindings (
  org_id TEXT NOT NULL,
  preview_id TEXT NOT NULL CHECK (length(trim(preview_id)) BETWEEN 1 AND 300),
  revision_id TEXT NOT NULL CHECK (length(trim(revision_id)) BETWEEN 1 AND 300),
  slot_name TEXT NOT NULL CHECK (length(trim(slot_name)) BETWEEN 1 AND 100),
  resource_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('kv', 'secretStore', 'db')),
  is_required BOOLEAN NOT NULL,
  manifest_allow_read BOOLEAN NOT NULL,
  manifest_allow_write BOOLEAN NOT NULL,
  allow_read BOOLEAN NOT NULL,
  allow_write BOOLEAN NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, preview_id, revision_id, slot_name),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, preview_id, revision_id)
    REFERENCES agent_preview_revisions (org_id, preview_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, resource_id, resource_kind)
    REFERENCES resource_catalog (org_id, id, kind) ON DELETE RESTRICT,
  CHECK (allow_read = CAST(1 AS BOOLEAN) OR allow_write = CAST(1 AS BOOLEAN)),
  CHECK (allow_read <= manifest_allow_read AND allow_write <= manifest_allow_write)
) STRICT;

CREATE TABLE agent_preview_mount_leases (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 300),
  account_id TEXT NOT NULL,
  preview_id TEXT NOT NULL CHECK (length(trim(preview_id)) BETWEEN 1 AND 300),
  preview_revision_id TEXT NOT NULL CHECK (
    length(trim(preview_revision_id)) BETWEEN 1 AND 300
  ),
  canvas_id TEXT NOT NULL,
  frame_node_id TEXT NOT NULL CHECK (length(trim(frame_node_id)) BETWEEN 1 AND 300),
  acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0),
  renewed_at_ms INTEGER NOT NULL CHECK (renewed_at_ms >= acquired_at_ms),
  expires_at_ms INTEGER NOT NULL CHECK (
    expires_at_ms > renewed_at_ms
    AND expires_at_ms - renewed_at_ms BETWEEN 1000 AND 300000
  ),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, account_id)
    REFERENCES organization_memberships (org_id, account_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, canvas_id)
    REFERENCES canvases (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, preview_id)
    REFERENCES agent_previews (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, preview_id, preview_revision_id)
    REFERENCES agent_preview_revisions (org_id, preview_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE widget_preview_publication_idempotency (
  org_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 200
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._~:+-]*'
  ),
  request_fingerprint_sha256 sha256_hex NOT NULL,
  publication_identity_json JSON NOT NULL CHECK (
    json_type(publication_identity_json) = 'object'
  ),
  definition_id TEXT NOT NULL,
  published_revision_id TEXT NOT NULL,
  previous_active_revision_id TEXT,
  committed_definition_json JSON NOT NULL CHECK (
    json_type(committed_definition_json) = 'object'
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (org_id, account_id, idempotency_key),
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, account_id)
    REFERENCES organization_memberships (org_id, account_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX artifact_references_retention_idx
  ON artifact_references (org_id, retention_state, retain_until_ms);

CREATE INDEX widget_definition_revisions_lookup_idx
  ON widget_definition_revisions (org_id, definition_id, revision_number);

CREATE INDEX widget_definition_revisions_ui_artifact_idx
  ON widget_definition_revisions (org_id, ui_artifact_id, ui_artifact_kind);

CREATE INDEX widget_definition_revisions_server_artifact_idx
  ON widget_definition_revisions (org_id, server_artifact_id, server_artifact_kind);

CREATE INDEX widget_definition_revisions_capsule_artifact_idx
  ON widget_definition_revisions (org_id, capsule_artifact_hash);

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
  ON idempotency_records (org_id, preview_id, function_id, idempotency_key)
  WHERE scope_kind = 'widget_preview';

CREATE INDEX idempotency_records_expiry_idx
  ON idempotency_records (org_id, expires_at_ms);

CREATE INDEX idempotency_records_revision_idx
  ON idempotency_records (org_id, widget_definition_id, widget_revision_id);

CREATE INDEX idempotency_records_invocation_idx
  ON idempotency_records (org_id, invocation_id);

CREATE INDEX agent_drafts_chat_idx
  ON agent_drafts (org_id, chat_id, created_at_ms);

CREATE INDEX agent_drafts_definition_idx
  ON agent_drafts (org_id, definition_id, published_revision_id);

CREATE INDEX agent_previews_draft_idx
  ON agent_previews (org_id, draft_id, account_id, status, created_at_ms);

CREATE INDEX agent_previews_account_idx
  ON agent_previews (org_id, account_id, status, created_at_ms);

CREATE INDEX agent_previews_origin_chat_idx
  ON agent_previews (org_id, origin_chat_id, status);

CREATE INDEX agent_previews_active_revision_idx
  ON agent_previews (org_id, active_revision_id, status);

CREATE UNIQUE INDEX agent_previews_companion_idx
  ON agent_previews (org_id, account_id, draft_id, origin_chat_id)
  WHERE role = 'companion' AND status <> 'closed';

CREATE INDEX agent_preview_revisions_preview_idx
  ON agent_preview_revisions (org_id, preview_id, build_sequence, created_at_ms);

CREATE INDEX agent_preview_revisions_draft_idx
  ON agent_preview_revisions (org_id, draft_id, definition_id, created_at_ms);

CREATE INDEX agent_preview_revisions_definition_idx
  ON agent_preview_revisions (org_id, definition_id, created_at_ms);

CREATE INDEX agent_preview_revisions_source_artifact_idx
  ON agent_preview_revisions (org_id, source_artifact_id, source_artifact_kind);

CREATE INDEX agent_preview_revisions_unsigned_ui_artifact_idx
  ON agent_preview_revisions (
    org_id, unsigned_ui_artifact_id, unsigned_ui_artifact_kind
  );

CREATE INDEX agent_preview_revisions_ui_artifact_idx
  ON agent_preview_revisions (org_id, ui_artifact_id, ui_artifact_kind);

CREATE INDEX agent_preview_revisions_server_artifact_idx
  ON agent_preview_revisions (org_id, server_artifact_id, server_artifact_kind);

CREATE INDEX agent_preview_resource_bindings_resource_idx
  ON agent_preview_resource_bindings (org_id, resource_id, resource_kind);

CREATE INDEX agent_preview_mount_leases_expiry_idx
  ON agent_preview_mount_leases (expires_at_ms, org_id);

CREATE INDEX agent_preview_mount_leases_revision_idx
  ON agent_preview_mount_leases (
    org_id, preview_id, preview_revision_id, expires_at_ms
  );

CREATE INDEX agent_preview_mount_leases_account_idx
  ON agent_preview_mount_leases (org_id, account_id);

CREATE INDEX agent_preview_mount_leases_canvas_idx
  ON agent_preview_mount_leases (org_id, canvas_id);

CREATE INDEX widget_preview_publication_revision_idx
  ON widget_preview_publication_idempotency (
    org_id, definition_id, published_revision_id
  );
