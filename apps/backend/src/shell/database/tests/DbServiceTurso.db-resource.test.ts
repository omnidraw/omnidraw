import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DbServiceTurso } from '../DbServiceTurso/DbServiceTurso';
import { ResourceControlStoreTurso } from '../ResourceControlStoreTurso';

describe('DbService resource coordinator repository', () => {
  let service: DbServiceTurso;

  beforeEach(async () => {
    service = new DbServiceTurso({ applicationVersion: 'test', databasePath: ':memory:', dataDir: '/tmp', cacheDir: '/tmp' });
    await service.start();
    const control = new ResourceControlStoreTurso(service.db);
    await control.createResource({
      id: 'database-a',
      kind: 'db',
      name: 'Database A',
      cellId: 'local-cell',
      placementEpoch: 1,
      storageKey: 'resources/database-a',
    });
    await control.updateResourceState({
      resourceId: 'database-a',
      expectedStatus: 'created',
      status: 'ready',
      lastError: null,
    });
  });

  afterEach(async () => service.stop());

  test('coordinates one draft and apply lane with camel-case second cursors', async () => {
    const draft = await service.dbResource.draft.create({
      id: 'draft-a',
      resourceId: 'database-a',
      name: 'Add notes',
    });
    expect(draft).toMatchObject({
      id: 'draft-a',
      resourceId: 'database-a',
      status: 'editing',
      createdAtSec: expect.any(String),
      appliedAtSec: null,
    });
    expect(await service.dbResource.draft.change.append({
      draftId: draft.id,
      sequence: 1,
      kind: 'sql',
      operation: { type: 'boundSql', parameters: [] },
      sql: 'CREATE TABLE notes (id TEXT) STRICT',
    })).toMatchObject({ draftId: draft.id, sequence: 1 });
    expect(await service.dbResource.draft.list({
      resourceId: 'database-a',
      before: { createdAtSec: '9999-12-31 23:59:59', id: 'zzzz' },
    })).toHaveLength(1);

    const started = await service.dbResource.apply.createFromDraft({
      id: 'apply-a',
      resourceId: 'database-a',
      draftId: draft.id,
    });
    expect(started).toMatchObject({
      apply: { id: 'apply-a', status: 'preparing' },
      draft: { id: 'draft-a', status: 'applying' },
    });
    await service.dbResource.apply.update({
      id: 'apply-a',
      status: 'applying',
      expectedStatus: 'preparing',
      lastError: null,
    });
    const finished = await service.dbResource.apply.finishWithDraft({
      id: 'apply-a',
      draftId: 'draft-a',
      status: 'succeeded',
      expectedStatus: 'applying',
      draftStatus: 'applied',
      lastError: null,
      backupRetained: true,
    });
    expect(finished).toMatchObject({
      apply: { id: 'apply-a', status: 'succeeded', backupRetained: true },
      draft: { id: 'draft-a', status: 'applied', appliedAtSec: expect.any(String) },
    });
    expect(await service.dbResource.apply.list({ resourceId: 'database-a' })).toHaveLength(1);
  });
});
