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
  const value = row as Omit<TDbResourceDraft, "last_error"> & { last_error: unknown | null }
  return {
    ...value,
    last_error: parseNullableJson(value.last_error),
  }
}

export function fnParseDbResourceDraftChangeRow(row: unknown): TDbResourceDraftChange {
  const value = row as Omit<TDbResourceDraftChange, "operation"> & { operation: unknown | null }
  return {
    ...value,
    operation: parseNullableJson(value.operation),
  }
}

export function fnParseDbResourceApplyRunRow(row: unknown): TDbResourceApplyRun {
  const value = row as Omit<TDbResourceApplyRun, "last_error" | "backup_retained"> & {
    last_error: unknown | null
    backup_retained: boolean | number
  }
  return {
    ...value,
    last_error: parseNullableJson(value.last_error),
    backup_retained: Boolean(value.backup_retained),
  }
}

export function fnParseDbResourceApplyInstanceResultRow(row: unknown): TDbResourceApplyInstanceResult {
  const value = row as Omit<TDbResourceApplyInstanceResult, "error" | "was_running"> & {
    error: unknown | null
    was_running: boolean | number
  }
  return {
    ...value,
    error: parseNullableJson(value.error),
    was_running: Boolean(value.was_running),
  }
}
