import { describe, expect, test } from 'bun:test';
import { ResourceError } from '@omnidraw/resource-runtime';
import { withResourceApiError } from './api.resource-error';
import {
  resourceContract,
  ZResource,
  ZResourceDataPage,
  ZResourceDataMutationResult,
  ZResourceSecretReveal,
  ZResourceScope,
  ZCreateResourceInput,
  ZDbBlobPreviewCellValue,
  ZDbCellValue,
  ZDbInspection,
  ZDbPreviewCellValue,
  ZDbDraftOperation,
  ZDbRowIdentity,
} from './contract';

describe('neutral resource contracts', () => {
  test('accepts generic lifecycle-only resource rows', () => {
    expect(ZResource.parse({
      id: 'resource-1',
      kind: 'secretStore',
      name: 'GitHub token',
      status: 'ready',
      lastError: null,
      createdAtSec: '2026-07-11 00:00:00',
      updatedAtSec: '2026-07-11 00:00:00',
    })).toMatchObject({ id: 'resource-1', kind: 'secretStore', status: 'ready' });
  });

  test('requires kind-specific resource creation input', () => {
    expect(ZCreateResourceInput.parse({ kind: 'kv', name: 'Preferences' })).toEqual({
      kind: 'kv',
      name: 'Preferences',
    });
    expect(ZCreateResourceInput.safeParse({
      kind: 'kv',
      name: 'Preferences',
      db: { schemaId: 'notes', version: 1 },
    }).success).toBe(false);
    expect(ZCreateResourceInput.safeParse({ kind: 'db', name: 'Notes' }).success).toBe(true);
    expect(ZCreateResourceInput.safeParse({
      kind: 'db',
      name: 'Notes',
      db: { schemaId: 'legacy', version: 1 },
    }).success).toBe(false);
    expect(ZCreateResourceInput.safeParse({
      kind: 'db',
      name: 'Notes',
      db: { schemaId: 'notes', version: 0 },
    }).success).toBe(false);
    expect(ZCreateResourceInput.safeParse({ kind: 'secretStore', name: '   ' }).success).toBe(false);
  });

  test('requires a non-empty duplicate-free permission scope', () => {
    expect(ZResourceScope.safeParse([]).success).toBe(false);
    expect(ZResourceScope.safeParse(['read', 'read']).success).toBe(false);
    expect(ZResourceScope.parse(['read', 'write'])).toEqual(['read', 'write']);
  });

  test('exposes bounded KV previews while secret pages omit values', () => {
    expect(ZResourceDataPage.parse({
      kind: 'kv',
      entries: [{
        key: 'theme',
        valuePreview: '"dark"',
        valueTruncated: false,
        revision: 2,
        createdAtSec: '2026-07-13 00:00:00',
        updatedAtSec: '2026-07-13 00:01:00',
      }],
      nextCursor: null,
    })).toMatchObject({ kind: 'kv', entries: [{ key: 'theme' }] });
    expect(ZResourceDataPage.safeParse({
      kind: 'secretStore',
      entries: [{
        name: 'api-token',
        value: 'must-not-cross-the-api',
        revision: 1,
        createdAtSec: '2026-07-13 00:00:00',
        updatedAtSec: '2026-07-13 00:00:00',
      }],
      nextCursor: null,
    }).success).toBe(false);
    expect(ZResourceDataMutationResult.safeParse({
      kind: 'secretStore',
      entry: {
        name: 'api-token',
        value: 'must-not-cross-the-api',
        revision: 2,
        createdAtSec: '2026-07-13 00:00:00',
        updatedAtSec: '2026-07-13 00:01:00',
      },
    }).success).toBe(false);
  });

  test('allows plaintext only in the strict one-secret reveal response', () => {
    expect(resourceContract.resources.dataRevealSecret['~orpc'].route).toEqual({ method: 'POST' });
    expect(ZResourceSecretReveal.parse({
      kind: 'secretStore',
      name: 'api-token',
      value: 'operator-only-secret',
      revision: 3,
    })).toEqual({
      kind: 'secretStore',
      name: 'api-token',
      value: 'operator-only-secret',
      revision: 3,
    });
    expect(ZResourceSecretReveal.safeParse({
      kind: 'secretStore',
      name: 'api-token',
      value: 'operator-only-secret',
      revision: 3,
      createdAtSec: '2026-07-19 00:00:00',
    }).success).toBe(false);
    expect(ZResourceSecretReveal.safeParse({
      kind: 'kv',
      name: 'api-token',
      value: 'operator-only-secret',
      revision: 3,
    }).success).toBe(false);
  });

  test('bounds lossless SQLite integers, blobs, identities, and inspection SQL', () => {
    expect(ZDbPreviewCellValue.parse({ type: 'text', value: 'row 1' })).toEqual({ type: 'text', value: 'row 1' });
    expect(ZDbCellValue.safeParse({ type: 'integer', value: '-9223372036854775808' }).success).toBe(true);
    expect(ZDbCellValue.safeParse({ type: 'integer', value: '9223372036854775807' }).success).toBe(true);
    expect(ZDbCellValue.safeParse({ type: 'integer', value: '9223372036854775808' }).success).toBe(false);
    expect(ZDbCellValue.safeParse({ type: 'blob', base64: 'AQID' }).success).toBe(true);
    expect(ZDbCellValue.safeParse({ type: 'blob', base64: 'not base64' }).success).toBe(false);
    expect(ZDbBlobPreviewCellValue.safeParse({ type: 'blobPreview', byteLength: 8_388_608, previewBase64: 'AQID', truncated: true }).success).toBe(true);
    expect(ZDbBlobPreviewCellValue.safeParse({ type: 'blobPreview', byteLength: 3, previewBase64: 'not base64', truncated: false }).success).toBe(false);
    expect(ZDbRowIdentity.safeParse({ kind: 'rowid', value: { type: 'null' } }).success).toBe(false);
    expect(ZDbRowIdentity.safeParse({ kind: 'primaryKey', values: {} }).success).toBe(false);

    const inspection = {
      resourceId: 'resource-1',
      target: 'live' as const,
      draftId: null,
      objects: [{
        name: 'notes',
        kind: 'table' as const,
        columns: [],
        indexes: [],
        foreignKeys: [],
        triggers: [],
        createSql: `CREATE TABLE notes (value TEXT DEFAULT '${'x'.repeat(1_048_577)}')`,
        identity: { kind: 'rowid' as const },
        editable: true,
        readOnlyReason: null,
      }],
    };
    expect(ZDbInspection.safeParse(inspection).success).toBe(false);
  });

  test('accepts typed STRICT and WITHOUT ROWID structured table inputs', () => {
    const operation = {
      kind: 'createTable' as const,
      table: 'notes',
      columns: [{ name: 'id', declaredType: 'INTEGER', primaryKeyOrder: 1 }],
      strict: true,
      withoutRowid: true,
    };
    expect(ZDbDraftOperation.parse(operation)).toEqual(operation);
    expect(ZDbDraftOperation.safeParse({ ...operation, strict: 'yes' }).success).toBe(false);
  });

  test('preserves stable safe resource codes through the ORPC error envelope', async () => {
    const sentinel = 'must-not-leak';
    try {
      await withResourceApiError(async () => {
        throw new ResourceError('RESOURCE_NOT_READY', 'Resource is not ready.', {
          status: 'migrating',
          token: sentinel,
        });
      });
      throw new Error('Expected resource error');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'RESOURCE_ERROR',
        message: 'Resource is not ready.',
        data: { code: 'RESOURCE_NOT_READY', details: { status: 'migrating' } },
      });
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });
});
