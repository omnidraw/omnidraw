import type { Database } from '@tursodatabase/database';
import type { TEncryptionKey } from '../model';
import { fxActorResourceEncryptionKeyGet } from './fx.encryption-key';

type TPortal = {
  db: Database;
};

type TArgs = {
  resourceId: string;
  keyId: string;
  purpose: string;
  algorithm: string;
  keyHex: string;
};

export async function txActorResourceEncryptionKeyGetOrCreate(portal: TPortal, args: TArgs): Promise<TEncryptionKey> {
  await portal.db.exec('BEGIN IMMEDIATE');
  try {
    const existing = await fxActorResourceEncryptionKeyGet(portal, { resourceId: args.resourceId });
    if (existing) {
      await portal.db.exec('COMMIT');
      return existing;
    }

    const insertKey = await portal.db.prepare(`
      INSERT INTO encryption_keys (id, purpose, algorithm, key_hex)
      VALUES (?, ?, ?, ?)
    `);
    await insertKey.run(args.keyId, args.purpose, args.algorithm, args.keyHex);

    const insertLink = await portal.db.prepare(`
      INSERT INTO actor_resource_encryption_keys (actor_resource_id, encryption_key_id)
      SELECT id, ?
      FROM actor_resources
      WHERE id = ? AND kind = 'secretStore'
    `);
    const link = await insertLink.run(args.keyId, args.resourceId);
    if (link.changes !== 1) throw new Error('Secret-store actor resource was not found.');

    const stored = await fxActorResourceEncryptionKeyGet(portal, { resourceId: args.resourceId });
    if (!stored) throw new Error('Failed to persist actor-resource encryption key.');
    await portal.db.exec('COMMIT');
    return stored;
  } catch (error) {
    await portal.db.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
