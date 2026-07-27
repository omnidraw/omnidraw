import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connect, type Database } from '@tursodatabase/database';
import { DEFAULT_OSS_ORGANIZATION_ID } from '../../../src/CONSTANTS';
import { fxResourceEncryptionKeyGet } from '../../../src/DbServiceTurso/fx.encryption-key';
import { txResourceEncryptionKeyGetOrCreate } from '../../../src/DbServiceTurso/tx.encryption-key';
import { txRunMigrations } from '../../../src/DbServiceTurso/tx.migrations';
import { EXPECTED_DATABASE_SCHEMA_CONTRACTS } from '../../../src/schema/expected-schema';
import { TEST_TENANT } from '../tenant.fixture';

const SECRET_ID = '00000000-0000-4000-8000-000000000201';
const KEY_ID = '00000000-0000-4000-8000-000000000211';

describe('resource encryption keys', () => {
  let db!: Database;

  beforeEach(async () => {
    // @ts-expect-error custom_types is not typed yet
    db = await connect(':memory:', { experimental: ['custom_types', 'triggers', 'index_method'] });
    await txRunMigrations({ db, Bun, TextDecoder }, {
      applicationVersion: 'test', appliedAtMs: 1,
      expectedSchemaContracts: EXPECTED_DATABASE_SCHEMA_CONTRACTS,
    });
    await (await db.prepare(`
      INSERT INTO resource_catalog (
        org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'secretStore', 'Credentials', 'ready', NULL, 1, 1)
    `)).run(DEFAULT_OSS_ORGANIZATION_ID, SECRET_ID);
  });

  afterEach(async () => { await db.close(); });

  test('creates and reads canonical neutral key material', async () => {
    const args = {
      tenant: TEST_TENANT, resourceId: SECRET_ID, keyId: KEY_ID,
      purpose: 'resource-secret-store', algorithm: 'aegis256', keyHex: '11'.repeat(32),
    };
    const created = await txResourceEncryptionKeyGetOrCreate({ db }, args);
    expect(created).toMatchObject({ id: KEY_ID, purpose: 'resource-secret-store' });
    await expect(fxResourceEncryptionKeyGet({ db }, {
      tenant: TEST_TENANT, resourceId: SECRET_ID,
    })).resolves.toEqual(created);
    expect(await (await db.prepare(`
      SELECT purpose, algorithm FROM resource_encryption_keys WHERE org_id = ? AND resource_id = ?
    `)).get(DEFAULT_OSS_ORGANIZATION_ID, SECRET_ID)).toEqual({
      purpose: 'resource-data', algorithm: 'aegis-256',
    });
  });

  test('rejects malformed keys and missing resources', async () => {
    await expect(txResourceEncryptionKeyGetOrCreate({ db }, {
      tenant: TEST_TENANT, resourceId: SECRET_ID, keyId: KEY_ID,
      purpose: 'resource-secret-store', algorithm: 'aegis256', keyHex: 'AA'.repeat(32),
    })).rejects.toThrow();
    await expect(txResourceEncryptionKeyGetOrCreate({ db }, {
      tenant: TEST_TENANT, resourceId: KEY_ID, keyId: KEY_ID,
      purpose: 'resource-secret-store', algorithm: 'aegis256', keyHex: '11'.repeat(32),
    })).rejects.toThrow('Secret-store resource was not found');
  });
});
