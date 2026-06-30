import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ACCOUNT_ID } from "../CONSTANTS"
import type { TCanvas } from "../model"
import { fxCanvasCanEdit, fxCanvasHasOwnerRole } from "./fx.canvas"
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

  await portal.db.exec("BEGIN TRANSACTION")
  try {
    const createCanvasStmt = await portal.db.prepare(`
      INSERT INTO canvas (id, name, automerge_url)
      VALUES (?, ?, ?)
      RETURNING *
    `)
    const created = await createCanvasStmt.get(args.id, args.name, args.automerge_url) as TCanvas | null | undefined

    if (!created) {
      throw new Error("Failed to create canvas")
    }

    const createMemberStmt = await portal.db.prepare(`
      INSERT INTO canvas_members (canvas_id, account_id, role)
      VALUES (?, ?, 'owner')
    `)
    await createMemberStmt.run(created.id, accountId)
    await portal.db.exec("COMMIT")
    return created
  } catch (error) {
    await portal.db.exec("ROLLBACK")
    throw error
  }
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
    UPDATE canvas
    SET name = ?
    WHERE id = ?
    RETURNING *
  `)
  const row = await stmt.get(args.name, args.id)
  return (row ?? null) as TCanvas | null
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

  const stmt = await portal.db.prepare(`
    DELETE FROM canvas
    WHERE id = ?
    RETURNING *
  `)
  const rows = await stmt.all(args.id)
  return rows as TCanvas[]
}
