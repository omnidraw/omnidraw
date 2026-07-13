import type {
  TActorInstance,
  TActorResource,
  TActorResourceBinding,
  TActorResourceKeyValue,
  TJson,
} from "../model"
import {
  ACTOR_RESOURCE_KEY_VALUE_LIST_DEFAULT_LIMIT,
  ACTOR_RESOURCE_KEY_VALUE_LIST_MAX_LIMIT,
} from "../CONSTANTS"

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertJsonValue(value: unknown, ancestors: Set<object>): asserts value is TJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite")
    return
  }
  if (typeof value !== "object") throw new TypeError("Value is not JSON-compatible")
  if (ancestors.has(value)) throw new TypeError("Cyclic values are not JSON-compatible")

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValue(item, ancestors)
      return
    }
    if (!isPlainRecord(value)) throw new TypeError("Class instances are not JSON-compatible")
    for (const item of Object.values(value)) assertJsonValue(item, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

export function fnParseJsonValue(value: unknown): TJson {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value
  assertJsonValue(parsed, new Set())
  return parsed
}

export function fnSerializeJsonValue(value: unknown): string {
  assertJsonValue(value, new Set())
  return JSON.stringify(value)
}

export function fnActorResourceKeyValueListLimit(limit: number | undefined): number {
  const resolved = limit ?? ACTOR_RESOURCE_KEY_VALUE_LIST_DEFAULT_LIMIT
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > ACTOR_RESOURCE_KEY_VALUE_LIST_MAX_LIMIT) {
    throw new RangeError(`Actor resource key-value list limit must be between 1 and ${ACTOR_RESOURCE_KEY_VALUE_LIST_MAX_LIMIT}`)
  }
  return resolved
}

export function fnParseActorResourceRow(row: unknown): TActorResource {
  const value = row as Omit<TActorResource, "last_error"> & {
    last_error: unknown | null
  }
  return {
    ...value,
    last_error: value.last_error === null || value.last_error === undefined
      ? null
      : fnParseJsonValue(value.last_error),
  }
}

export function fnParseActorResourceBindingRow(row: unknown): TActorResourceBinding {
  const value = row as TActorResourceBinding
  return {
    ...value,
    allow_read: Boolean(value.allow_read),
    allow_write: Boolean(value.allow_write),
  }
}

export function fnParseActorResourceKeyValueRow(row: unknown): TActorResourceKeyValue {
  const value = row as Omit<TActorResourceKeyValue, "value"> & { value: unknown }
  return {
    ...value,
    value: fnParseJsonValue(value.value),
  }
}

export function fnParseActorInstanceRow(row: unknown): TActorInstance {
  const value = row as TActorInstance
  return {
    ...value,
    machine_context: fnParseJsonValue(value.machine_context),
    last_error: value.last_error === null || value.last_error === undefined
      ? null
      : fnParseJsonValue(value.last_error) as TActorInstance["last_error"],
  }
}
