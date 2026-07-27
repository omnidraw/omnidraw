import type { Database } from "@tursodatabase/database";
import type { TTenantContext } from "@vibecanvas/tenant-core";
import type { TJson, TToolGroup } from "../model";
import { fxToolGroupGetByName } from "./fx.tool-group";

type TPortal = {
  db: Database;
};

type TArgsCreate = TToolGroup & { tenant: TTenantContext };
type TArgsUpdate = TToolGroup & { currentName: string; tenant: TTenantContext };
type TArgsRemove = {
  tenant: TTenantContext;
  name: string;
};

function serializeJson(value: TJson | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

export async function txToolGroupCreate(portal: TPortal, args: TArgsCreate): Promise<TToolGroup> {
  const stmt = await portal.db.prepare(`
    INSERT INTO tool_groups (
      org_id, id, name, configuration_json, status, created_at_ms, updated_at_ms
    )
    VALUES (
      ?,
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
      ?, ?, 'active',
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
  `);
  await stmt.run(args.tenant.orgId, args.name, serializeJson(args.json));
  const created = await fxToolGroupGetByName(portal, { tenant: args.tenant, name: args.name });
  if (!created) throw new Error("Failed to create tool group");
  return created;
}

export async function txToolGroupUpdate(portal: TPortal, args: TArgsUpdate): Promise<TToolGroup | null> {
  const stmt = await portal.db.prepare(`
    UPDATE tool_groups
    SET name = ?, configuration_json = ?, updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND name = ? AND status = 'active'
  `);
  const result = await stmt.run(
    args.name,
    serializeJson(args.json),
    args.tenant.orgId,
    args.currentName,
  );
  return result.changes === 0 ? null : fxToolGroupGetByName(portal, { tenant: args.tenant, name: args.name });
}

export async function txToolGroupRemove(portal: TPortal, args: TArgsRemove): Promise<TToolGroup | null> {
  const existing = await fxToolGroupGetByName(portal, args);
  if (!existing) return null;
  const stmt = await portal.db.prepare(`
    DELETE FROM tool_groups
    WHERE org_id = ? AND name = ?
  `);
  await stmt.run(args.tenant.orgId, args.name);
  return existing;
}
