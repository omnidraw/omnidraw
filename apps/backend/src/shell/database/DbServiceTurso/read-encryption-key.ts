import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TEncryptionKey } from '../model';

type TEffects = { db: Database };
type TArgs = { resourceId: string };

function parseEncryptionKey(row: unknown): TEncryptionKey {
  const value = row as {
    id: unknown;
    resource_id: unknown;
    purpose: unknown;
    algorithm: unknown;
    key_hex: unknown;
    created_at_sec: unknown;
  };
  if (
    typeof value.id !== 'string'
    || typeof value.resource_id !== 'string'
    || typeof value.purpose !== 'string'
    || typeof value.algorithm !== 'string'
    || typeof value.key_hex !== 'string'
    || typeof value.created_at_sec !== 'string'
  ) {
    throw new Error('Stored encryption key is invalid.');
  }
  return {
    id: value.id,
    resourceId: value.resource_id,
    purpose: value.purpose,
    algorithm: value.algorithm,
    keyHex: value.key_hex,
    createdAtSec: value.created_at_sec,
  };
}

export async function getResourceEncryptionKey(
  effects: TEffects,
  args: TArgs,
): Promise<TEncryptionKey | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.encryptionKeyReadReadResourceEncryptionKeys)).get(args.resourceId);
  return row ? parseEncryptionKey(row) : null;
}
