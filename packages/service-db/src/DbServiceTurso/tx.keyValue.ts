import type { Database } from "@tursodatabase/database"
import type { TJson, TKeyValue } from "../model"

type TPortal = {
  db: Database
}

type TArgsRemove = {
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

function serializeJson(value: TJson): string {
  return JSON.stringify(value)
}

function parseKeyValue(row: unknown): TKeyValue {
  const value = row as TRawKeyValue

  if (value.text !== null) return { name: value.name, type: "text", value: value.text }
  if (value.json !== null) return { name: value.name, type: "json", value: parseJson(value.json) }
  if (value.number !== null) return { name: value.name, type: "number", value: value.number }
  if (value.bool !== null) return { name: value.name, type: "bool", value: Boolean(value.bool) }

  throw new Error(`Invalid key value row "${value.name}"`)
}

function toColumnValues(args: TKeyValue): [string | null, string | null, number | null, boolean | null] {
  if (args.type === "text") return [args.value, null, null, null]
  if (args.type === "json") return [null, serializeJson(args.value), null, null]
  if (args.type === "number") return [null, null, args.value, null]

  return [null, null, null, args.value]
}

export async function txKeyValueAdd(portal: TPortal, args: TKeyValue): Promise<TKeyValue> {
  const [text, json, number, bool] = toColumnValues(args)
  const stmt = await portal.db.prepare(`
    INSERT INTO kv (name, text, json, number, bool)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `)
  const row = await stmt.get(args.name, text, json, number, bool)

  if (!row) {
    throw new Error("Failed to add key value")
  }

  return parseKeyValue(row)
}

export async function txKeyValueRemove(portal: TPortal, args: TArgsRemove): Promise<void> {
  const stmt = await portal.db.prepare(`
    DELETE FROM kv
    WHERE name = ?
  `)
  await stmt.run(args.name)
}
