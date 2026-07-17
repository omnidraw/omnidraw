import { describe, expect, test } from 'bun:test';
import type { TActorResource } from '@vibecanvas/service-db/model';
import { ApprovalCoordinator } from '../src/approval/ApprovalCoordinator';
import type { TActorServiceReloader } from '../src/core/types';
import { createResourceTools } from '../src/tools/tool.resources';
import { executeTool } from './tool.test-helpers';

const timestamp = '2026-07-16T00:00:00.000Z';

function resource(id: string, kind: TActorResource['kind'], name: string, createdAt = timestamp): TActorResource {
  return {
    id,
    kind,
    name,
    status: 'ready',
    last_error: null,
    created_at: createdAt,
    updated_at: timestamp,
  };
}

function tools(
  actorService: TActorServiceReloader,
  approvals = new ApprovalCoordinator(),
  authorize = async () => true,
  takeSensitiveToolArgs?: (toolCallId: string) => unknown,
) {
  return {
    approvals,
    byName: new Map(createResourceTools({
      chatId: 'chat-a',
      authorization: { accountId: 'user-a' },
      actorService,
      approvals,
      authorize,
      takeSensitiveToolArgs,
    }).map((tool) => [tool.name, tool])),
  };
}

async function pendingApproval(coordinator: ApprovalCoordinator) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const approval = coordinator.list('chat-a')[0];
    if (approval) return approval;
    await Bun.sleep(1);
  }
  throw new Error('Approval was not created.');
}

