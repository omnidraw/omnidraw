import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@vibecanvas/tenant-core"
import type { TFilesystem } from "../model"
import { fxFilesystemFindById } from "./fx.filesystem"

type TPortal = {
  db: Database
}

type TArgsCreate = Omit<TFilesystem, "created_at" | "updated_at"> & {
  tenant: TTenantContext
}

export async function txFilesystemCreate(portal: TPortal, args: TArgsCreate): Promise<TFilesystem> {
  const stmt = await portal.db.prepare(`
    INSERT INTO file_systems (
      org_id, id, name, slug, capability_ref, relative_root, description,
      status, created_at_ms, updated_at_ms
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, 'active',
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
  `)
  await stmt.run(
    args.tenant.orgId,
    args.id,
    args.name,
    args.slug,
    args.path === "" ? `legacy-empty:${args.id}` : args.path,
    args.slug,
    args.description,
  )
  const created = await fxFilesystemFindById(portal, { tenant: args.tenant, id: args.id })
  if (!created) throw new Error("Failed to create filesystem record")
  return created
}
