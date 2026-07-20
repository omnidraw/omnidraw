import type { Database } from '@tursodatabase/database';
import type { TEncryptionKey } from '../model';

type TPortal = {
  db: Database;
};

type TArgs = {
  resourceId: string;
};

function parseEncryptionKey(row: unknown): TEncryptionKey {
  const value = row as Partial<TEncryptionKey>;
  if (
    typeof value.id !== 'string'
    || typeof value.purpose !== 'string'
    || typeof value.algorithm !== 'string'
    || typeof value.key_hex !== 'string'
    || typeof value.created_at !== 'string'
  ) {
    throw new Error('Stored encryption key is invalid.');
  }
  return {
    id: value.id,
    purpose: value.purpose,
    algorithm: value.algorithm,
    key_hex: value.key_hex,
    created_at: value.created_at,
  };
}

export async function fxActorResourceEncryptionKeyGet(portal: TPortal, args: TArgs): Promise<TEncryptionKey | null> {
  const statement = await portal.db.prepare(`
    SELECT encryption_keys.id, encryption_keys.purpose, encryption_keys.algorithm,
      encryption_keys.key_hex, encryption_keys.created_at
    FROM actor_resource_encryption_keys
    INNER JOIN encryption_keys
      ON encryption_keys.id = actor_resource_encryption_keys.encryption_key_id
    WHERE actor_resource_encryption_keys.actor_resource_id = ?
  `);
  const row = await statement.get(args.resourceId);
  return row ? parseEncryptionKey(row) : null;
}
