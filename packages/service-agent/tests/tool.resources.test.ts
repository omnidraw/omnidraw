import { describe, expect, test } from 'bun:test';
import { createInspectResourceTool } from '../src/tools/tool.inspect-resource';
import { createListResourcesTool } from '../src/tools/tool.list-resources';
import { createProposeDbChangeTool } from '../src/tools/tool.propose-db-change';
import { txAppendWidgetResourceSelectionRecord } from '../src/core/tx.session-candidate';
import { createFakeSessionManager, executeTool } from './tool.test-helpers';

const database = {
  id: 'db-1',
  kind: 'db' as const,
  name: 'Notes Database',
  status: 'ready' as const,
  last_error: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('Wizard resource tools', () => {
  test('lists safe metadata and marks typed user selections', async () => {
    const sessionManager = createFakeSessionManager();
    txAppendWidgetResourceSelectionRecord({ sessionManager }, {
      resources: [{ id: database.id, kind: database.kind, name: database.name, status: database.status }],
      selectedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await executeTool(createListResourcesTool({
      sessionManager,
      actorService: {
        reload: async () => {},
        listResources: async () => [database],
      },
    }));

    expect(result.isError).toBeUndefined();
    expect(result.details.resources).toEqual([{
      id: 'db-1',
      kind: 'db',
      name: 'Notes Database',
      status: 'ready',
      selected: true,
    }]);
    expect(result.content[0].text).toContain('id="db-1"');
    expect(result.content[0].text).toContain('selected=true');
    expect(JSON.stringify(result.details)).not.toContain('path');
  });

  test('inspects database schema without reading rows or BLOB payloads', async () => {
    const result = await executeTool(createInspectResourceTool({
      actorService: {
        reload: async () => {},
        getResource: async () => database,
        inspectDbResource: async () => ({
          resourceId: database.id,
          target: 'live',
          draftId: null,
          objects: [{
            name: 'notes',
            kind: 'table',
            columns: [
              { name: 'id', declaredType: 'INTEGER', nullable: false, defaultSql: null, primaryKeyOrder: 1, hidden: false },
              { name: 'attachment', declaredType: 'BLOB', nullable: true, defaultSql: null, primaryKeyOrder: null, hidden: false },
            ],
            indexes: [],
            foreignKeys: [],
            triggers: [],
            createSql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, attachment BLOB)',
            identity: { kind: 'primaryKey', columns: ['id'] },
            editable: true,
            readOnlyReason: null,
          }],
        }),
      },
    }), { resourceId: database.id });

    expect(result.isError).toBeUndefined();
    expect(result.details.schema[0].columns[1]).toMatchObject({ name: 'attachment', declaredType: 'BLOB' });
    expect(result.content[0].text).toContain('"id": "db-1"');
    expect(result.content[0].text).toContain('"name": "attachment"');
    expect(JSON.stringify(result.details)).not.toContain('base64');
    expect(JSON.stringify(result.details)).not.toContain('rows');
    expect(result.content[0].text).not.toContain('base64');
    expect(result.content[0].text).not.toContain('"rows":');
  });

  test('only records DB SQL proposals for explicitly selected resources', async () => {
    const sessionManager = createFakeSessionManager();
    let mutationCalls = 0;
    const actorService = {
      reload: async () => {},
      getResource: async () => database,
      createDbDraft: async () => { mutationCalls += 1; return { draft: { id: 'draft' } }; },
    };
    const tool = createProposeDbChangeTool({
      sessionManager,
      actorService,
      createId: () => 'proposal-1',
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const params = { resourceId: database.id, sql: 'ALTER TABLE notes ADD COLUMN title TEXT;', reason: 'Store note titles.' };

    const refused = await executeTool(tool, params);
    expect(refused.isError).toBe(true);
    expect(mutationCalls).toBe(0);

    txAppendWidgetResourceSelectionRecord({ sessionManager }, {
      resources: [{ id: database.id, kind: database.kind, name: database.name, status: database.status }],
      selectedAt: '2026-01-01T00:00:00.000Z',
    });
    const proposed = await executeTool(tool, params);
    expect(proposed.isError).toBeUndefined();
    expect(proposed.details).toMatchObject({
      kind: 'db-change-proposal',
      proposed: true,
      proposal: { id: 'proposal-1', status: 'pending', resourceId: 'db-1' },
    });
    expect(mutationCalls).toBe(0);
  });
});
