import type { Database } from "@tursodatabase/database";
import type { TTenantContext } from "@vibecanvas/tenant-core";
import type { TJson, TToolGroup } from "../model";

type TPortal = {
  db: Database;
};

type TArgs = { tenant: TTenantContext };
type TArgsGetByName = {
  tenant: TTenantContext;
  name: string;
};

function parseJson(value: unknown): TJson | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return value as TJson;
  }

  return JSON.parse(value) as TJson;
}

function parseToolGroup(row: unknown): TToolGroup {
  const value = row as { name: string; configuration_json: unknown | null };
  return {
    name: value.name,
    json: parseJson(value.configuration_json),
  };
}

export async function fxToolGroupListAll(portal: TPortal, args: TArgs): Promise<TToolGroup[]> {
  const stmt = await portal.db.prepare(`
    SELECT name, configuration_json
    FROM tool_groups
    WHERE org_id = ? AND status = 'active'
    ORDER BY name ASC
  `);
  const rows = await stmt.all(args.tenant.orgId);
  return rows.map(parseToolGroup);
}

export async function fxToolGroupGetByName(portal: TPortal, args: TArgsGetByName): Promise<TToolGroup | null> {
  const stmt = await portal.db.prepare(`
    SELECT name, configuration_json
    FROM tool_groups
    WHERE org_id = ? AND name = ? AND status = 'active'
  `);
  const row = await stmt.get(args.tenant.orgId, args.name);
  return row ? parseToolGroup(row) : null;
}
