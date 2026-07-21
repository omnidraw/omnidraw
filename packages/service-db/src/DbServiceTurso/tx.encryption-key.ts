import type { Database } from '@tursodatabase/database';
import { DEFAULT_OSS_ORGANIZATION_ID } from '../CONSTANTS';
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

type TImmediateTransaction<T> = (() => Promise<T>) & {
  immediate: () => Promise<T>;
};

function assertEncryptionKeyArgs(args: TArgs): void {
  if (args.purpose !== 'actor-resource-secret-store' || args.algorithm !== 'aegis256') {
    throw new Error('Encryption key purpose or algorithm is unsupported.');
  }
  if (!/^[0-9a-f]{64}$/.test(args.keyHex)) {
    throw new Error('Encryption key must contain exactly 32 lowercase hexadecimal bytes.');
  }
}

export async function txActorResourceEncryptionKeyGetOrCreate(
  portal: TPortal,
  args: TArgs,
): Promise<TEncryptionKey> {
  assertEncryptionKeyArgs(args);
  const getOrCreate = portal.db.transaction(async () => {
    const existing = await fxActorResourceEncryptionKeyGet(portal, { resourceId: args.resourceId });
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
      DEFAULT_OSS_ORGANIZATION_ID,
      args.keyId,
      args.keyHex,
      DEFAULT_OSS_ORGANIZATION_ID,
      args.resourceId,
    );

    const stored = await fxActorResourceEncryptionKeyGet(portal, { resourceId: args.resourceId });
    if (!stored) throw new Error('Secret-store actor resource was not found.');
    return stored;
  }) as TImmediateTransaction<TEncryptionKey>;
  return getOrCreate.immediate();
}
