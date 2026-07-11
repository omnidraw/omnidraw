import type { Database } from "@tursodatabase/database";
import type { TJson, TToolGroup } from "../model";

type TPortal = {
  db: Database;
};

type TArgsCreate = TToolGroup;
type TArgsUpdate = TToolGroup & { currentName: string };
type TArgsRemove = {
  name: string;
};

function fnSerializeJson(value: TJson | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function fnParseJson(value: unknown): TJson | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return value as TJson;
  }

  return JSON.parse(value) as TJson;
}

function fnParseToolGroup(row: unknown): TToolGroup {
  const value = row as { name: string; json: unknown | null };
  return {
    name: value.name,
    json: fnParseJson(value.json),
  };
}

export async function txToolGroupCreate(portal: TPortal, args: TArgsCreate): Promise<TToolGroup> {
  const stmt = await portal.db.prepare(`
    INSERT INTO tool_groups (name, json)
    VALUES (?, ?)
    RETURNING name, json
  `);
  const row = await stmt.get(args.name, fnSerializeJson(args.json));
  if (!row) {
    throw new Error("Failed to create tool group");
  }

  return fnParseToolGroup(row);
}

export async function txToolGroupUpdate(portal: TPortal, args: TArgsUpdate): Promise<TToolGroup | null> {
  const stmt = await portal.db.prepare(`
    UPDATE tool_groups
    SET name = ?, json = ?
    WHERE name = ?
    RETURNING name, json
  `);
  const row = await stmt.get(args.name, fnSerializeJson(args.json), args.currentName);
  return row ? fnParseToolGroup(row) : null;
}

export async function txToolGroupRemove(portal: TPortal, args: TArgsRemove): Promise<TToolGroup | null> {
  const stmt = await portal.db.prepare(`
    DELETE FROM tool_groups
    WHERE name = ?
    RETURNING name, json
  `);
  const row = await stmt.get(args.name);
  return row ? fnParseToolGroup(row) : null;
}
