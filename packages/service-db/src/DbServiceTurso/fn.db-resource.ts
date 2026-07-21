import type {
  TDbResourceApplyInstanceResult,
  TDbResourceApplyRun,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TJson,
} from "../model"
import {
  DB_RESOURCE_APPLY_LIST_DEFAULT_LIMIT,
  DB_RESOURCE_APPLY_LIST_MAX_LIMIT,
  DB_RESOURCE_DRAFT_LIST_DEFAULT_LIMIT,
  DB_RESOURCE_DRAFT_LIST_MAX_LIMIT,
} from "../CONSTANTS"
import { fnParseJsonValue } from "./fn.actor-resource-row"
import { fnBooleanFromSql, fnNullableTimestampFromMs, fnTimestampFromMs } from "./fn.legacy-row"

function parseNullableJson(value: unknown): TJson | null {
  return value === null || value === undefined ? null : fnParseJsonValue(value)
}

function listLimit(limit: number | undefined, defaultLimit: number, maxLimit: number, label: string): number {
  const resolved = limit ?? defaultLimit
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maxLimit) {
    throw new RangeError(`${label} list limit must be between 1 and ${maxLimit}`)
  }
  return resolved
}

export function fnDbResourceDraftListLimit(limit: number | undefined): number {
  return listLimit(limit, DB_RESOURCE_DRAFT_LIST_DEFAULT_LIMIT, DB_RESOURCE_DRAFT_LIST_MAX_LIMIT, "DbResource draft")
}

export function fnDbResourceApplyListLimit(limit: number | undefined): number {
  return listLimit(limit, DB_RESOURCE_APPLY_LIST_DEFAULT_LIMIT, DB_RESOURCE_APPLY_LIST_MAX_LIMIT, "DbResource apply")
}

export function fnParseDbResourceDraftRow(row: unknown): TDbResourceDraft {
  const value = row as {
    id: string
    resource_id: string
    name: string
    status: TDbResourceDraft["status"]
    last_error_json: unknown | null
    created_at_ms: unknown
    updated_at_ms: unknown
    applied_at_ms: unknown | null
  }
  return {
    id: value.id,
    resource_id: value.resource_id,
    name: value.name,
    status: value.status,
    last_error: parseNullableJson(value.last_error_json),
    created_at: fnTimestampFromMs(value.created_at_ms),
    updated_at: fnTimestampFromMs(value.updated_at_ms),
    applied_at: fnNullableTimestampFromMs(value.applied_at_ms),
  }
}

export function fnParseDbResourceDraftChangeRow(row: unknown): TDbResourceDraftChange {
  const value = row as {
    draft_id: string
    sequence: number
    kind: TDbResourceDraftChange["kind"]
    operation_json: unknown | null
    sql_text: string
    created_at_ms: unknown
  }
  return {
    draft_id: value.draft_id,
    sequence: value.sequence,
    kind: value.kind,
    operation: parseNullableJson(value.operation_json),
    sql: value.sql_text,
    created_at: fnTimestampFromMs(value.created_at_ms),
  }
}

export function fnParseDbResourceApplyRunRow(row: unknown): TDbResourceApplyRun {
  const value = row as {
    id: string
    resource_id: string
    draft_id: string | null
    source_apply_id: string | null
    status: TDbResourceApplyRun["status"]
    last_error_json: unknown | null
    backup_retained: unknown
    created_at_ms: unknown
    completed_at_ms: unknown | null
  }
  return {
    id: value.id,
    resource_id: value.resource_id,
    draft_id: value.draft_id,
    source_apply_id: value.source_apply_id,
    status: value.status,
    last_error: parseNullableJson(value.last_error_json),
    backup_retained: fnBooleanFromSql(value.backup_retained),
    created_at: fnTimestampFromMs(value.created_at_ms),
    completed_at: fnNullableTimestampFromMs(value.completed_at_ms),
  }
}

export function fnParseDbResourceApplyInstanceResultRow(row: unknown): TDbResourceApplyInstanceResult {
  const value = row as {
    apply_id: string
    actor_instance_id: string
    actor_definition_name: string
    was_running: unknown
    status: TDbResourceApplyInstanceResult["status"]
    error_json: unknown | null
    updated_at_ms: unknown
  }
  return {
    apply_id: value.apply_id,
    actor_instance_id: value.actor_instance_id,
    actor_definition_name: value.actor_definition_name,
    was_running: fnBooleanFromSql(value.was_running),
    status: value.status,
    error: parseNullableJson(value.error_json),
    updated_at: fnTimestampFromMs(value.updated_at_ms),
  }
}
