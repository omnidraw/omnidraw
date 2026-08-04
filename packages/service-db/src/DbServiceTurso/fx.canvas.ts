import type { Database } from '@tursodatabase/database';
import type { TCanvas } from '../model';

type TPortal = { db: Database };
type TArgs = Record<string, never>;
type TArgsFindByName = { name: string };
type TArgsFindById = { id: string };

type TCanvasStorageRow = {
  id: string;
  name: string;
  revision: unknown;
  created_at_sec: unknown;
  updated_at_sec: unknown;
};

function timestampSec(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    throw new TypeError(`Stored ${label} is not a whole-second timestamp.`);
  }
  return value;
}

function parseCanvasRow(row: TCanvasStorageRow): TCanvas {
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Stored canvas revision is invalid.');
  }
  return {
    id: row.id,
    name: row.name,
    revision,
    createdAtSec: timestampSec(row.created_at_sec, 'canvas creation time'),
    updatedAtSec: timestampSec(row.updated_at_sec, 'canvas update time'),
  };
}

export async function fxCanvasListAll(portal: TPortal, args: TArgs): Promise<TCanvas[]> {
  void args;
  const rows = await (await portal.db.prepare(`
    SELECT id, name, revision, created_at_sec, updated_at_sec
    FROM canvases
    ORDER BY created_at_sec ASC, id ASC
  `)).all() as TCanvasStorageRow[];
  return rows.map(parseCanvasRow);
}

export async function fxCanvasFindByName(
  portal: TPortal,
  args: TArgsFindByName,
): Promise<TCanvas | null> {
  const row = await (await portal.db.prepare(`
    SELECT id, name, revision, created_at_sec, updated_at_sec
    FROM canvases
    WHERE name = ?
  `)).get(args.name) as TCanvasStorageRow | undefined;
  return row ? parseCanvasRow(row) : null;
}

export async function fxCanvasFindById(
  portal: TPortal,
  args: TArgsFindById,
): Promise<TCanvas | null> {
  const row = await (await portal.db.prepare(`
    SELECT id, name, revision, created_at_sec, updated_at_sec
    FROM canvases
    WHERE id = ?
  `)).get(args.id) as TCanvasStorageRow | undefined;
  return row ? parseCanvasRow(row) : null;
}
