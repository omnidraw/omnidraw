import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@vibecanvas/tenant-core"
import type { TCanvas, TCanvasMember } from "../model"
import { fnTimestampFromMs } from "./fn.legacy-row"

type TPortal = {
  db: Database
}

type TArgsAccountScoped = {
  tenant: TTenantContext
}

type TArgsFindByName = TArgsAccountScoped & {
  name: string
}

type TArgsFindById = TArgsAccountScoped & {
  id: string
}

type TArgsCanEdit = {
  tenant: TTenantContext
  canvasId: string
}

type TArgsListMembers = {
  tenant: TTenantContext
  canvasId: string
}

type TCanvasStorageRow = {
  id: string
  name: string
  automerge_url: string
  created_at_ms: unknown
}

type TCanvasMemberStorageRow = {
  canvas_id: string
  account_id: string
  role: TCanvasMember["role"]
  created_at_ms: unknown
  updated_at_ms: unknown
}

function fnParseCanvasRow(row: TCanvasStorageRow): TCanvas {
  return {
    id: row.id,
    name: row.name,
    automerge_url: row.automerge_url,
    created_at: fnTimestampFromMs(row.created_at_ms),
  }
}

function fnParseCanvasMemberRow(row: TCanvasMemberStorageRow): TCanvasMember {
  return {
    canvas_id: row.canvas_id,
    account_id: row.account_id,
    role: row.role,
    created_at: fnTimestampFromMs(row.created_at_ms),
    updated_at: fnTimestampFromMs(row.updated_at_ms),
  }
}

export async function fxCanvasListAll(portal: TPortal, args: TArgsAccountScoped): Promise<TCanvas[]> {
  const stmt = await portal.db.prepare(`
    SELECT canvases.id, canvases.name, collaboration_documents.automerge_url,
      canvases.created_at_ms
    FROM canvases
    INNER JOIN canvas_members
      ON canvas_members.org_id = canvases.org_id
      AND canvas_members.canvas_id = canvases.id
      AND canvas_members.account_id = ?
    INNER JOIN collaboration_documents
      ON collaboration_documents.org_id = canvases.org_id
      AND collaboration_documents.canvas_id = canvases.id
    WHERE canvases.org_id = ?
  `)
  const rows = await stmt.all(args.tenant.accountId, args.tenant.orgId) as TCanvasStorageRow[]
  return rows.map(fnParseCanvasRow)
}

export async function fxCanvasFindByName(portal: TPortal, args: TArgsFindByName): Promise<TCanvas | null> {
  const stmt = await portal.db.prepare(`
    SELECT canvases.id, canvases.name, collaboration_documents.automerge_url,
      canvases.created_at_ms
    FROM canvases
    INNER JOIN canvas_members
      ON canvas_members.org_id = canvases.org_id
      AND canvas_members.canvas_id = canvases.id
      AND canvas_members.account_id = ?
    INNER JOIN collaboration_documents
      ON collaboration_documents.org_id = canvases.org_id
      AND collaboration_documents.canvas_id = canvases.id
    WHERE canvases.org_id = ? AND canvases.name = ?
  `)
  const row = await stmt.get(args.tenant.accountId, args.tenant.orgId, args.name) as TCanvasStorageRow | undefined
  return row ? fnParseCanvasRow(row) : null
}

export async function fxCanvasFindById(portal: TPortal, args: TArgsFindById): Promise<TCanvas | null> {
  const stmt = await portal.db.prepare(`
    SELECT canvases.id, canvases.name, collaboration_documents.automerge_url,
      canvases.created_at_ms
    FROM canvases
    INNER JOIN canvas_members
      ON canvas_members.org_id = canvases.org_id
      AND canvas_members.canvas_id = canvases.id
      AND canvas_members.account_id = ?
    INNER JOIN collaboration_documents
      ON collaboration_documents.org_id = canvases.org_id
      AND collaboration_documents.canvas_id = canvases.id
    WHERE canvases.org_id = ? AND canvases.id = ?
  `)
  const row = await stmt.get(args.tenant.accountId, args.tenant.orgId, args.id) as TCanvasStorageRow | undefined
  return row ? fnParseCanvasRow(row) : null
}

export async function fxCanvasCanEdit(portal: TPortal, args: TArgsCanEdit): Promise<boolean> {
  const stmt = await portal.db.prepare(`
    SELECT 1
    FROM canvas_members
    WHERE org_id = ?
      AND canvas_id = ?
      AND account_id = ?
      AND role IN ('owner', 'editor')
    LIMIT 1
  `)
  const row = await stmt.get(args.tenant.orgId, args.canvasId, args.tenant.accountId)
  return row != null
}

export async function fxCanvasHasOwnerRole(portal: TPortal, args: TArgsCanEdit): Promise<boolean> {
  const stmt = await portal.db.prepare(`
    SELECT 1
    FROM canvas_members
    WHERE org_id = ?
      AND canvas_id = ?
      AND account_id = ?
      AND role = 'owner'
    LIMIT 1
  `)
  const row = await stmt.get(args.tenant.orgId, args.canvasId, args.tenant.accountId)
  return row != null
}

export async function fxCanvasListMembers(portal: TPortal, args: TArgsListMembers): Promise<TCanvasMember[]> {
  const stmt = await portal.db.prepare(`
    SELECT canvas_id, account_id, role, created_at_ms, updated_at_ms
    FROM canvas_members
    WHERE org_id = ? AND canvas_id = ?
  `)
  const rows = await stmt.all(args.tenant.orgId, args.canvasId) as TCanvasMemberStorageRow[]
  return rows.map(fnParseCanvasMemberRow)
}
