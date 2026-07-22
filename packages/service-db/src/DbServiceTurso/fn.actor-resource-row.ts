import type {
  TActorConnection,
  TActorDefinition,
  TActorInstance,
  TActorResource,
  TActorResourceBinding,
  TJson,
} from "../model"
import { fnTimestampFromMs } from "./fn.legacy-row"

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

export function fnParseActorResourceRow(row: unknown): TActorResource {
  const value = row as {
    id: string
    kind: TActorResource["kind"]
    name: string
    status: TActorResource["status"]
    last_error_json: unknown | null
    created_at_ms: unknown
    updated_at_ms: unknown
  }
  return {
    id: value.id,
    kind: value.kind,
    name: value.name,
    status: value.status,
    last_error: value.last_error_json === null || value.last_error_json === undefined
      ? null
      : fnParseJsonValue(value.last_error_json),
    created_at: fnTimestampFromMs(value.created_at_ms),
    updated_at: fnTimestampFromMs(value.updated_at_ms),
  }
}

export function fnParseActorResourceBindingRow(row: unknown): TActorResourceBinding {
  const value = row as {
    definition_name: string
    slot_name: string
    resource_id: string
    allow_read: unknown
    allow_write: unknown
    created_at_ms: unknown
    updated_at_ms: unknown
  }
  return {
    actor_definition_name: value.definition_name,
    slot_name: value.slot_name,
    resource_id: value.resource_id,
    allow_read: Boolean(value.allow_read),
    allow_write: Boolean(value.allow_write),
    created_at: fnTimestampFromMs(value.created_at_ms),
    updated_at: fnTimestampFromMs(value.updated_at_ms),
  }
}

export function fnParseActorDefinitionRow(row: unknown): TActorDefinition {
  const value = row as {
    name: string
    slug: string
    url: string | null
    description: string | null
    manifest_relative_path: string
    created_at_ms: unknown
    updated_at_ms: unknown
  }
  return {
    name: value.name,
    slug: value.slug,
    url: value.url,
    description: value.description,
    manifest_path: value.manifest_relative_path,
    created_at: fnTimestampFromMs(value.created_at_ms),
    updated_at: fnTimestampFromMs(value.updated_at_ms),
  }
}

export function fnParseActorInstanceRow(row: unknown): TActorInstance {
  const value = row as {
    id: string
    canvas_id: string
    element_id: string
    actor_definition_name: string
    display_name: string
    status: TActorInstance["status"]
    machine_state: string
    machine_context_json: unknown
    last_error_json: unknown | null
    created_at_ms: unknown
    updated_at_ms: unknown
  }
  return {
    id: value.id,
    canvas_id: value.canvas_id,
    element_id: value.element_id,
    actor_definition_name: value.actor_definition_name,
    display_name: value.display_name,
    status: value.status,
    machine_state: value.machine_state,
    machine_context: fnParseJsonValue(value.machine_context_json),
    last_error: value.last_error_json === null || value.last_error_json === undefined
      ? null
      : fnParseJsonValue(value.last_error_json) as TActorInstance["last_error"],
    created_at: fnTimestampFromMs(value.created_at_ms),
    updated_at: fnTimestampFromMs(value.updated_at_ms),
  }
}

export function fnParseActorConnectionRow(row: unknown): TActorConnection {
  const value = row as {
    id: string
    canvas_id: string
    source_actor_instance_id: string
    target_actor_instance_id: string
    enabled: unknown
    label: string | null
    message_name_whitelist_json: string | null
    style_json: unknown
    created_at_ms: unknown
  }
  return {
    id: value.id,
    canvas_id: value.canvas_id,
    source_actor_instance_id: value.source_actor_instance_id,
    target_actor_instance_id: value.target_actor_instance_id,
    enabled: Boolean(value.enabled),
    label: value.label,
    msg_name_whitelist: value.message_name_whitelist_json,
    style: fnParseJsonValue(value.style_json),
    created_at: fnTimestampFromMs(value.created_at_ms),
  }
}
