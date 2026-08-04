import type { Database } from '@tursodatabase/database';
import type { TMediaFile } from '../model';
import { fxFileGetById } from './fx.file';

type TPortal = { db: Database };
type TArgsCreate = Pick<TMediaFile, 'id' | 'canvasId' | 'hash' | 'digestSha256' | 'mimeType' | 'data'>;
type TArgsDeleteById = { id: string };

export async function txFileCreate(portal: TPortal, args: TArgsCreate): Promise<TMediaFile> {
  await (await portal.db.prepare(`
    INSERT INTO media_files (
      id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data
    ) VALUES (?, ?, ?, ?, ?, length(?), ?)
  `)).run(
    args.id,
    args.canvasId,
    args.hash,
    args.digestSha256,
    args.mimeType,
    args.data,
    args.data,
  );
  const created = await fxFileGetById(portal, { id: args.id });
  if (!created) throw new Error('Failed to create media file record.');
  return created;
}

export async function txFileDeleteById(portal: TPortal, args: TArgsDeleteById): Promise<void> {
  await (await portal.db.prepare(`DELETE FROM media_files WHERE id = ?`)).run(args.id);
}
