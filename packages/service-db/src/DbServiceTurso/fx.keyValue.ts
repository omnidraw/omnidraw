import type { Database } from "@tursodatabase/database"
import type { TJson, TKeyValue } from "../model"

type TPortal = {
  db: Database
}

type TArgsGet = {
  name: string
}

type TRawKeyValue = {
  name: string
  text: string | null
  json: unknown | null
  number: number | null
  bool: boolean | number | null
}

function parseJson(value: unknown): TJson {
  if (typeof value !== "string") return value as TJson

  return JSON.parse(value) as TJson
}

function parseKeyValue(row: unknown): TKeyValue {
  const value = row as TRawKeyValue

  if (value.text !== null) return { name: value.name, type: "text", value: value.text }
  if (value.json !== null) return { name: value.name, type: "json", value: parseJson(value.json) }
  if (value.number !== null) return { name: value.name, type: "number", value: value.number }
  if (value.bool !== null) return { name: value.name, type: "bool", value: Boolean(value.bool) }

  throw new Error(`Invalid key value row "${value.name}"`)
}

export async function fxKeyValueGet(portal: TPortal, args: TArgsGet): Promise<TKeyValue | null> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM kv
    WHERE name = ?
  `)
  const row = await stmt.get(args.name)

  if (!row) return null

  return parseKeyValue(row)
}
