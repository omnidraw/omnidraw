import type {
  TDbResourceApplyRun,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TJson,
} from '../model';
import {
  DB_RESOURCE_APPLY_LIST_DEFAULT_LIMIT,
  DB_RESOURCE_APPLY_LIST_MAX_LIMIT,
  DB_RESOURCE_DRAFT_LIST_DEFAULT_LIMIT,
  DB_RESOURCE_DRAFT_LIST_MAX_LIMIT,
} from '../CONSTANTS';
import { fnParseJsonValue } from './fn.json';

function parseNullableJson(value: unknown): TJson | null {
  return value === null || value === undefined ? null : fnParseJsonValue(value);
}

function timestampSec(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    throw new TypeError(`Stored ${label} is not a whole-second timestamp.`);
  }
  return value;
}

function nullableTimestampSec(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : timestampSec(value, label);
}

function sqlBoolean(value: unknown): boolean {
  if (value !== true && value !== false && value !== 0 && value !== 1) {
    throw new TypeError('Stored SQL boolean is invalid.');
  }
  return Boolean(value);
}

function listLimit(
  limit: number | undefined,
  defaultLimit: number,
  maxLimit: number,
  label: string,
): number {
  const resolved = limit ?? defaultLimit;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maxLimit) {
    throw new RangeError(`${label} list limit must be between 1 and ${maxLimit}.`);
  }
  return resolved;
}

export function fnDbResourceTimestampCursor(value: string): string {
  return timestampSec(value, 'DbResource cursor');
}

export function fnDbResourceDraftListLimit(limit: number | undefined): number {
  return listLimit(
    limit,
    DB_RESOURCE_DRAFT_LIST_DEFAULT_LIMIT,
    DB_RESOURCE_DRAFT_LIST_MAX_LIMIT,
    'DbResource draft',
  );
}

export function fnDbResourceApplyListLimit(limit: number | undefined): number {
  return listLimit(
    limit,
    DB_RESOURCE_APPLY_LIST_DEFAULT_LIMIT,
    DB_RESOURCE_APPLY_LIST_MAX_LIMIT,
    'DbResource apply',
  );
}

export function fnParseDbResourceDraftRow(row: unknown): TDbResourceDraft {
  const value = row as {
    id: string;
    resource_id: string;
    name: string;
    status: TDbResourceDraft['status'];
    last_error_json: unknown | null;
    created_at_sec: unknown;
    updated_at_sec: unknown;
    applied_at_sec: unknown | null;
  };
  return {
    id: value.id,
    resourceId: value.resource_id,
    name: value.name,
    status: value.status,
    lastError: parseNullableJson(value.last_error_json),
    createdAtSec: timestampSec(value.created_at_sec, 'DbResource draft creation time'),
    updatedAtSec: timestampSec(value.updated_at_sec, 'DbResource draft update time'),
    appliedAtSec: nullableTimestampSec(value.applied_at_sec, 'DbResource draft application time'),
  };
}

export function fnParseDbResourceDraftChangeRow(row: unknown): TDbResourceDraftChange {
  const value = row as {
    draft_id: string;
    sequence: unknown;
    kind: TDbResourceDraftChange['kind'];
    operation_json: unknown | null;
    sql_text: string;
    created_at_sec: unknown;
  };
  const sequence = Number(value.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError('Stored DbResource draft change sequence is invalid.');
  }
  return {
    draftId: value.draft_id,
    sequence,
    kind: value.kind,
    operation: parseNullableJson(value.operation_json),
    sql: value.sql_text,
    createdAtSec: timestampSec(value.created_at_sec, 'DbResource draft change creation time'),
  };
}

export function fnParseDbResourceApplyRunRow(row: unknown): TDbResourceApplyRun {
  const value = row as {
    id: string;
    resource_id: string;
    draft_id: string | null;
    source_apply_id: string | null;
    status: TDbResourceApplyRun['status'];
    last_error_json: unknown | null;
    backup_retained: unknown;
    created_at_sec: unknown;
    completed_at_sec: unknown | null;
  };
  return {
    id: value.id,
    resourceId: value.resource_id,
    draftId: value.draft_id,
    sourceApplyId: value.source_apply_id,
    status: value.status,
    lastError: parseNullableJson(value.last_error_json),
    backupRetained: sqlBoolean(value.backup_retained),
    createdAtSec: timestampSec(value.created_at_sec, 'DbResource apply creation time'),
    completedAtSec: nullableTimestampSec(value.completed_at_sec, 'DbResource apply completion time'),
  };
}
