import type {
  TDbResourceApplyRun,
  TDbResourceBackup,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TResourceBindingReference,
  TResourceDescriptor,
  TResourcePlacement,
  TSafeResourceError,
} from '@omnidraw/resource-runtime';

function numberFromSql(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`Stored ${label} is invalid.`);
  }
  return number;
}

function nullableJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export function fnResourceControlStoreSerializeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable.');
  return serialized;
}

export function fnResourceControlStoreDescriptor(row: unknown): TResourceDescriptor {
  const value = row as {
    org_id: TResourceDescriptor['orgId'];
    id: string;
    kind: TResourceDescriptor['kind'];
    name: string;
    status: TResourceDescriptor['status'];
    last_error_json: unknown;
    created_at_ms: unknown;
    updated_at_ms: unknown;
  };
  return {
    orgId: value.org_id,
    id: value.id,
    kind: value.kind,
    name: value.name,
    status: value.status,
    lastError: nullableJson<TSafeResourceError>(value.last_error_json),
    createdAtMs: numberFromSql(value.created_at_ms, 'resource created timestamp'),
    updatedAtMs: numberFromSql(value.updated_at_ms, 'resource updated timestamp'),
  };
}

export function fnResourceControlStorePlacement(row: unknown): TResourcePlacement {
  const value = row as {
    org_id: TResourcePlacement['orgId'];
    resource_id: string;
    cell_id: TResourcePlacement['cellId'];
    placement_epoch: unknown;
    relative_path: string;
    status: TResourcePlacement['status'];
    created_at_ms: unknown;
    updated_at_ms: unknown;
  };
  return {
    orgId: value.org_id,
    resourceId: value.resource_id,
    cellId: value.cell_id,
    placementEpoch: numberFromSql(value.placement_epoch, 'resource placement epoch'),
    storageKey: value.relative_path,
    status: value.status,
    createdAtMs: numberFromSql(value.created_at_ms, 'resource placement created timestamp'),
    updatedAtMs: numberFromSql(value.updated_at_ms, 'resource placement updated timestamp'),
  };
}

export function fnResourceControlStoreBinding(row: unknown): TResourceBindingReference {
  const value = row as {
    definition_id: string;
    revision_id: string;
    slot_name: string;
    resource_id: string;
    resource_kind: TResourceBindingReference['kind'];
    is_required: unknown;
    manifest_allow_read: unknown;
    manifest_allow_write: unknown;
    allow_read: unknown;
    allow_write: unknown;
    created_at_ms: unknown;
    updated_at_ms: unknown;
  };
  return {
    definitionId: value.definition_id,
    revisionId: value.revision_id,
    slot: value.slot_name,
    resourceId: value.resource_id,
    kind: value.resource_kind,
    required: Boolean(value.is_required),
    manifestAllowRead: Boolean(value.manifest_allow_read),
    manifestAllowWrite: Boolean(value.manifest_allow_write),
    allowRead: Boolean(value.allow_read),
    allowWrite: Boolean(value.allow_write),
    createdAtMs: numberFromSql(value.created_at_ms, 'resource binding created timestamp'),
    updatedAtMs: numberFromSql(value.updated_at_ms, 'resource binding updated timestamp'),
  };
}

export function fnResourceControlStoreDbDraft(row: unknown): TDbResourceDraft {
  const value = row as {
    org_id: TDbResourceDraft['orgId'];
    id: string;
    resource_id: string;
    name: string;
    status: TDbResourceDraft['status'];
    last_error_json: unknown;
    created_at_ms: unknown;
    updated_at_ms: unknown;
    applied_at_ms: unknown;
  };
  return {
    orgId: value.org_id,
    id: value.id,
    resourceId: value.resource_id,
    name: value.name,
    status: value.status,
    lastError: nullableJson<TSafeResourceError>(value.last_error_json),
    createdAtMs: numberFromSql(value.created_at_ms, 'DB draft created timestamp'),
    updatedAtMs: numberFromSql(value.updated_at_ms, 'DB draft updated timestamp'),
    appliedAtMs: value.applied_at_ms === null || value.applied_at_ms === undefined
      ? null
      : numberFromSql(value.applied_at_ms, 'DB draft applied timestamp'),
  };
}

export function fnResourceControlStoreDbDraftChange(row: unknown): TDbResourceDraftChange {
  const value = row as {
    org_id: TDbResourceDraftChange['orgId'];
    draft_id: string;
    sequence: unknown;
    kind: TDbResourceDraftChange['kind'];
    operation_json: unknown;
    sql_text: string;
    created_at_ms: unknown;
  };
  return {
    orgId: value.org_id,
    draftId: value.draft_id,
    sequence: numberFromSql(value.sequence, 'DB draft change sequence'),
    kind: value.kind,
    operation: nullableJson<TDbResourceDraftChange['operation']>(value.operation_json),
    sql: value.sql_text,
    createdAtMs: numberFromSql(value.created_at_ms, 'DB draft change created timestamp'),
  };
}

export function fnResourceControlStoreDbApply(row: unknown): TDbResourceApplyRun {
  const value = row as {
    org_id: TDbResourceApplyRun['orgId'];
    id: string;
    resource_id: string;
    draft_id: string | null;
    source_apply_id: string | null;
    status: TDbResourceApplyRun['status'];
    last_error_json: unknown;
    backup_retained: unknown;
    created_at_ms: unknown;
    completed_at_ms: unknown;
  };
  return {
    orgId: value.org_id,
    id: value.id,
    resourceId: value.resource_id,
    draftId: value.draft_id,
    sourceApplyId: value.source_apply_id,
    status: value.status,
    lastError: nullableJson<TSafeResourceError>(value.last_error_json),
    backupRetained: Boolean(value.backup_retained),
    createdAtMs: numberFromSql(value.created_at_ms, 'DB apply created timestamp'),
    completedAtMs: value.completed_at_ms === null || value.completed_at_ms === undefined
      ? null
      : numberFromSql(value.completed_at_ms, 'DB apply completed timestamp'),
  };
}

export function fnResourceControlStoreDbBackup(row: unknown): TDbResourceBackup {
  const value = row as {
    org_id: TDbResourceBackup['orgId'];
    id: string;
    resource_id: string;
    apply_run_id: string;
    relative_path: string;
    digest_sha256: string;
    byte_size: unknown;
    state: TDbResourceBackup['state'];
    created_at_ms: unknown;
    verified_at_ms: unknown;
    delete_after_ms: unknown;
  };
  return {
    orgId: value.org_id,
    id: value.id,
    resourceId: value.resource_id,
    applyRunId: value.apply_run_id,
    storageKey: value.relative_path,
    digestSha256: value.digest_sha256,
    byteSize: numberFromSql(value.byte_size, 'DB backup byte size'),
    state: value.state,
    createdAtMs: numberFromSql(value.created_at_ms, 'DB backup created timestamp'),
    verifiedAtMs: numberFromSql(value.verified_at_ms, 'DB backup verified timestamp'),
    deleteAfterMs: value.delete_after_ms === null || value.delete_after_ms === undefined
      ? null
      : numberFromSql(value.delete_after_ms, 'DB backup deletion timestamp'),
  };
}
