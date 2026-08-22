import { describe, expect, test } from 'bun:test';
import type { TResourceJson } from '#backend/shell/resources';
import { fnResourceNameKey } from '#backend/core/database/fn.resource-name';
import { ApprovalCoordinator } from '../approval/ApprovalCoordinator';
import type { TAgentResource, TAgentResourceService } from '../tools/resource-service';
import { createResourceTools } from '../tools/tool.resources';
import { executeTool } from './tool.test-helpers';
import { testApprovalWorld } from './service.fixture';

const timestamp = '2026-07-16 00:00:00';

function resource(id: string, kind: TAgentResource['kind'], name: string, status: TAgentResource['status'] = 'ready'): TAgentResource {
  return { id, kind, name, status, lastError: null, createdAtSec: timestamp, updatedAtSec: timestamp };
}

function tools(
  resourceService: TAgentResourceService,
  approvals = new ApprovalCoordinator(testApprovalWorld()),
  authorize = async () => true,
  takeSensitiveToolArgs?: (toolCallId: string) => unknown,
) {
  return {
    approvals,
    byName: new Map(createResourceTools({
      chatId: 'chat-a',
      resourceService,
      approvals,
      authorize,
      takeSensitiveToolArgs,
    }).map((tool) => [tool.name, tool])),
  };
}

