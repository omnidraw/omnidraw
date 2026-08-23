import type {
  TDbResourceApplyRun,
  TDbResourceBackup,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TResourceDescriptor,
  TResourcePlacement,
  TSafeResourceError,
} from '#backend/shell/resources';

function integerFromSql(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`Stored ${label} is invalid.`);
  }
  return number;
}

function timestampFromSql(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    throw new TypeError(`Stored ${label} is not a UTC whole-second timestamp.`);
  }
  return value;
}

function nullableTimestampFromSql(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : timestampFromSql(value, label);
}

function nullableJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function booleanFromSql(value: unknown, label: string): boolean {
  if (value !== true && value !== false && value !== 0 && value !== 1) {
    throw new TypeError(`Stored ${label} is invalid.`);
  }
  return Boolean(value);
}

export function fnResourceControlStoreSerializeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable.');
  return serialized;
}

export function fnResourceControlStoreDescriptor(row: unknown): TResourceDescriptor {
  const value = row as {
    id: string;
    kind: TResourceDescriptor['kind'];
    name: string;
    status: TResourceDescriptor['status'];
    last_error_json: unknown;
    created_at_sec: unknown;
    updated_at_sec: unknown;
  };
  return {
    id: value.id,
    kind: value.kind,
    name: value.name,
    status: value.status,
    lastError: nullableJson<TSafeResourceError>(value.last_error_json),
    createdAtSec: timestampFromSql(value.created_at_sec, 'resource creation time'),
    updatedAtSec: timestampFromSql(value.updated_at_sec, 'resource update time'),
  };
}

export function fnResourceControlStorePlacement(row: unknown): TResourcePlacement {
  const value = row as {
    resource_id: string;
    cell_id: TResourcePlacement['cellId'];
    placement_epoch: unknown;
    relative_path: string;
    status: TResourcePlacement['status'];
    created_at_sec: unknown;
    updated_at_sec: unknown;
  };
  return {
    resourceId: value.resource_id,
    cellId: value.cell_id,
    placementEpoch: integerFromSql(value.placement_epoch, 'resource placement epoch'),
    storageKey: value.relative_path,
    status: value.status,
    createdAtSec: timestampFromSql(value.created_at_sec, 'resource placement creation time'),
    updatedAtSec: timestampFromSql(value.updated_at_sec, 'resource placement update time'),
  };
}

export function fnResourceControlStoreDbDraft(row: unknown): TDbResourceDraft {
  const value = row as {
    id: string;
    resource_id: string;
    name: string;
    status: TDbResourceDraft['status'];
    last_error_json: unknown;
    created_at_sec: unknown;
    updated_at_sec: unknown;
    applied_at_sec: unknown;
  };
  return {
    id: value.id,
    resourceId: value.resource_id,
    name: value.name,
    status: value.status,
    lastError: nullableJson<TSafeResourceError>(value.last_error_json),
    createdAtSec: timestampFromSql(value.created_at_sec, 'DB draft creation time'),
    updatedAtSec: timestampFromSql(value.updated_at_sec, 'DB draft update time'),
    appliedAtSec: nullableTimestampFromSql(value.applied_at_sec, 'DB draft application time'),
  };
}

export function fnResourceControlStoreDbDraftChange(row: unknown): TDbResourceDraftChange {
  const value = row as {
    draft_id: string;
    sequence: unknown;
    kind: TDbResourceDraftChange['kind'];
    operation_json: unknown;
    sql_text: string;
    created_at_sec: unknown;
  };
  return {
    draftId: value.draft_id,
    sequence: integerFromSql(value.sequence, 'DB draft change sequence'),
    kind: value.kind,
    operation: nullableJson<TDbResourceDraftChange['operation']>(value.operation_json),
    sql: value.sql_text,
    createdAtSec: timestampFromSql(value.created_at_sec, 'DB draft change creation time'),
  };
}

export function fnResourceControlStoreDbApply(row: unknown): TDbResourceApplyRun {
  const value = row as {
    id: string;
    resource_id: string;
    draft_id: string | null;
    source_apply_id: string | null;
    status: TDbResourceApplyRun['status'];
    last_error_json: unknown;
    backup_retained: unknown;
    created_at_sec: unknown;
    completed_at_sec: unknown;
  };
  return {
    id: value.id,
    resourceId: value.resource_id,
    draftId: value.draft_id,
    sourceApplyId: value.source_apply_id,
    status: value.status,
    lastError: nullableJson<TSafeResourceError>(value.last_error_json),
    backupRetained: booleanFromSql(value.backup_retained, 'DB apply backup flag'),
    createdAtSec: timestampFromSql(value.created_at_sec, 'DB apply creation time'),
    completedAtSec: nullableTimestampFromSql(value.completed_at_sec, 'DB apply completion time'),
  };
}

export function fnResourceControlStoreDbBackup(row: unknown): TDbResourceBackup {
  const value = row as {
    id: string;
    resource_id: string;
    apply_run_id: string;
    relative_path: string;
    digest_sha256: string;
    byte_size: unknown;
    state: TDbResourceBackup['state'];
    created_at_sec: unknown;
    verified_at_sec: unknown;
    delete_after_sec: unknown;
  };
  return {
    id: value.id,
    resourceId: value.resource_id,
    applyRunId: value.apply_run_id,
    storageKey: value.relative_path,
    digestSha256: value.digest_sha256,
    byteSize: integerFromSql(value.byte_size, 'DB backup byte size'),
    state: value.state,
    createdAtSec: timestampFromSql(value.created_at_sec, 'DB backup creation time'),
    verifiedAtSec: timestampFromSql(value.verified_at_sec, 'DB backup verification time'),
    deleteAfterSec: nullableTimestampFromSql(value.delete_after_sec, 'DB backup deletion time'),
  };
}
