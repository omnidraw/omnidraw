import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '../ResourceControlStoreTurso';

const RESOURCE_ID = 'resource-db';
const DRAFT_ID = 'draft-a';
const APPLY_ID = 'apply-a';
const BACKUP_ID = 'backup-a';
const TIMESTAMP_SEC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const VALID_TIMESTAMP_SEC = '2099-08-04 12:34:56';

describe('single-user resource control store', () => {
  let service: DbServiceTurso;
  let store: ResourceControlStoreTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ applicationVersion: 'test', databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
    store = new ResourceControlStoreTurso(service.db);
  });

  afterEach(async () => {
    await service.stop();
  });

  test('persists catalog, placement, draft, apply, and backup records with database clocks', async () => {
    expect(await store.createResource({
      id: RESOURCE_ID,
      kind: 'db',
      name: '  Main Database  ',
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/main-db',
    })).toEqual({
      id: RESOURCE_ID,
      kind: 'db',
      name: 'Main Database',
      status: 'created',
      lastError: null,
      createdAtSec: expect.stringMatching(TIMESTAMP_SEC),
      updatedAtSec: expect.stringMatching(TIMESTAMP_SEC),
    });
    expect(await store.getPlacement(RESOURCE_ID)).toMatchObject({
      resourceId: RESOURCE_ID,
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/main-db',
      status: 'reserved',
    });
    await store.updateResourceState({
      resourceId: RESOURCE_ID,
      expectedStatus: 'created',
      status: 'ready',
      lastError: null,
    });

    const draft = await store.createDbDraft({
      id: DRAFT_ID,
      resourceId: RESOURCE_ID,
      name: 'Add notes',
      status: 'editing',
      lastError: null,
      appliedAtSec: null,
    });
    expect(draft).toMatchObject({
      id: DRAFT_ID,
      resourceId: RESOURCE_ID,
      createdAtSec: expect.stringMatching(TIMESTAMP_SEC),
      updatedAtSec: expect.stringMatching(TIMESTAMP_SEC),
    });
    expect(await store.appendDbDraftChange({
      draftId: DRAFT_ID,
      sequence: 1,
      kind: 'sql',
      operation: { type: 'boundSql', parameters: [{ type: 'text', value: 'first' }] },
      sql: 'INSERT INTO notes (body) VALUES (?)',
    })).toMatchObject({ draftId: DRAFT_ID, sequence: 1, createdAtSec: expect.stringMatching(TIMESTAMP_SEC) });

    const apply = await store.createDbApply({
      id: APPLY_ID,
      resourceId: RESOURCE_ID,
      draftId: DRAFT_ID,
      sourceApplyId: null,
      status: 'succeeded',
      lastError: null,
      backupRetained: true,
      completedAtSec: VALID_TIMESTAMP_SEC,
    });
    expect(apply).toMatchObject({
      id: APPLY_ID,
      resourceId: RESOURCE_ID,
      draftId: DRAFT_ID,
      backupRetained: true,
      completedAtSec: VALID_TIMESTAMP_SEC,
      createdAtSec: expect.stringMatching(TIMESTAMP_SEC),
    });
    const backup = await store.createDbBackup({
      id: BACKUP_ID,
      resourceId: RESOURCE_ID,
      applyRunId: APPLY_ID,
      storageKey: 'resources/main-db/backups/apply-a.db',
      digestSha256: 'a'.repeat(64),
      byteSize: 42,
      state: 'retained',
      verifiedAtSec: VALID_TIMESTAMP_SEC,
      deleteAfterSec: '2100-08-04 12:34:56',
    });
    expect(backup).toMatchObject({
      id: BACKUP_ID,
      resourceId: RESOURCE_ID,
      applyRunId: APPLY_ID,
      createdAtSec: expect.stringMatching(TIMESTAMP_SEC),
      verifiedAtSec: VALID_TIMESTAMP_SEC,
    });
    expect(await store.listDbDraftChanges(DRAFT_ID)).toHaveLength(1);
    expect(await store.listDbDrafts({ resourceId: RESOURCE_ID })).toHaveLength(1);
    expect(await store.listDbApplies({ resourceId: RESOURCE_ID })).toHaveLength(1);
    expect(await store.listDbBackups(RESOURCE_ID)).toHaveLength(1);
  });

  test('rejects non-canonical or invalid caller timestamps before preparing writes', async () => {
    await store.createResource({
      id: RESOURCE_ID,
      kind: 'db',
      name: 'Main Database',
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/main-db',
    });
    await store.updateResourceState({
      resourceId: RESOURCE_ID,
      expectedStatus: 'created',
      status: 'ready',
      lastError: null,
    });
    await expect(store.createDbDraft({
      id: DRAFT_ID,
      resourceId: RESOURCE_ID,
      name: 'Invalid date',
      status: 'editing',
      lastError: null,
      appliedAtSec: '2026-02-29 00:00:00',
    })).rejects.toThrow('valid UTC whole-second');
    await expect(store.createDbApply({
      id: APPLY_ID,
      resourceId: RESOURCE_ID,
      draftId: null,
      sourceApplyId: null,
      status: 'failed',
      lastError: null,
      backupRetained: false,
      completedAtSec: '2026-08-04T12:34:56Z',
    })).rejects.toThrow('canonical UTC whole-second');
    expect(await store.getDbDraft(DRAFT_ID)).toBeNull();
    expect(await store.getDbApply(APPLY_ID)).toBeNull();

    await store.createDbApply({
      id: APPLY_ID,
      resourceId: RESOURCE_ID,
      draftId: null,
      sourceApplyId: null,
      status: 'succeeded',
      lastError: null,
      backupRetained: true,
      completedAtSec: VALID_TIMESTAMP_SEC,
    });
    await expect(store.createDbBackup({
      id: BACKUP_ID,
      resourceId: RESOURCE_ID,
      applyRunId: APPLY_ID,
      storageKey: 'resources/main-db/backups/apply-a.db',
      digestSha256: 'a'.repeat(64),
      byteSize: 42,
      state: 'retained',
      verifiedAtSec: '0',
      deleteAfterSec: null,
    })).rejects.toThrow('canonical UTC whole-second');
    expect(await store.getDbBackup({ resourceId: RESOURCE_ID, applyRunId: APPLY_ID })).toBeNull();
  });

  test('enforces normalized unique names without hidden scope keys', async () => {
    await store.createResource({
      id: 'resource-a',
      kind: 'kv',
      name: 'Preferences',
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/preferences',
    });
    await expect(store.createResource({
      id: 'resource-b',
      kind: 'kv',
      name: ' preferences ',
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/preferences-2',
    })).rejects.toMatchObject({ code: 'RESOURCE_NAME_CONFLICT' });
    expect(await store.listResources()).toHaveLength(1);
  });

  test('rejects DB lifecycle records for a non-DB resource', async () => {
    await store.createResource({
      id: 'resource-kv',
      kind: 'kv',
      name: 'Preferences',
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/preferences',
    });
    await store.updateResourceState({
      resourceId: 'resource-kv',
      expectedStatus: 'created',
      status: 'ready',
      lastError: null,
    });
    await expect(store.createDbDraft({
      id: 'draft-kv',
      resourceId: 'resource-kv',
      name: 'Not a database',
      status: 'editing',
      lastError: null,
      appliedAtSec: null,
    })).rejects.toThrow('not an available DbResource');
    await expect(store.createDbApply({
      id: 'apply-kv',
      resourceId: 'resource-kv',
      draftId: null,
      sourceApplyId: null,
      status: 'succeeded',
      lastError: null,
      backupRetained: false,
      completedAtSec: VALID_TIMESTAMP_SEC,
    })).rejects.toThrow('not an available DbResource');
    await expect(store.createDbBackup({
      id: 'backup-kv',
      resourceId: 'resource-kv',
      applyRunId: 'missing-apply',
      storageKey: 'resources/preferences/backup.db',
      digestSha256: 'a'.repeat(64),
      byteSize: 1,
      state: 'deleted',
      verifiedAtSec: VALID_TIMESTAMP_SEC,
      deleteAfterSec: null,
    })).rejects.toThrow('not an available DbResource');
    expect(await (await service.db.prepare(`
      SELECT
        (SELECT count(*) FROM db_resource_drafts) AS drafts,
        (SELECT count(*) FROM db_resource_apply_runs) AS applies,
        (SELECT count(*) FROM db_resource_backups) AS backups
    `)).get()).toEqual({ drafts: 0, applies: 0, backups: 0 });
  });
});
