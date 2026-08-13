import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TEncryptionKey } from '../model';
import { runDatabaseTransaction } from '../run-database-transaction';
import { getResourceEncryptionKey } from './read-encryption-key';

type TEffects = { db: Database };
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

export async function getOrCreateResourceEncryptionKey(
  effects: TEffects,
  args: TArgs,
): Promise<TEncryptionKey> {
  assertEncryptionKeyArgs(args);
  return runDatabaseTransaction({ database: effects.db }, {
    operation: async () => {
      const existing = await getResourceEncryptionKey(effects, { resourceId: args.resourceId });
      if (existing) return existing;
      await (await effects.db.prepare(DATABASE_STATEMENTS.encryptionKeyInsertForResource)).run(
        args.keyId,
        args.purpose,
        args.algorithm,
        args.keyHex,
        args.resourceId,
      );
      const stored = await getResourceEncryptionKey(effects, { resourceId: args.resourceId });
      if (!stored) throw new Error('Secret-store resource was not found.');
      return stored;
    },
  });
}
