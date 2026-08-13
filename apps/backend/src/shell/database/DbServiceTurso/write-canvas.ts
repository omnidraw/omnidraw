import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TCanvas } from '../model';
import { findCanvasRowById } from './read-canvas';

type TEffects = { db: Database };
type TArgsCreate = Pick<TCanvas, 'id' | 'name'>;
type TArgsRenameById = { id: string; name: string };
type TArgsDeleteById = { id: string };

export async function createCanvasRow(effects: TEffects, args: TArgsCreate): Promise<TCanvas> {
  await (await effects.db.prepare(DATABASE_STATEMENTS.canvasWriteInsertCanvases)).run(args.id, args.name);
  const created = await findCanvasRowById(effects, { id: args.id });
  if (!created) throw new Error('Failed to create canvas.');
  return created;
}

export async function renameCanvasRowById(
  effects: TEffects,
  args: TArgsRenameById,
): Promise<TCanvas | null> {
  const result = await (await effects.db.prepare(DATABASE_STATEMENTS.canvasWriteUpdateCanvases)).run(args.name, args.id);
  return result.changes === 0 ? null : findCanvasRowById(effects, { id: args.id });
}

export async function deleteCanvasRowById(
  effects: TEffects,
  args: TArgsDeleteById,
): Promise<TCanvas[]> {
  const existing = await findCanvasRowById(effects, { id: args.id });
  if (!existing) return [];
  const result = await (await effects.db.prepare(DATABASE_STATEMENTS.canvasWriteDeleteCanvases)).run(args.id);
  return result.changes === 0 ? [] : [existing];
}
