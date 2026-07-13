import { describe, expect, test } from 'bun:test';
import { ActorResourceError } from '@vibecanvas/service-actor/resources/ActorResourceError';
import { withActorResourceApiError } from './api.resource-error';
import {
  ZActorEvent,
  ZActorResource,
  ZActorResourceDataPage,
  ZActorResourceDataMutationResult,
  ZActorResourceScope,
  ZCreateActorResourceInput,
  ZDbBlobPreviewCellValue,
  ZDbCellValue,
  ZDbInspection,
  ZDbPreviewCellValue,
  ZDbDraftOperation,
  ZDbRowIdentity,
} from './contract';

describe('ZActorEvent', () => {
  test('accepts revisioned actor snapshot events', () => {
    expect(ZActorEvent.safeParse({
      kind: 'system',
      actorId: 'actor-1',
      type: 'snapshot',
      revision: 2,
      state: 'busy.counting',
      data: { ticks: 4 },
      cause: 'activity',
      jobId: 'job-2',
    }).success).toBe(true);
  });

  test('rejects invalid snapshot revisions and causes', () => {
    expect(ZActorEvent.safeParse({
      kind: 'system',
      actorId: 'actor-1',
      type: 'snapshot',
      revision: 0,
      state: 'ready',
      data: {},
      cause: 'timer',
    }).success).toBe(false);
  });
});

describe('actor resource contracts', () => {
  test('accepts generic lifecycle-only resource rows', () => {
    expect(ZActorResource.parse({
      id: 'resource-1',
      kind: 'secretStore',
      name: 'GitHub token',
      status: 'ready',
      last_error: null,
      created_at: '2026-07-11T00:00:00.000Z',
      updated_at: '2026-07-11T00:00:00.000Z',
    })).toMatchObject({ id: 'resource-1', kind: 'secretStore', status: 'ready' });
  });

  test('requires kind-specific resource creation input', () => {
    expect(ZCreateActorResourceInput.parse({ kind: 'kv', name: 'Preferences' })).toEqual({
      kind: 'kv',
      name: 'Preferences',
    });
    expect(ZCreateActorResourceInput.safeParse({
      kind: 'kv',
      name: 'Preferences',
      db: { schemaId: 'notes', version: 1 },
    }).success).toBe(false);
    expect(ZCreateActorResourceInput.safeParse({ kind: 'db', name: 'Notes' }).success).toBe(true);
    expect(ZCreateActorResourceInput.safeParse({
      kind: 'db',
      name: 'Notes',
      db: { schemaId: 'legacy', version: 1 },
    }).success).toBe(false);
    expect(ZCreateActorResourceInput.safeParse({
      kind: 'db',
      name: 'Notes',
      db: { schemaId: 'notes', version: 0 },
    }).success).toBe(false);
    expect(ZCreateActorResourceInput.safeParse({ kind: 'secretStore', name: '   ' }).success).toBe(false);
  });

  test('requires a non-empty duplicate-free permission scope', () => {
    expect(ZActorResourceScope.safeParse([]).success).toBe(false);
    expect(ZActorResourceScope.safeParse(['read', 'read']).success).toBe(false);
    expect(ZActorResourceScope.parse(['read', 'write'])).toEqual(['read', 'write']);
  });

  test('exposes bounded KV previews while secret pages omit values', () => {
    expect(ZActorResourceDataPage.parse({
      kind: 'kv',
      entries: [{
        key: 'theme',
        valuePreview: '"dark"',
        valueTruncated: false,
        revision: 2,
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:01:00.000Z',
      }],
      nextCursor: null,
    })).toMatchObject({ kind: 'kv', entries: [{ key: 'theme' }] });
    expect(ZActorResourceDataPage.safeParse({
      kind: 'secretStore',
      entries: [{
        name: 'api-token',
        value: 'must-not-cross-the-api',
        revision: 1,
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:00:00.000Z',
      }],
      nextCursor: null,
    }).success).toBe(false);
    expect(ZActorResourceDataMutationResult.safeParse({
      kind: 'secretStore',
      entry: {
        name: 'api-token',
        value: 'must-not-cross-the-api',
        revision: 2,
        createdAt: '2026-07-13T00:00:00.000Z',
        updatedAt: '2026-07-13T00:01:00.000Z',
      },
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
      await withActorResourceApiError(async () => {
        throw new ActorResourceError('RESOURCE_STILL_BOUND', 'Resource remains bound.', {
          bindingCount: 2,
          token: sentinel,
        });
      });
      throw new Error('Expected resource error');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'ACTOR_RESOURCE_ERROR',
        message: 'Resource remains bound.',
        data: { code: 'RESOURCE_STILL_BOUND', details: { bindingCount: 2 } },
      });
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });
});
