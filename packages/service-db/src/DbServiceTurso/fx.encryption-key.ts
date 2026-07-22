import type { Database } from '@tursodatabase/database';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { TEncryptionKey } from '../model';
import { fnTimestampFromMs } from './fn.legacy-row';

type TPortal = {
  db: Database;
};

type TArgs = {
  tenant: TTenantContext;
  resourceId: string;
};

function parseEncryptionKey(row: unknown): TEncryptionKey {
  const value = row as {
    id: unknown;
    key_hex: unknown;
    created_at_ms: unknown;
  };
  if (typeof value.id !== 'string' || typeof value.key_hex !== 'string') {
    throw new Error('Stored encryption key is invalid.');
  }
  return {
    id: value.id,
    purpose: 'resource-secret-store',
    algorithm: 'aegis256',
    key_hex: value.key_hex,
    created_at: fnTimestampFromMs(value.created_at_ms),
  };
}

export async function fxResourceEncryptionKeyGet(
  portal: TPortal,
  args: TArgs,
): Promise<TEncryptionKey | null> {
  const row = await (await portal.db.prepare(`
    SELECT id, lower(hex(key_material)) AS key_hex, created_at_ms
    FROM resource_encryption_keys
    WHERE org_id = ? AND resource_id = ?
  `)).get(args.tenant.orgId, args.resourceId);
  return row ? parseEncryptionKey(row) : null;
}
