import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ACCOUNT_ID, DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
import type { TCanvas } from "../model"
import { fxCanvasCanEdit, fxCanvasFindById, fxCanvasHasOwnerRole } from "./fx.canvas"
import { fnTimestampFromMs } from "./fn.legacy-row"
import { txAccountEnsureDefaultOwner } from "./tx.account"

type TPortal = {
  db: Database
}

type TArgsCreate = Pick<TCanvas, "automerge_url" | "id" | "name"> & {
  accountId?: string
}

type TArgsRenameById = {
  id: string
  name: string
  accountId?: string
}

type TArgsDeleteById = {
  id: string
  accountId?: string
}

type TImmediateTransaction<T> = (() => Promise<T>) & {
  immediate: () => Promise<T>
}

function accountIdOrDefault(accountId?: string) {
  return accountId ?? DEFAULT_OSS_ACCOUNT_ID
}

async function ensureDefaultAccountWhenNeeded(portal: TPortal, accountId?: string) {
  if (!accountId || accountId === DEFAULT_OSS_ACCOUNT_ID) {
    await txAccountEnsureDefaultOwner(portal, {})
  }
}

export async function txCanvasCreate(portal: TPortal, args: TArgsCreate): Promise<TCanvas> {
  const accountId = accountIdOrDefault(args.accountId)
  await ensureDefaultAccountWhenNeeded(portal, args.accountId)
  const nowSql = "CAST(unixepoch('subsec') * 1000 AS INTEGER)"

  const create = portal.db.transaction(async () => {
    const createCanvasStmt = await portal.db.prepare(`
      INSERT INTO canvases (
        org_id, id, name, access_policy, created_by_account_id, created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, 'restricted', ?, ${nowSql}, ${nowSql})
      RETURNING id, name, created_at_ms
    `)
    const created = await createCanvasStmt.get(
      DEFAULT_OSS_ORGANIZATION_ID,
      args.id,
      args.name,
      accountId,
    ) as { id: string; name: string; created_at_ms: unknown } | null | undefined

    if (!created) {
      throw new Error("Failed to create canvas")
    }

    const createDocumentStmt = await portal.db.prepare(`
      INSERT INTO collaboration_documents (
        org_id, id, canvas_id, widget_instance_id, automerge_url, partition_key,
        created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, NULL, ?, ?, ${nowSql}, ${nowSql})
    `)
    await createDocumentStmt.run(
      DEFAULT_OSS_ORGANIZATION_ID,
      created.id,
      created.id,
      args.automerge_url,
      DEFAULT_OSS_ORGANIZATION_ID,
    )

    const createMemberStmt = await portal.db.prepare(`
      INSERT INTO canvas_members (
        org_id, canvas_id, account_id, role, created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, 'owner', ${nowSql}, ${nowSql})
    `)
    await createMemberStmt.run(DEFAULT_OSS_ORGANIZATION_ID, created.id, accountId)
    return {
      id: created.id,
      name: created.name,
      automerge_url: args.automerge_url,
      created_at: fnTimestampFromMs(created.created_at_ms),
    }
  }) as TImmediateTransaction<TCanvas>
  return create.immediate()
}

export async function txCanvasRenameById(portal: TPortal, args: TArgsRenameById): Promise<TCanvas | null> {
  if (args.accountId) {
    const canEdit = await fxCanvasCanEdit(portal, {
      accountId: args.accountId,
      canvasId: args.id,
    })

    if (!canEdit) {
      return null
    }
  }

  const stmt = await portal.db.prepare(`
    UPDATE canvases
    SET name = ?, updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
  `)
  const result = await stmt.run(args.name, DEFAULT_OSS_ORGANIZATION_ID, args.id)
  if (result.changes === 0) return null
  return fxCanvasFindById(portal, { id: args.id })
}

export async function txCanvasDeleteById(portal: TPortal, args: TArgsDeleteById): Promise<TCanvas[]> {
  if (args.accountId) {
    const hasOwnerRole = await fxCanvasHasOwnerRole(portal, {
      accountId: args.accountId,
      canvasId: args.id,
    })

    if (!hasOwnerRole) {
      return []
    }
  }

  const existing = await fxCanvasFindById(portal, { id: args.id })
  if (!existing) return []

  const stmt = await portal.db.prepare(`
    DELETE FROM canvases
    WHERE org_id = ? AND id = ?
  `)
  const result = await stmt.run(DEFAULT_OSS_ORGANIZATION_ID, args.id)
  return result.changes === 0 ? [] : [existing]
}
