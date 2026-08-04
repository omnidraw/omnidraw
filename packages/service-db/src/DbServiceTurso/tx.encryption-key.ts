import type { Database } from '@tursodatabase/database';
import type { TEncryptionKey } from '../model';
import { txRunDatabaseTransaction } from '../tx.run-database-transaction';
import { fxResourceEncryptionKeyGet } from './fx.encryption-key';

type TPortal = { db: Database };
type TArgs = {
  resourceId: string;
  keyId: string;
  purpose: string;
  algorithm: string;
  keyHex: string;
};

function assertEncryptionKeyArgs(args: TArgs): void {
  if (args.purpose !== 'resource-data' || args.algorithm !== 'aegis-256') {
    throw new Error('Encryption key purpose or algorithm is unsupported.');
  }
  if (!/^[0-9a-f]{64}$/.test(args.keyHex)) {
    throw new Error('Encryption key must contain exactly 32 lowercase hexadecimal bytes.');
  }
}

export async function txResourceEncryptionKeyGetOrCreate(
  portal: TPortal,
  args: TArgs,
): Promise<TEncryptionKey> {
  assertEncryptionKeyArgs(args);
  return txRunDatabaseTransaction({ database: portal.db }, {
    operation: async () => {
      const existing = await fxResourceEncryptionKeyGet(portal, { resourceId: args.resourceId });
      if (existing) return existing;
      await (await portal.db.prepare(`
        INSERT INTO resource_encryption_keys (
          id, resource_id, purpose, algorithm, key_material
        )
        SELECT ?, id, ?, ?, unhex(?)
        FROM resource_catalog
        WHERE id = ? AND kind = 'secretStore'
        ON CONFLICT (resource_id) DO NOTHING
      `)).run(
        args.keyId,
        args.purpose,
        args.algorithm,
        args.keyHex,
        args.resourceId,
      );
      const stored = await fxResourceEncryptionKeyGet(portal, { resourceId: args.resourceId });
      if (!stored) throw new Error('Secret-store resource was not found.');
      return stored;
    },
  });
}