function providerModelData(result: any): any {
  const text = result.content[0]?.text ?? '';
  const marker = 'Model data:\n';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Missing model data in: ${text}`);
  return JSON.parse(text.slice(start + marker.length));
}

function resolvingService(resources: TAgentResource[]): TAgentResourceService {
  return {
    listResources: async (filter = {}) => resources.filter((entry) => !filter.kind || entry.kind === filter.kind),
    getResource: async (id) => resources.find((entry) => entry.id === id) ?? null,
    resolveResourceByName: async (name, options) => {
      const matches = resources.filter((entry) => fnResourceNameKey(entry.name) === fnResourceNameKey(name));
      if (matches.length === 0) throw Object.assign(new Error(`Resource '${name.trim()}' was not found.`), { code: 'RESOURCE_NOT_FOUND' });
      if (matches.length > 1) throw Object.assign(new Error(`Resource name '${name.trim()}' is ambiguous.`), { code: 'RESOURCE_NAME_AMBIGUOUS' });
      const found = matches[0]!;
      if (options.requireReady && found.status !== 'ready') {
        throw Object.assign(new Error(`Resource '${found.name}' is not ready.`), { code: 'RESOURCE_NOT_READY' });
      }
      return found;
    },
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
  test('publishes name-only model schemas with consistent read/write arrays', () => {
    const { byName } = tools(resolvingService([]));
    for (const toolName of [
      'od_resource_inspect',
      'od_resource_update',
      'od_resource_delete',
      'od_resource_data_read',
      'od_resource_data_write',
    ]) {
      expect(JSON.stringify(byName.get(toolName)!.parameters)).not.toContain('resourceId');
    }
    expect((byName.get('od_resource_inspect')!.parameters as any).properties).toHaveProperty('resourceName');
    expect((byName.get('od_resource_update')!.parameters as any).properties).toMatchObject({
      resourceName: expect.any(Object),
      newName: expect.any(Object),
    });
    expect((byName.get('od_resource_data_read')!.parameters as any).properties.queries.type).toBe('array');
    expect((byName.get('od_resource_data_write')!.parameters as any).properties.operations.type).toBe('array');
    expect(JSON.stringify((byName.get('od_resource_data_read')!.parameters as any).properties.queries)).not.toContain('"kind"');
    expect(JSON.stringify((byName.get('od_resource_data_read')!.parameters as any).properties.queries)).toContain('"search"');
    expect(JSON.stringify((byName.get('od_resource_data_read')!.parameters as any).properties.queries)).toContain('"schema"');
    expect(JSON.stringify((byName.get('od_resource_data_write')!.parameters as any).properties.operations)).not.toContain('"kind"');
  });

  test('chains list, inspect, and ordered reads using names in provider-visible content', async () => {
    const resources = [
      resource('kv-1', 'kv', 'User Preferences'),
      resource('secret-1', 'secretStore', 'Credentials'),
      resource('db-1', 'db', 'Notes'),
      resource('db-building', 'db', 'Warehouse', 'provisioning'),
    ];
    const dbCalls: unknown[] = [];
    const dataListCalls: unknown[] = [];
    const resourceService: TAgentResourceService = {
      ...resolvingService(resources),
      countResourceData: async () => 1,
      listResourceData: async (call) => {
        dataListCalls.push(call);
        return call.resourceId === 'secret-1'
          ? { kind: 'secretStore', entries: [{ name: 'TOKEN', revision: 1, createdAtSec: timestamp, updatedAtSec: timestamp }], nextCursor: null }
          : { kind: 'kv', entries: [{ key: 'theme', valuePreview: 'dark-value-must-not-be-listed', valueTruncated: false, revision: 1, createdAtSec: timestamp, updatedAtSec: timestamp }], nextCursor: null };
      },
      getResourceDataEntry: async ({ resourceId, key }) => {
        if (key === 'missing') return null;
        if (resourceId === 'secret-1') return { kind: 'secretStore', name: key, revision: 1, createdAtSec: timestamp, updatedAtSec: timestamp };
        return { kind: 'kv', key, value: { mode: 'dark' }, revision: 1, createdAtSec: timestamp, updatedAtSec: timestamp };
      },
      inspectDbResource: async () => ({ objects: [{
        name: 'notes', kind: 'table', columns: [], indexes: [], foreignKeys: [], triggers: [], createSql: 'CREATE TABLE notes(id INTEGER)', identity: null, editable: true, readOnlyReason: null,
      }] } as never),
      executeDbLiveSql: async (call) => {
        dbCalls.push(call);
        return { kind: 'rows', columns: ['id'], rows: [{ id: { type: 'integer', value: '7' } }], rowCount: 1, rowsAffected: 0, truncated: false };
      },
    };
    const { byName } = tools(resourceService);

    const firstPage = await executeTool(byName.get('od_resource_list')!, { limit: 2 });
    const firstData = providerModelData(firstPage);
    expect(firstData.resources).toEqual([
      { name: 'Notes', kind: 'db', status: 'ready' },
      { name: 'User Preferences', kind: 'kv', status: 'ready' },
    ]);
    expect(firstData.nextCursor).toStartWith('vc1.');
    expect(firstData.nextCursor).not.toContain('secret-1');
    expect(JSON.stringify(firstPage)).not.toContain('"id"');

    const removed = resources.splice(0, 1);
    const stalePage = await executeTool(byName.get('od_resource_list')!, { cursor: firstData.nextCursor, limit: 10 });
    expect(providerModelData(stalePage)).toMatchObject({ error: { code: 'RESOURCE_CURSOR_INVALID' } });
    resources.unshift(...removed);

    const secondPage = await executeTool(byName.get('od_resource_list')!, { cursor: firstData.nextCursor, limit: 10 });
    expect(providerModelData(secondPage)).toEqual({
      resources: [
        { name: 'Warehouse', kind: 'db', status: 'provisioning' },
      ],
      nextCursor: null,
    });

    const secretInspect = await executeTool(byName.get('od_resource_inspect')!, { resourceName: ' credentials ' });
    expect(providerModelData(secretInspect)).toMatchObject({
      error: { code: 'RESOURCE_KIND_DISABLED' },
    });

    const dbInspect = await executeTool(byName.get('od_resource_inspect')!, { resourceName: 'Notes' });
    expect(providerModelData(dbInspect)).toMatchObject({
      resource: { name: 'Notes', kind: 'db' },
      currentlyDeletable: true,
      schema: {
        summary: { objectCount: 1, tableCount: 1, viewCount: 0 },
        objects: [{
          name: 'notes', kind: 'table', createSql: 'CREATE TABLE notes(id INTEGER)',
          indexes: [], foreignKeys: [], triggers: [],
        }],
        nextCursor: null,
        rowsRead: false,
      },
    });
    expect(JSON.stringify(dbInspect)).not.toContain('"rows"');

    const nonReadyInspect = await executeTool(byName.get('od_resource_inspect')!, { resourceName: 'Warehouse' });
    expect(providerModelData(nonReadyInspect)).toMatchObject({ ready: false, capabilities: { read: false, write: false } });

    const kvRead = await executeTool(byName.get('od_resource_data_read')!, {
      resourceName: ' user PREFERENCES ',
      queries: [
        { operation: 'get', key: 'theme' },
        { operation: 'has', key: 'missing' },
        { operation: 'list', search: 'hem' },
        { operation: 'sql', sql: 'SELECT 1' },
      ],
    });
    expect(providerModelData(kvRead).results).toEqual([
      { index: 0, ok: true, value: { kind: 'kv', key: 'theme', value: { mode: 'dark' }, revision: 1, createdAtSec: timestamp, updatedAtSec: timestamp } },
      { index: 1, ok: true, value: { exists: false } },
      { index: 2, ok: true, value: {
        kind: 'kv',
        entries: [{ key: 'theme', revision: 1, createdAtSec: timestamp, updatedAtSec: timestamp }],
        matchingCount: 1,
        nextCursor: null,
      } },
      { index: 3, ok: false, error: { code: 'RESOURCE_OPERATION_UNSUPPORTED', message: 'SQL reads are unsupported for kv resources.' } },
    ]);
    expect(JSON.stringify(providerModelData(kvRead))).not.toContain('dark-value-must-not-be-listed');

    const secretRead = await executeTool(byName.get('od_resource_data_read')!, {
      resourceName: 'Credentials',
      queries: [
        { operation: 'get', key: 'TOKEN' },
        { operation: 'has', key: 'TOKEN' },
        { operation: 'list', search: 'OK', limit: 5 },
      ],
    });
    expect(providerModelData(secretRead)).toMatchObject({
      error: { code: 'RESOURCE_KIND_DISABLED' },
    });

    const dbRead = await executeTool(byName.get('od_resource_data_read')!, {
      resourceName: 'Notes',
      queries: [
        { operation: 'schema', object: 'NOTES' },
        { operation: 'sql', sql: 'SELECT ? AS id', parameters: [{ type: 'integer', value: '7' }] },
      ],
    });
    expect(providerModelData(dbRead).results[0]).toMatchObject({
      index: 0,
      ok: true,
      value: { schemaObject: { name: 'notes', kind: 'table', columns: [], indexes: [] }, rowsRead: false },
    });
    expect(providerModelData(dbRead).results[1]).toMatchObject({ index: 1, ok: true, value: { kind: 'rows', rowCount: 1 } });
    expect(dbCalls).toEqual([{
      resourceId: 'db-1', sql: 'SELECT ? AS id', parameters: [{ type: 'integer', value: '7' }], approved: false,
    }]);
    expect(dataListCalls).toEqual([
      { resourceId: 'kv-1', prefix: undefined, search: 'hem', cursor: undefined, limit: 20 },
    ]);
  });

  test('returns dense database schema pages of at most 100 objects with opaque stale cursors', async () => {
    const resources = [resource('db-1', 'db', 'Warehouse')];
    const objects = Array.from({ length: 105 }, (_, index) => ({
      name: `table_${String(index).padStart(3, '0')}`,
      kind: 'table' as const,
      columns: [],
      indexes: [{
        name: `idx_${index}`,
        unique: index % 2 === 0,
        origin: 'c',
        partial: false,
        columns: [{ name: 'id', sequence: 0 }],
        createSql: `CREATE INDEX idx_${index} ON table_${String(index).padStart(3, '0')}(id)`,
      }],
      foreignKeys: [],
      triggers: [{ name: `trigger_${index}`, createSql: `CREATE TRIGGER trigger_${index} AFTER INSERT ON table_${String(index).padStart(3, '0')} BEGIN SELECT 1; END` }],
      createSql: `CREATE TABLE table_${String(index).padStart(3, '0')}(id INTEGER PRIMARY KEY)`,
      identity: { kind: 'primaryKey' as const, columns: ['id'] },
      editable: true,
      readOnlyReason: null,
    }));
    const resourceService: TAgentResourceService = {
      ...resolvingService(resources),
      inspectDbResource: async () => ({ objects } as never),
    };
    const { byName } = tools(resourceService);

    const inspected = providerModelData(await executeTool(byName.get('od_resource_inspect')!, { resourceName: 'Warehouse' }));
    expect(inspected.schema.objects).toHaveLength(100);
    expect(inspected.schema.nextCursor).toStartWith('vds1.');
    expect(inspected.schema.nextCursor).not.toContain('table_100');
    expect(inspected.schema.objects[0]).toMatchObject({
      name: 'table_000',
      createSql: 'CREATE TABLE table_000(id INTEGER PRIMARY KEY)',
      indexes: [{ name: 'idx_0', unique: true, columns: ['id'] }],
      triggers: ['trigger_0'],
    });
    expect(inspected.schema.objects[0].indexes[0]).not.toHaveProperty('createSql');

    const continued = providerModelData(await executeTool(byName.get('od_resource_data_read')!, {
      resourceName: 'Warehouse',
      queries: [{ operation: 'schema', cursor: inspected.schema.nextCursor, limit: 100 }],
    }));
    expect(continued.results[0]).toMatchObject({
      index: 0,
      ok: true,
      value: {
        schema: {
          objects: [
            { name: 'table_100' },
            { name: 'table_101' },
            { name: 'table_102' },
            { name: 'table_103' },
            { name: 'table_104' },
          ],
          nextCursor: null,
        },
      },
    });

    objects.push({ ...objects[0]!, name: 'table_105' });
    const stale = providerModelData(await executeTool(byName.get('od_resource_data_read')!, {
      resourceName: 'Warehouse',
      queries: [{ operation: 'schema', cursor: inspected.schema.nextCursor }],
    }));
    expect(stale.results[0]).toMatchObject({
      index: 0,
      ok: false,
      error: { code: 'DB_SCHEMA_CURSOR_INVALID' },
    });
  });

  test('chains resource work while returning the exact safe id for manifest authoring', async () => {
    const resources: TAgentResource[] = [];
    const entries = new Map<string, { value: TResourceJson; revision: number }>();
    const resourceService: TAgentResourceService = {
      ...resolvingService(resources),
      createResource: async ({ kind, name }) => {
        const created = resource('internal-chain-id', kind, name.trim());
        resources.push(created);
        return created;
      },
      countResourceData: async () => entries.size,
      listResourceData: async () => ({ kind: 'kv', entries: [], nextCursor: null }),
      getResourceDataEntry: async ({ key }) => {
        const entry = entries.get(key);
        return entry ? {
          kind: 'kv', key, value: entry.value, revision: entry.revision, createdAtSec: timestamp, updatedAtSec: timestamp,
        } : null;
      },
      setResourceDataEntry: async ({ key, value }) => {
        const revision = (entries.get(key)?.revision ?? 0) + 1;
        entries.set(key, { value, revision });
        return {
          kind: 'kv',
          entry: { key, valuePreview: String(JSON.stringify(value)), valueTruncated: false, revision, createdAtSec: timestamp, updatedAtSec: timestamp },
        };
      },
      deleteResourceDataEntry: async ({ key }) => {
        entries.delete(key);
        return { deleted: true };
      },
      deleteResource: async (id) => {
        const index = resources.findIndex((entry) => entry.id === id);
        if (index >= 0) resources.splice(index, 1);
      },
    };
    const approvals = new ApprovalCoordinator(testApprovalWorld());
    const { byName } = tools(resourceService, approvals);

    const create = executeTool(byName.get('od_resource_create')!, { kind: 'kv', name: 'Team Preferences' });
    const createApproval = await pendingApproval(approvals);
    await approvals.resolve('chat-a', createApproval.id, 'approve');
    const createdResult = providerModelData(await create);
    const createdName = createdResult.resource.name;
    expect(createdName).toBe('Team Preferences');
    expect(createdResult.resource.resourceId).toBe('internal-chain-id');

    const inspected = await executeTool(byName.get('od_resource_inspect')!, { resourceName: createdName });
    expect(providerModelData(inspected)).toMatchObject({
      resource: { resourceId: 'internal-chain-id', name: createdName, kind: 'kv' },
      ready: true,
    });

    const write = executeTool(byName.get('od_resource_data_write')!, {
      resourceName: createdName,
      operations: [{ operation: 'set', key: 'theme', value: 'dark' }],
    });
    const writeApproval = await pendingApproval(approvals);
    await approvals.resolve('chat-a', writeApproval.id, 'approve');
    expect(providerModelData(await write).results).toMatchObject([{ index: 0, ok: true }]);

    const read = await executeTool(byName.get('od_resource_data_read')!, {
      resourceName: ' team preferences ',
      queries: [{ operation: 'get', key: 'theme' }],
    });
    expect(providerModelData(read).results[0]).toMatchObject({ index: 0, ok: true, value: { value: 'dark' } });

    const remove = executeTool(byName.get('od_resource_delete')!, { resourceName: createdName });
    const deleteApproval = await pendingApproval(approvals);
    await approvals.resolve('chat-a', deleteApproval.id, 'approve');
    const removed = await remove;
    expect(providerModelData(removed)).toEqual({ deleted: true, resourceName: createdName });
    expect(JSON.stringify([read, removed])).not.toContain('internal-chain-id');
  });

  test('freezes internal IDs before approvals and reveals only successful create IDs', async () => {
    const resources = [resource('kv-stable-id', 'kv', 'Preferences')];
    const resourceService: TAgentResourceService = {
      ...resolvingService(resources),
      createResource: async ({ kind, name }) => {
        const created = resource(`created-${resources.length}`, kind, name.trim());
        resources.push(created);
        return created;
      },
      renameResource: async ({ id, name }) => {
        const index = resources.findIndex((entry) => entry.id === id);
        if (index < 0) throw Object.assign(new Error('Resource not found.'), { code: 'RESOURCE_NOT_FOUND' });
        const renamed = { ...resources[index]!, name: name.trim() };
        resources[index] = renamed;
        return renamed;
      },
      deleteResource: async (id) => {
        if (id === 'kv-stable-id') throw Object.assign(new Error(`Resource ${id} is still bound.`), { code: 'RESOURCE_STILL_BOUND' });
      },
    };
    let approvalId = 0;
    const approvals = new ApprovalCoordinator({
      ...testApprovalWorld(),
      createId: () => `approval-${++approvalId}`,
    });
    const { byName } = tools(resourceService, approvals);

    for (const input of [
      { kind: 'kv', name: 'Cache', expectedName: 'Cache', expectedId: 'created-1' },
      { kind: 'secretStore', name: 'Tokens', expectedName: 'Tokens', expectedId: 'created-2' },
      { kind: 'db', name: ' Reports ', expectedName: 'Reports', expectedId: 'created-3' },
    ]) {
      const { expectedName, expectedId, ...params } = input;
      const pending = executeTool(byName.get('od_resource_create')!, params);
      const approval = await pendingApproval(approvals);
      expect(approval.toolCallId).toBe('tool-call');
      expect(JSON.stringify(approval)).not.toContain('resourceId');
      params.name = 'Mutated after approval';
      params.kind = input.kind === 'db' ? 'kv' : 'db';
      await approvals.resolve('chat-a', approval.id, 'approve');
      expect(providerModelData(await pending)).toEqual({
        resource: { resourceId: expectedId, name: expectedName, kind: input.kind, status: 'ready' },
      });
    }

    const update = executeTool(byName.get('od_resource_update')!, { resourceName: 'Preferences', newName: 'Settings' });
    const updateApproval = await pendingApproval(approvals);
    resources[0] = { ...resources[0]!, name: 'Renamed Elsewhere' };
    await approvals.resolve('chat-a', updateApproval.id, 'approve');
    const updateResult = await update;
    expect(providerModelData(updateResult)).toEqual({ resource: { name: 'Settings', kind: 'kv', status: 'ready' } });
    expect(JSON.stringify(updateResult)).not.toContain('kv-stable-id');

    const remove = executeTool(byName.get('od_resource_delete')!, { resourceName: 'Settings' });
    const deleteApproval = await pendingApproval(approvals);
    await expect(approvals.resolve('chat-a', deleteApproval.id, 'approve')).rejects.toThrow('still bound');
    const deleteResult = await remove;
    expect(providerModelData(deleteResult)).toMatchObject({ error: { code: 'RESOURCE_STILL_BOUND' } });
    expect(JSON.stringify(deleteResult)).not.toContain('kv-stable-id');
  });

  test('rejects disabled Secret Store writes and uses the durable SQLite apply path', async () => {
    const resources = [resource('secret-1', 'secretStore', 'Credentials'), resource('db-1', 'db', 'Notes')];
    const draftCalls: unknown[] = [];
    const resourceService: TAgentResourceService = {
      ...resolvingService(resources),
      createDbDraft: async (resourceId, name) => {
        draftCalls.push({ type: 'create', resourceId, name });
        return { draft: { id: 'draft-1' } };
      },
      executeDbDraftSql: async (draftId, sql, parameters) => { draftCalls.push({ type: 'sql', draftId, sql, parameters }); },
      previewDbApply: async (draftId) => { draftCalls.push({ type: 'preview', draftId }); return { warnings: ['Raw SQL'] }; },
      confirmDbApply: async (draftId) => {
        draftCalls.push({ type: 'confirm', draftId });
        return { id: 'apply-internal', status: 'preparing' };
      },
      getDbApply: async () => ({ apply: { id: 'apply-internal', status: 'succeeded' } }),
      discardDbDraft: async (draftId) => { draftCalls.push({ type: 'discard', draftId }); },
    };
    let approvalId = 0;
    const approvals = new ApprovalCoordinator({
      ...testApprovalWorld(),
      createId: () => `approval-${++approvalId}`,
    });
    const { byName } = tools(resourceService, approvals);

    const secretResult = await executeTool(byName.get('od_resource_data_write')!, {
      resourceName: 'Credentials',
      operations: [{ operation: 'set', key: 'TOKEN', value: 'must-not-run' }],
    });
    expect(providerModelData(secretResult)).toMatchObject({
      error: { code: 'RESOURCE_KIND_DISABLED' },
    });
    expect(approvals.list('chat-a')).toEqual([]);

    const dbWrite = executeTool(byName.get('od_resource_data_write')!, {
      resourceName: 'Notes',
      operations: [
        { operation: 'sql', sql: 'INSERT INTO notes(id, title) VALUES (?, ?)', parameters: [{ type: 'integer', value: '7' }, 'Hello'] },
        { operation: 'sql', sql: 'UPDATE notes SET title = ? WHERE id = ?', parameters: ['Updated', { type: 'integer', value: '7' }] },
      ],
    });
    const dbApproval = await pendingApproval(approvals);
    await approvals.resolve('chat-a', dbApproval.id, 'approve');
    const dbData = providerModelData(await dbWrite);
    expect(dbData.results).toEqual([
      { index: 0, ok: true, value: { staged: true, applyStatus: 'succeeded' } },
      { index: 1, ok: true, value: { staged: true, applyStatus: 'succeeded' } },
    ]);
    expect(dbData.apply).toEqual({ status: 'succeeded', warnings: ['Raw SQL'], warningsTruncated: false });
    expect(JSON.stringify(dbData)).not.toContain('apply-internal');
    expect(draftCalls).toEqual([
      { type: 'create', resourceId: 'db-1', name: 'AI Chat protected resource write' },
      { type: 'sql', draftId: 'draft-1', sql: 'INSERT INTO notes(id, title) VALUES (?, ?)', parameters: [{ type: 'integer', value: '7' }, { type: 'text', value: 'Hello' }] },
      { type: 'sql', draftId: 'draft-1', sql: 'UPDATE notes SET title = ? WHERE id = ?', parameters: [{ type: 'text', value: 'Updated' }, { type: 'integer', value: '7' }] },
      { type: 'preview', draftId: 'draft-1' },
      { type: 'confirm', draftId: 'draft-1' },
    ]);
  });

  test('db writes report the terminal apply status, not the stale preparing snapshot', async () => {
    const resources = [resource('db-1', 'db', 'Notes')];
    for (const terminal of ['succeeded', 'failed'] as const) {
      let storedStatus = 'preparing';
      const resourceService: TAgentResourceService = {
        ...resolvingService(resources),
        createDbDraft: async () => ({ draft: { id: 'draft-1' } }),
        executeDbDraftSql: async () => undefined,
        previewDbApply: async () => ({ warnings: [] }),
        confirmDbApply: async () => {
          queueMicrotask(() => { storedStatus = terminal; });
          return { id: 'apply-1', status: 'preparing' };
        },
        getDbApply: async () => ({ apply: { id: 'apply-1', status: storedStatus } }),
        discardDbDraft: async () => undefined,
      };
      const approvals = new ApprovalCoordinator(testApprovalWorld());
      const { byName } = tools(resourceService, approvals);
      const write = executeTool(byName.get('od_resource_data_write')!, {
        resourceName: 'Notes',
        operations: [{ operation: 'sql', sql: 'INSERT INTO notes(id) VALUES (1)' }],
      });
      const approval = await pendingApproval(approvals);
      await approvals.resolve('chat-a', approval.id, 'approve');
      const data = providerModelData(await write);
      expect(data.results).toEqual([
        { index: 0, ok: true, value: { staged: true, applyStatus: terminal } },
      ]);
      expect(data.apply).toMatchObject({ status: terminal });
    }
  });

  test('returns stable name-resolution and authorization errors in model content', async () => {
    const resources = [
      resource('a', 'kv', 'Duplicate'),
      resource('b', 'db', 'duplicate'),
      resource('pending', 'kv', 'Pending', 'provisioning'),
    ];
    const service = resolvingService(resources);
    const { byName } = tools(service);
    const ambiguous = await executeTool(byName.get('od_resource_inspect')!, { resourceName: 'DUPLICATE' });
    expect(providerModelData(ambiguous)).toMatchObject({ error: { code: 'RESOURCE_NAME_AMBIGUOUS', retryable: false } });
    const missing = await executeTool(byName.get('od_resource_inspect')!, { resourceName: 'Missing' });
    expect(providerModelData(missing)).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND', retryable: false } });
    const notReady = await executeTool(byName.get('od_resource_data_read')!, {
      resourceName: 'pending',
      queries: [{ operation: 'get', key: 'value' }],
    });
    expect(providerModelData(notReady)).toMatchObject({ error: { code: 'RESOURCE_NOT_READY', retryable: false } });

    let calls = 0;
    service.listResources = async () => { calls += 1; return []; };
    const denied = tools(service, new ApprovalCoordinator(testApprovalWorld()), async () => false);
    const result = await executeTool(denied.byName.get('od_resource_list')!, {});
    expect(providerModelData(result)).toMatchObject({ error: { code: 'TOOL_NOT_AUTHORIZED' } });
    expect(calls).toBe(0);
  });
});
