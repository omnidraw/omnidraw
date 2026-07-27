import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@vibecanvas/tenant-core"
import type { TCanvas } from "../model"
import { txRunDatabaseTransaction } from "../tx.run-database-transaction"
import { fxCanvasCanEdit, fxCanvasFindById, fxCanvasHasOwnerRole } from "./fx.canvas"
import { fnTimestampFromMs } from "./fn.legacy-row"

type TPortal = {
  db: Database
}

type TArgsCreate = Pick<TCanvas, "id" | "name"> & {
  tenant: TTenantContext
}

type TArgsRenameById = {
  id: string
  name: string
  tenant: TTenantContext
}

type TArgsDeleteById = {
  id: string
  tenant: TTenantContext
}

export async function txCanvasCreate(portal: TPortal, args: TArgsCreate): Promise<TCanvas> {
  const nowSql = "CAST(unixepoch('subsec') * 1000 AS INTEGER)"

  return txRunDatabaseTransaction({ database: portal.db }, {
    operation: async () => {
      const createCanvasStmt = await portal.db.prepare(`
        INSERT INTO canvases (
          org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, 'restricted', ?, ${nowSql}, ${nowSql})
        RETURNING id, name, revision, created_at_ms
      `)
      const created = await createCanvasStmt.get(
        args.tenant.orgId,
        args.id,
        args.name,
        args.tenant.accountId,
      ) as {
        id: string;
        name: string;
        revision: unknown;
        created_at_ms: unknown;
      } | null | undefined

      if (!created) {
        throw new Error("Failed to create canvas")
      }

      const createMemberStmt = await portal.db.prepare(`
        INSERT INTO canvas_members (
          org_id, canvas_id, account_id, role, created_at_ms, updated_at_ms
        )
        VALUES (?, ?, ?, 'owner', ${nowSql}, ${nowSql})
      `)
      await createMemberStmt.run(args.tenant.orgId, created.id, args.tenant.accountId)
      return {
        id: created.id,
        name: created.name,
        revision: Number(created.revision),
        created_at: fnTimestampFromMs(created.created_at_ms),
      }
    },
  })
}

export async function txCanvasRenameById(portal: TPortal, args: TArgsRenameById): Promise<TCanvas | null> {
  const canEdit = await fxCanvasCanEdit(portal, {
    tenant: args.tenant,
    canvasId: args.id,
  })

  if (!canEdit) {
    return null
  }

  const stmt = await portal.db.prepare(`
    UPDATE canvases
    SET name = ?, updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
  `)
  const result = await stmt.run(args.name, args.tenant.orgId, args.id)
  if (result.changes === 0) return null
  return fxCanvasFindById(portal, { tenant: args.tenant, id: args.id })
}

export async function txCanvasDeleteById(portal: TPortal, args: TArgsDeleteById): Promise<TCanvas[]> {
  const hasOwnerRole = await fxCanvasHasOwnerRole(portal, {
    tenant: args.tenant,
    canvasId: args.id,
  })

  if (!hasOwnerRole) {
    return []
  }

  const existing = await fxCanvasFindById(portal, { tenant: args.tenant, id: args.id })
  if (!existing) return []

  const stmt = await portal.db.prepare(`
    DELETE FROM canvases
    WHERE org_id = ? AND id = ?
  `)
  const result = await stmt.run(args.tenant.orgId, args.id)
  return result.changes === 0 ? [] : [existing]
}
