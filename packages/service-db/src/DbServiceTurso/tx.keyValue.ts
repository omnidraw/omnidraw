import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@omnidraw/tenant-core"
import type { TJson, TKeyValue } from "../model"

type TPortal = {
  db: Database
}

type TArgsRemove = {
  tenant: TTenantContext
  name: string
}

type TArgsAdd = TKeyValue & { tenant: TTenantContext }

type TRawKeyValue = {
  name: string
  kind: TKeyValue["type"]
  text_value: string | null
  json_value: unknown | null
  number_value: number | null
  bool_value: boolean | number | null
}

function parseJson(value: unknown): TJson {
  if (typeof value !== "string") return value as TJson

  return JSON.parse(value) as TJson
}

function serializeJson(value: TJson): string {
  return JSON.stringify(value)
}

function parseKeyValue(row: unknown): TKeyValue {
  const value = row as TRawKeyValue

  if (value.kind === "text" && value.text_value !== null) return { name: value.name, type: "text", value: value.text_value }
  if (value.kind === "json" && value.json_value !== null) return { name: value.name, type: "json", value: parseJson(value.json_value) }
  if (value.kind === "number" && value.number_value !== null) return { name: value.name, type: "number", value: value.number_value }
  if (value.kind === "bool" && value.bool_value !== null) return { name: value.name, type: "bool", value: Boolean(value.bool_value) }

  throw new Error(`Invalid key value row "${value.name}"`)
}

function toColumnValues(args: TKeyValue): [string | null, string | null, number | null, boolean | null] {
  if (args.type === "text") return [args.value, null, null, null]
  if (args.type === "json") return [null, serializeJson(args.value), null, null]
  if (args.type === "number") return [null, null, args.value, null]

  return [null, null, null, args.value]
}

export async function txKeyValueAdd(portal: TPortal, args: TArgsAdd): Promise<TKeyValue> {
  const [text, json, number, bool] = toColumnValues(args)
  const stmt = await portal.db.prepare(`
    INSERT INTO key_values (
      org_id, name, kind, text_value, json_value, number_value, bool_value,
      created_at_ms, updated_at_ms
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
    RETURNING name, kind, text_value, json_value, number_value, bool_value
  `)
  const row = await stmt.get(args.tenant.orgId, args.name, args.type, text, json, number, bool)

  if (!row) {
    throw new Error("Failed to add key value")
  }

  return parseKeyValue(row)
}

export async function txKeyValueRemove(portal: TPortal, args: TArgsRemove): Promise<void> {
  const stmt = await portal.db.prepare(`
    DELETE FROM key_values
    WHERE org_id = ? AND name = ?
  `)
  await stmt.run(args.tenant.orgId, args.name)
}
