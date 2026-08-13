import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TMediaFile } from '../model';
import { getMediaFileRowById } from './read-file';

type TEffects = { db: Database };
type TArgsCreate = Pick<TMediaFile, 'id' | 'canvasId' | 'hash' | 'digestSha256' | 'mimeType' | 'data'>;
type TArgsDeleteById = { id: string };

export async function createMediaFileRow(effects: TEffects, args: TArgsCreate): Promise<TMediaFile> {
  await (await effects.db.prepare(DATABASE_STATEMENTS.mediaFileWriteInsertMediaFiles)).run(
    args.id,
    args.canvasId,
    args.hash,
    args.digestSha256,
    args.mimeType,
    args.data,
    args.data,
  );
  const created = await getMediaFileRowById(effects, { id: args.id });
  if (!created) throw new Error('Failed to create media file record.');
  return created;
}

export async function deleteMediaFileRowById(effects: TEffects, args: TArgsDeleteById): Promise<void> {
  await (await effects.db.prepare(DATABASE_STATEMENTS.mediaFileWriteDeleteMediaFiles)).run(args.id);
}
