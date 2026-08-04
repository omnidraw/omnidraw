import type { Database } from '@tursodatabase/database';
import type { TMediaFile } from '../model';

type TPortal = { db: Database };
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

export async function fxFileListAll(portal: TPortal, args: TArgs): Promise<TMediaFile[]> {
  void args;
  const rows = await (await portal.db.prepare(`
    SELECT id, canvas_id, source_hash, digest_sha256, mime_type, data, created_at_sec
    FROM media_files
    ORDER BY created_at_sec ASC, id ASC
  `)).all();
  return rows.map(parseMediaFileRow);
}

export async function fxFileGetById(
  portal: TPortal,
  args: TArgsGetById,
): Promise<TMediaFile | null> {
  const row = await (await portal.db.prepare(`
    SELECT id, canvas_id, source_hash, digest_sha256, mime_type, data, created_at_sec
    FROM media_files
    WHERE id = ?
  `)).get(args.id);
  return row ? parseMediaFileRow(row) : null;
}
