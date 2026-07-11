import type { Database } from "@tursodatabase/database";
import type { TJson, TToolGroup } from "../model";

type TPortal = {
  db: Database;
};

type TArgs = {};
type TArgsGetByName = {
  name: string;
};

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

export async function fxToolGroupListAll(portal: TPortal, args: TArgs): Promise<TToolGroup[]> {
  const stmt = await portal.db.prepare(`
    SELECT name, json
    FROM tool_groups
    ORDER BY name ASC
  `);
  const rows = await stmt.all();
  return rows.map(fnParseToolGroup);
}

export async function fxToolGroupGetByName(portal: TPortal, args: TArgsGetByName): Promise<TToolGroup | null> {
  const stmt = await portal.db.prepare(`
    SELECT name, json
    FROM tool_groups
    WHERE name = ?
  `);
  const row = await stmt.get(args.name);
  return row ? fnParseToolGroup(row) : null;
}
