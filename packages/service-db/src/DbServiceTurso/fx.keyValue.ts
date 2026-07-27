import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@vibecanvas/tenant-core"
import type { TJson, TKeyValue } from "../model"

type TPortal = {
  db: Database
}

type TArgsGet = {
  tenant: TTenantContext
  name: string
}

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

function parseKeyValue(row: unknown): TKeyValue {
  const value = row as TRawKeyValue

  if (value.kind === "text" && value.text_value !== null) return { name: value.name, type: "text", value: value.text_value }
  if (value.kind === "json" && value.json_value !== null) return { name: value.name, type: "json", value: parseJson(value.json_value) }
  if (value.kind === "number" && value.number_value !== null) return { name: value.name, type: "number", value: value.number_value }
  if (value.kind === "bool" && value.bool_value !== null) return { name: value.name, type: "bool", value: Boolean(value.bool_value) }

  throw new Error(`Invalid key value row "${value.name}"`)
}

export async function fxKeyValueGet(portal: TPortal, args: TArgsGet): Promise<TKeyValue | null> {
  const stmt = await portal.db.prepare(`
    SELECT name, kind, text_value, json_value, number_value, bool_value
    FROM key_values
    WHERE org_id = ? AND name = ?
  `)
  const row = await stmt.get(args.tenant.orgId, args.name)

  if (!row) return null

  return parseKeyValue(row)
}
