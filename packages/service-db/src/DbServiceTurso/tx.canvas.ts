import type { Database } from '@tursodatabase/database';
import type { TCanvas } from '../model';
import { fxCanvasFindById } from './fx.canvas';

type TPortal = { db: Database };
type TArgsCreate = Pick<TCanvas, 'id' | 'name'>;
type TArgsRenameById = { id: string; name: string };
type TArgsDeleteById = { id: string };

export async function txCanvasCreate(portal: TPortal, args: TArgsCreate): Promise<TCanvas> {
  await (await portal.db.prepare(`
    INSERT INTO canvases (id, name)
    VALUES (?, ?)
  `)).run(args.id, args.name);
  const created = await fxCanvasFindById(portal, { id: args.id });
  if (!created) throw new Error('Failed to create canvas.');
  return created;
}

export async function txCanvasRenameById(
  portal: TPortal,
  args: TArgsRenameById,
): Promise<TCanvas | null> {
  const result = await (await portal.db.prepare(`
    UPDATE canvases
    SET name = ?, updated_at_sec = CURRENT_TIMESTAMP
    WHERE id = ?
  `)).run(args.name, args.id);
  return result.changes === 0 ? null : fxCanvasFindById(portal, { id: args.id });
}

export async function txCanvasDeleteById(
  portal: TPortal,
  args: TArgsDeleteById,
): Promise<TCanvas[]> {
  const existing = await fxCanvasFindById(portal, { id: args.id });
  if (!existing) return [];
  const result = await (await portal.db.prepare(`
    DELETE FROM canvases
    WHERE id = ?
  `)).run(args.id);
  return result.changes === 0 ? [] : [existing];
}