describe('resource tools', () => {
  test('paginates safe metadata and returns ordered partial reads for every resource kind', async () => {
    const resources = [
      resource('kv-1', 'kv', 'Preferences', '2026-07-16T00:00:01.000Z'),
      resource('secret-1', 'secretStore', 'Credentials', '2026-07-16T00:00:02.000Z'),
      resource('db-1', 'db', 'Notes', '2026-07-16T00:00:03.000Z'),
    ];
    const dbCalls: unknown[] = [];
    const actorService: TActorServiceReloader = {
      reload: async () => {},
      listResources: async (filter = {}) => resources.filter((entry) => !filter.kind || entry.kind === filter.kind),
      getResource: async (id) => resources.find((entry) => entry.id === id) ?? null,
      listResourceReferences: async () => [{ slot_name: 'storage' }],
      listResourceData: async ({ resourceId }) => resourceId === 'secret-1'
        ? { kind: 'secretStore', entries: [{ name: 'TOKEN', revision: 1, createdAt: timestamp, updatedAt: timestamp }], nextCursor: null }
        : { kind: 'kv', entries: [{ key: 'theme', valuePreview: 'dark', valueTruncated: false, revision: 1, createdAt: timestamp, updatedAt: timestamp }], nextCursor: null },
      getResourceDataEntry: async ({ resourceId, key }) => {
        if (key === 'missing') return null;
        if (resourceId === 'secret-1') return { kind: 'secretStore', name: key, revision: 1, createdAt: timestamp, updatedAt: timestamp };
        return { kind: 'kv', key, value: { mode: 'dark' }, revision: 1, createdAt: timestamp, updatedAt: timestamp };
      },
      inspectDbResource: async () => ({ objects: [{
        name: 'notes', kind: 'table', columns: [], indexes: [], foreignKeys: [], triggers: [], createSql: 'CREATE TABLE notes(id INTEGER)', identity: null, editable: true, readOnlyReason: null,
      }] } as never),
      executeDbLiveSql: async (call) => {
        dbCalls.push(call);
        return { kind: 'rows', columns: ['id'], rows: [{ id: { type: 'integer', value: '7' } }], rowCount: 1, rowsAffected: 0, truncated: false };
      },
    };
    const { byName } = tools(actorService);

    const firstPage = await executeTool(byName.get('vc_resource_list')!, { limit: 2 });
    expect(firstPage.details).toMatchObject({
      resources: [{ id: 'kv-1' }, { id: 'secret-1' }],
      nextCursor: 'secret-1',
    });
    expect(JSON.stringify(firstPage.details)).not.toContain('valuePreview');
    const secondPage = await executeTool(byName.get('vc_resource_list')!, { cursor: 'secret-1', limit: 2 });
    expect(secondPage.details).toMatchObject({ resources: [{ id: 'db-1' }], nextCursor: null });

    const secretInspect = await executeTool(byName.get('vc_resource_inspect')!, { resourceId: 'secret-1' });
    expect(secretInspect.details).toMatchObject({ entries: [{ name: 'TOKEN', revision: 1 }] });
    expect(JSON.stringify(secretInspect)).not.toContain('plaintext');
    const dbInspect = await executeTool(byName.get('vc_resource_inspect')!, { resourceId: 'db-1' });
    expect(dbInspect.details).toMatchObject({ objects: [{ name: 'notes', kind: 'table' }], bindingCount: 1 });
    expect(JSON.stringify(dbInspect.details)).not.toContain('rows');

    const kvRead = await executeTool(byName.get('vc_resource_data_read')!, {
      resourceId: 'kv-1',
      query: [
        { kind: 'kv', operation: 'get', key: 'theme' },
        { kind: 'kv', operation: 'has', key: 'missing' },
        { kind: 'db', sql: 'SELECT 1' },
      ],
    });
    expect(kvRead.details.results).toEqual([
      { ok: true, value: { kind: 'kv', key: 'theme', value: { mode: 'dark' }, revision: 1, createdAt: timestamp, updatedAt: timestamp } },
      { ok: true, value: { exists: false } },
      { ok: false, error: { code: 'RESOURCE_OPERATION_FAILED', message: "Query kind 'db' does not match resource kind 'kv'." } },
    ]);

    const secretRead = await executeTool(byName.get('vc_resource_data_read')!, {
      resourceId: 'secret-1', query: { kind: 'secretStore', operation: 'has', key: 'TOKEN' },
    });
    expect(secretRead.details.results).toEqual([{ ok: true, value: { exists: true } }]);
    expect(JSON.stringify(secretRead)).not.toContain('plaintext');

    const dbRead = await executeTool(byName.get('vc_resource_data_read')!, {
      resourceId: 'db-1', query: { kind: 'db', sql: 'SELECT ? AS id', parameters: [{ type: 'integer', value: '7' }] },
    });
    expect(dbRead.details.results[0]).toMatchObject({ ok: true, value: { kind: 'rows', rowCount: 1 } });
    expect(dbCalls).toEqual([{
      resourceId: 'db-1', sql: 'SELECT ? AS id', parameters: [{ type: 'integer', value: '7' }], approved: false,
    }]);
  });

  test('requires approval for create/update/delete and rechecks current collisions or bindings', async () => {
    const resources = [resource('kv-1', 'kv', 'Preferences')];
    let nextId = 1;
    const actorService: TActorServiceReloader = {
      reload: async () => {},
      listResources: async () => [...resources],
      getResource: async (id) => resources.find((entry) => entry.id === id) ?? null,
      createResource: async ({ kind, name }) => {
        const created = resource(`created-${nextId++}`, kind, name);
        resources.push(created);
        return created;
      },
      renameResource: async ({ id, name }) => {
        const index = resources.findIndex((entry) => entry.id === id);
        const renamed = { ...resources[index]!, name };
        resources[index] = renamed;
        return renamed;
      },
      deleteResource: async (id) => {
        if (id === 'kv-1') throw Object.assign(new Error('Resource is still bound.'), { code: 'RESOURCE_STILL_BOUND' });
      },
    };
    let approvalId = 0;
    const approvals = new ApprovalCoordinator({ createId: () => `approval-${++approvalId}` });
    const { byName } = tools(actorService, approvals);

    for (const input of [
      { kind: 'kv', name: 'Cache' },
      { kind: 'secretStore', name: 'Tokens' },
      { kind: 'db', name: 'Reports', engine: 'sqlite' },
    ]) {
      const pending = executeTool(byName.get('vc_resource_create')!, input);
      const approval = await pendingApproval(approvals);
      await approvals.resolve('chat-a', approval.id, 'approve', { accountId: 'user-a' });
      expect((await pending).details.resource).toMatchObject({ kind: input.kind, name: input.name });
    }

    const update = executeTool(byName.get('vc_resource_update')!, { resourceId: 'kv-1', name: 'Settings' });
    const updateApproval = await pendingApproval(approvals);
    await approvals.resolve('chat-a', updateApproval.id, 'approve', { accountId: 'user-a' });
    expect((await update).details.resource).toMatchObject({ id: 'kv-1', name: 'Settings', kind: 'kv' });

    const remove = executeTool(byName.get('vc_resource_delete')!, { resourceId: 'kv-1' });
    const deleteApproval = await pendingApproval(approvals);
    await expect(approvals.resolve('chat-a', deleteApproval.id, 'approve', { accountId: 'user-a' })).rejects.toThrow('still bound');
    expect((await remove).details.error).toEqual({ code: 'RESOURCE_STILL_BOUND', message: 'Resource is still bound.' });
  });

  test('redacts secret writes and stages parameterized SQLite batches in one durable apply', async () => {
    const resources = [resource('secret-1', 'secretStore', 'Credentials'), resource('db-1', 'db', 'Notes')];
    const secretValues: unknown[] = [];
    const draftCalls: unknown[] = [];
    let liveApprovedWrite = false;
    const actorService: TActorServiceReloader = {
      reload: async () => {},
      listResources: async () => resources,
      getResource: async (id) => resources.find((entry) => entry.id === id) ?? null,
      getResourceDataEntry: async () => null,
      setResourceDataEntry: async ({ resourceId, key, value }) => {
        if (key === 'LEAK') throw new Error(`Provider rejected secret ${String(value)}`);
        secretValues.push(value);
        return { kind: 'secretStore', entry: { name: key, revision: 1, createdAt: timestamp, updatedAt: timestamp } };
      },
      deleteResourceDataEntry: async () => ({ deleted: true }),
      executeDbLiveSql: async ({ approved }) => {
        if (approved) liveApprovedWrite = true;
        return { kind: 'execute', rowsAffected: 1, lastInsertRowId: null };
      },
      createDbDraft: async (resourceId, name) => {
        draftCalls.push({ type: 'create', resourceId, name });
        return { draft: { id: 'draft-1' } };
      },
      executeDbDraftSql: async (draftId, sql, parameters) => { draftCalls.push({ type: 'sql', draftId, sql, parameters }); },
      previewDbApply: async (draftId) => { draftCalls.push({ type: 'preview', draftId }); return { warnings: ['Raw SQL'] }; },
      confirmDbApply: async (draftId) => {
        draftCalls.push({ type: 'confirm', draftId });
        return { id: 'apply-1', resource_id: 'db-1', draft_id: draftId, source_apply_id: null, status: 'preparing', last_error: null, backup_retained: false, created_at: timestamp, completed_at: null };
      },
      discardDbDraft: async (draftId) => { draftCalls.push({ type: 'discard', draftId }); },
    };
    let approvalId = 0;
    const approvals = new ApprovalCoordinator({ createId: () => `approval-${++approvalId}` });
    let exactSecretArgs: unknown = {
      resourceId: 'secret-1',
      operation: { kind: 'secretStore', operation: 'set', key: 'TOKEN', value: 'super-secret-value' },
    };
    const { byName } = tools(
      actorService,
      approvals,
      async () => true,
      (toolCallId) => {
        if (toolCallId !== 'tool-call') return undefined;
        const stored = exactSecretArgs;
        exactSecretArgs = undefined;
        return stored;
      },
    );

    const secret = executeTool(byName.get('vc_resource_data_write')!, {
      resourceId: 'secret-1',
      operation: { kind: 'secretStore', operation: 'set', key: 'TOKEN', value: '[redacted]' },
    });
    const secretApproval = await pendingApproval(approvals);
    expect(JSON.stringify(secretApproval)).not.toContain('super-secret-value');
    await approvals.resolve('chat-a', secretApproval.id, 'approve', { accountId: 'user-a' });
    const secretResult = await secret;
    expect(secretValues).toEqual(['super-secret-value']);
    expect(JSON.stringify(secretResult)).not.toContain('super-secret-value');

    const oversized = await executeTool(byName.get('vc_resource_data_write')!, {
      resourceId: 'secret-1',
      operation: [
        { kind: 'secretStore', operation: 'set', key: 'FIRST', value: 'x'.repeat(1_000_000) },
        { kind: 'secretStore', operation: 'set', key: 'SECOND', value: 'y'.repeat(1_000_000) },
      ],
    });
    expect(oversized.isError).toBe(true);
    expect(oversized.content[0]?.text).toContain('total request-size limit');
    expect(approvals.list('chat-a')).toEqual([]);

    const failedSecret = executeTool(byName.get('vc_resource_data_write')!, {
      resourceId: 'secret-1',
      operation: { kind: 'secretStore', operation: 'set', key: 'LEAK', value: 'must-not-leak' },
    });
    const failedSecretApproval = await pendingApproval(approvals);
    await approvals.resolve('chat-a', failedSecretApproval.id, 'approve', { accountId: 'user-a' });
    const failedSecretResult = await failedSecret;
    expect(JSON.stringify(failedSecretResult)).not.toContain('must-not-leak');
    expect(JSON.stringify(failedSecretResult)).toContain('[redacted]');

    const dbWrite = executeTool(byName.get('vc_resource_data_write')!, {
      resourceId: 'db-1',
      operation: [
        { kind: 'db', sql: 'INSERT INTO notes(id, title) VALUES (?, ?)', parameters: [{ type: 'integer', value: '7' }, 'Hello'] },
        { kind: 'db', sql: 'UPDATE notes SET title = ? WHERE id = ?', parameters: ['Updated', { type: 'integer', value: '7' }] },
      ],
    });
    const dbApproval = await pendingApproval(approvals);
    await approvals.resolve('chat-a', dbApproval.id, 'approve', { accountId: 'user-a' });
    const dbResult = await dbWrite;
    expect(liveApprovedWrite).toBe(false);
    expect(draftCalls).toEqual([
      { type: 'create', resourceId: 'db-1', name: 'AI Chat protected resource write' },
      { type: 'sql', draftId: 'draft-1', sql: 'INSERT INTO notes(id, title) VALUES (?, ?)', parameters: [{ type: 'integer', value: '7' }, { type: 'text', value: 'Hello' }] },
      { type: 'sql', draftId: 'draft-1', sql: 'UPDATE notes SET title = ? WHERE id = ?', parameters: [{ type: 'text', value: 'Updated' }, { type: 'integer', value: '7' }] },
      { type: 'preview', draftId: 'draft-1' },
      { type: 'confirm', draftId: 'draft-1' },
    ]);
    expect(dbResult.details).toMatchObject({
      results: [{ ok: true, value: { staged: true, applyId: 'apply-1' } }, { ok: true, value: { staged: true, applyId: 'apply-1' } }],
      apply: { id: 'apply-1', status: 'preparing', warnings: ['Raw SQL'] },
    });
    expect(dbResult.details.atomicity).toContain('one durable SQLite draft/apply transaction');
  });

  test('checks authorization on every tool call before touching the actor service', async () => {
    let calls = 0;
    const actorService: TActorServiceReloader = {
      reload: async () => {},
      listResources: async () => { calls += 1; return []; },
    };
    const { byName } = tools(actorService, new ApprovalCoordinator(), async () => false);
    const result = await executeTool(byName.get('vc_resource_list')!, {});
    expect(result.isError).toBe(true);
    expect(calls).toBe(0);
  });
});
