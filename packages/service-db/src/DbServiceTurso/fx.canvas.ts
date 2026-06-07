import type { Database } from "@tursodatabase/database"
import type { TCanvas, TCanvasMember } from "../model"

type TPortal = {
  db: Database
}

type TArgsAccountScoped = {
  accountId?: string
}

type TArgsFindByName = TArgsAccountScoped & {
  name: string
}

type TArgsFindById = TArgsAccountScoped & {
  id: string
}

type TArgsCanEdit = {
  accountId: string
  canvasId: string
}

type TArgsListMembers = {
  canvasId: string
}

export async function fxCanvasListAll(portal: TPortal, args: TArgsAccountScoped): Promise<TCanvas[]> {
  if (!args.accountId) {
    const stmt = await portal.db.prepare(`
      SELECT *
      FROM canvas
    `)
    const rows = await stmt.all()
    return rows as TCanvas[]
  }

  const stmt = await portal.db.prepare(`
    SELECT canvas.*
    FROM canvas
    INNER JOIN canvas_members
      ON canvas_members.canvas_id = canvas.id
      AND canvas_members.account_id = ?
  `)
  const rows = await stmt.all(args.accountId)
  return rows as TCanvas[]
}

export async function fxCanvasFindByName(portal: TPortal, args: TArgsFindByName): Promise<TCanvas | null> {
  if (!args.accountId) {
    const stmt = await portal.db.prepare(`
      SELECT *
      FROM canvas
      WHERE name = ?
    `)
    const row = await stmt.get(args.name)
    return (row ?? null) as TCanvas | null
  }

  const stmt = await portal.db.prepare(`
    SELECT canvas.*
    FROM canvas
    INNER JOIN canvas_members
      ON canvas_members.canvas_id = canvas.id
      AND canvas_members.account_id = ?
    WHERE canvas.name = ?
  `)
  const row = await stmt.get(args.accountId, args.name)
  return (row ?? null) as TCanvas | null
}

export async function fxCanvasFindById(portal: TPortal, args: TArgsFindById): Promise<TCanvas | null> {
  if (!args.accountId) {
    const stmt = await portal.db.prepare(`
      SELECT *
      FROM canvas
      WHERE id = ?
    `)
    const row = await stmt.get(args.id)
    return (row ?? null) as TCanvas | null
  }

  const stmt = await portal.db.prepare(`
    SELECT canvas.*
    FROM canvas
    INNER JOIN canvas_members
      ON canvas_members.canvas_id = canvas.id
      AND canvas_members.account_id = ?
    WHERE canvas.id = ?
  `)
  const row = await stmt.get(args.accountId, args.id)
  return (row ?? null) as TCanvas | null
}

export async function fxCanvasCanEdit(portal: TPortal, args: TArgsCanEdit): Promise<boolean> {
  const stmt = await portal.db.prepare(`
    SELECT 1
    FROM canvas_members
    WHERE canvas_id = ?
      AND account_id = ?
      AND role IN ('owner', 'editor')
    LIMIT 1
  `)
  const row = await stmt.get(args.canvasId, args.accountId)
  return row != null
}

export async function fxCanvasHasOwnerRole(portal: TPortal, args: TArgsCanEdit): Promise<boolean> {
  const stmt = await portal.db.prepare(`
    SELECT 1
    FROM canvas_members
    WHERE canvas_id = ?
      AND account_id = ?
      AND role = 'owner'
    LIMIT 1
  `)
  const row = await stmt.get(args.canvasId, args.accountId)
  return row != null
}

export async function fxCanvasListMembers(portal: TPortal, args: TArgsListMembers): Promise<TCanvasMember[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM canvas_members
    WHERE canvas_id = ?
  `)
  const rows = await stmt.all(args.canvasId)
  return rows as TCanvasMember[]
}
