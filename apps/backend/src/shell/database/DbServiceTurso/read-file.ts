import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TMediaFile } from '../model';

type TEffects = { db: Database };
type TArgs = Record<string, never>;
type TArgsGetById = { id: string };

function parseMediaFileRow(row: unknown): TMediaFile {
  const value = row as {
    id: string;
    canvas_id: string | null;
    source_hash: string;
    digest_sha256: string | null;
    mime_type: TMediaFile['mimeType'];
    data: TMediaFile['data'];
    created_at_sec: string;
  };
  return {
    id: value.id,
    canvasId: value.canvas_id,
    hash: value.source_hash,
    digestSha256: value.digest_sha256,
    mimeType: value.mime_type,
    data: value.data,
    createdAtSec: value.created_at_sec,
  };
}

export async function listMediaFileRows(effects: TEffects, args: TArgs): Promise<TMediaFile[]> {
  void args;
  const rows = await (await effects.db.prepare(DATABASE_STATEMENTS.mediaFileList)).all();
  return rows.map(parseMediaFileRow);
}

export async function getMediaFileRowById(
  effects: TEffects,
  args: TArgsGetById,
): Promise<TMediaFile | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.mediaFileReadById)).get(args.id);
  return row ? parseMediaFileRow(row) : null;
}
