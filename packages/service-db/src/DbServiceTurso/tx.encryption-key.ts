import type { Database } from '@tursodatabase/database';
import type { TTenantContext } from '@omnidraw/tenant-core';
import type { TEncryptionKey } from '../model';
import { txRunDatabaseTransaction } from '../tx.run-database-transaction';
import { fxResourceEncryptionKeyGet } from './fx.encryption-key';

type TPortal = {
  db: Database;
};

type TArgs = {
  tenant: TTenantContext;
  resourceId: string;
  keyId: string;
  purpose: string;
  algorithm: string;
  keyHex: string;
};

function assertEncryptionKeyArgs(args: TArgs): void {
  if (args.purpose !== 'resource-secret-store' || args.algorithm !== 'aegis256') {
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
      const existing = await fxResourceEncryptionKeyGet(portal, {
        tenant: args.tenant,
        resourceId: args.resourceId,
      });
      if (existing) return existing;

      await (await portal.db.prepare(`
        INSERT INTO resource_encryption_keys (
          org_id, id, resource_id, purpose, algorithm, key_material, created_at_ms
        )
        SELECT ?, ?, id, 'resource-data', 'aegis-256', unhex(?),
          CAST(unixepoch('subsec') * 1000 AS INTEGER)
        FROM resource_catalog
        WHERE org_id = ? AND id = ? AND kind = 'secretStore'
        ON CONFLICT (org_id, resource_id) DO NOTHING
      `)).run(
        args.tenant.orgId,
        args.keyId,
        args.keyHex,
        args.tenant.orgId,
        args.resourceId,
      );

      const stored = await fxResourceEncryptionKeyGet(portal, {
        tenant: args.tenant,
        resourceId: args.resourceId,
      });
      if (!stored) throw new Error('Secret-store resource was not found.');
      return stored;
    },
  });
}
