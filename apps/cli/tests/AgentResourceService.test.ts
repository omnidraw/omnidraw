import { describe, expect, test } from 'bun:test';
import type { TResourceJson } from '@omnidraw/resource-runtime';
import type { TResourceCatalogRecord } from '@omnidraw/resource-runtime/local';
import { createAgentResourceService } from '../src/services/AgentResourceService';
import type { ResourceService } from '../src/services/ResourceService';

const catalogResource: TResourceCatalogRecord = Object.freeze({
  id: 'resource-a',
  kind: 'kv',
  name: 'Notes',
  status: 'ready',
  lastError: null,
  createdAtSec: '2026-07-22 00:00:00',
  updatedAtSec: '2026-07-22 00:00:00',
});

type TRecordedCall = Readonly<{
  method: string;
  args: readonly unknown[];
}>;

function recordingOwner(
  calls: TRecordedCall[],
  results: Readonly<Record<string, unknown>> = {},
): ResourceService {
  return new Proxy({}, {
    get: (_target, property) => (...args: unknown[]) => {
      calls.push({ method: String(property), args });
      return Promise.resolve(results[String(property)]);
    },
  }) as ResourceService;
}

describe('createAgentResourceService', () => {
  test('exposes only the frozen agent resource capability', async () => {
    const capability = createAgentResourceService(recordingOwner([]));

    expect(Object.isFrozen(capability)).toBe(true);
    expect(Object.keys(capability).sort()).toEqual([
      'confirmDbApply',
      'countResourceData',
      'createDbDraft',
      'createResource',
      'deleteResource',
      'deleteResourceDataEntry',
      'discardDbDraft',
      'executeDbDraftSql',
      'executeDbLiveSql',
      'getDbApply',
      'getResource',
      'getResourceDataEntry',
      'inspectDbResource',
      'listResourceData',
      'listResources',
      'previewDbApply',
      'renameResource',
      'resolveResourceByName',
      'setResourceDataEntry',
    ]);
    expect('call' in capability).toBe(false);
    expect('bindResource' in capability).toBe(false);
  });

  test('forwards every operation with unchanged arguments', async () => {
    const calls: TRecordedCall[] = [];
    const capability = createAgentResourceService(recordingOwner(calls, {
      getDbApply: { apply: { id: 'apply-a', status: 'applying' }, drain: null },
    }));
    const filter = Object.freeze({ kind: 'kv' as const, status: 'ready' as const });
    const resolveOptions = Object.freeze({ requireReady: true, kind: 'kv' as const });
    const createRequest = Object.freeze({ kind: 'kv' as const, name: 'Notes' });
    const renameRequest = Object.freeze({ id: 'resource-a', name: 'Journal' });
    const dataQuery = Object.freeze({ resourceId: 'resource-a', prefix: 'note/' });
    const dataPageQuery = Object.freeze({ ...dataQuery, cursor: 'note/1', limit: 10 });
    const dataEntryRequest = Object.freeze({ resourceId: 'resource-a', key: 'note/1' });
    const setRequest = Object.freeze({
      ...dataEntryRequest,
      expectedRevision: null,
      value: { title: 'Hello' } satisfies TResourceJson,
    });
    const deleteRequest = Object.freeze({ ...dataEntryRequest, expectedRevision: 1 });
    const inspectionRequest = Object.freeze({ resourceId: 'database-a', target: 'live' as const });
    const liveSqlRequest = Object.freeze({
      resourceId: 'database-a',
      sql: 'select ?',
      parameters: [1] as const,
      approved: true,
    });
    const draftParameters = [2] as const;

    await capability.listResources!(filter);
    await capability.getResource!('resource-a');
    await capability.resolveResourceByName!('Notes', resolveOptions);
    await capability.createResource!(createRequest);
    await capability.renameResource!(renameRequest);
    await capability.deleteResource!('resource-a');
    await capability.countResourceData!(dataQuery);
    await capability.listResourceData!(dataPageQuery);
    await capability.getResourceDataEntry!(dataEntryRequest);
    await capability.setResourceDataEntry!(setRequest);
    await capability.deleteResourceDataEntry!(deleteRequest);
    await capability.inspectDbResource!(inspectionRequest);
    await capability.executeDbLiveSql!(liveSqlRequest);
    await capability.createDbDraft!('database-a', 'add-index');
    await capability.executeDbDraftSql!('draft-a', 'create index i on notes(id)', draftParameters);
    await capability.discardDbDraft!('draft-a');
    await capability.previewDbApply!('draft-a');
    await capability.confirmDbApply!('draft-a');
    await capability.getDbApply!('apply-a');

    expect(calls.map((call) => call.method)).toEqual([
      'listResources',
      'getResource',
      'resolveResourceByName',
      'createResource',
      'renameResource',
      'deleteResource',
      'countResourceData',
      'listResourceData',
      'getResourceDataEntry',
      'setResourceDataEntry',
      'deleteResourceDataEntry',
      'inspectDbResource',
      'executeDbLiveSql',
      'createDbDraft',
      'executeDbDraftSql',
      'discardDbDraft',
      'previewDbApply',
      'confirmDbApply',
      'getDbApply',
    ]);
    expect(calls.map((call) => call.args)).toEqual([
      [filter],
      ['resource-a'],
      ['Notes', resolveOptions],
      [createRequest],
      [renameRequest],
      ['resource-a'],
      [dataQuery],
      [dataPageQuery],
      [dataEntryRequest],
      [setRequest],
      [deleteRequest],
      [inspectionRequest],
      [liveSqlRequest],
      ['database-a', 'add-index'],
      ['draft-a', 'create index i on notes(id)', draftParameters],
      ['draft-a'],
      ['draft-a'],
      ['draft-a'],
      ['apply-a'],
    ]);
  });

  test('preserves catalog, data, and database draft/apply results', async () => {
    const dataResult = Object.freeze({
      kind: 'kv' as const,
      key: 'note/1',
      value: { title: 'Hello' },
      revision: 1,
      createdAtSec: '2026-07-22 00:00:00',
      updatedAtSec: '2026-07-22 00:00:00',
    });
    const results = Object.freeze({
      listResources: [catalogResource],
      getResourceDataEntry: dataResult,
      createDbDraft: { draft: { id: 'draft-a' } },
      executeDbDraftSql: { rowsAffected: 1 },
      previewDbApply: { warnings: ['table rebuild'] },
      confirmDbApply: { status: 'applying' },
      getDbApply: { apply: { id: 'apply-a', status: 'succeeded' }, drain: null },
    });
    const capability = createAgentResourceService(recordingOwner([], results));

    await expect(capability.listResources!()).resolves.toEqual([catalogResource]);
    await expect(capability.getResourceDataEntry!({
      resourceId: 'resource-a',
      key: 'note/1',
    })).resolves.toEqual(dataResult);
    const draft = await capability.createDbDraft!('database-a', 'add-index');
    expect(draft).toEqual({ draft: { id: 'draft-a' } });
    await expect(capability.executeDbDraftSql!(
      draft.draft.id,
      'create index i on notes(id)',
    )).resolves.toEqual({ rowsAffected: 1 });
    await expect(capability.previewDbApply!(draft.draft.id)).resolves.toEqual({
      warnings: ['table rebuild'],
    });
    await expect(capability.confirmDbApply!(draft.draft.id)).resolves.toEqual({
      status: 'applying',
    });
    await expect(capability.getDbApply!('apply-a')).resolves.toEqual({
      apply: { id: 'apply-a', status: 'succeeded' },
    });
  });
});
