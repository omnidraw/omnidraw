import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TCanvas } from '../model';

type TEffects = { db: Database };
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

export async function listCanvasRows(effects: TEffects, args: TArgs): Promise<TCanvas[]> {
  void args;
  const rows = await (await effects.db.prepare(DATABASE_STATEMENTS.canvasList)).all() as TCanvasStorageRow[];
  return rows.map(parseCanvasRow);
}

export async function findCanvasRowByName(
  effects: TEffects,
  args: TArgsFindByName,
): Promise<TCanvas | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.canvasReadByName)).get(args.name) as TCanvasStorageRow | undefined;
  return row ? parseCanvasRow(row) : null;
}

export async function findCanvasRowById(
  effects: TEffects,
  args: TArgsFindById,
): Promise<TCanvas | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.canvasReadById)).get(args.id) as TCanvasStorageRow | undefined;
  return row ? parseCanvasRow(row) : null;
}
