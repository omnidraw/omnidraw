import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApproveActorCandidateTool } from '../src/tools/tool.approve-actor-candidate';
import { createPublishWidgetTool } from '../src/tools/tool.publish-widget';
import { createSetActorCandidateTool } from '../src/tools/tool.set-actor-candidate';
import type { TToolEvent } from '../src/tools/types';
import { txAppendWidgetDraftResourceBindingSelectionRecord, txAppendWidgetResourceSelectionRecord } from '../src/core/tx.session-candidate';
import { createFakeSessionManager, executeTool, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('vc_publish_widget', () => {
  test('copies draft to final widgets directory and reloads actor service', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const events: TToolEvent[] = [];
    let reloadCount = 0;
    const bindings: unknown[] = [];
    const sessionManager = createFakeSessionManager();
    const base = sampleCandidate();
    const resources = {
      notes: {
        kind: 'db' as const,
        required: true,
        scope: ['read', 'write'] as ('read' | 'write')[],
        arbitrarySql: false,
        operations: {
          listNotes: { effect: 'read' as const, sql: 'SELECT id, title FROM notes', result: 'rows' as const },
          renameNote: {
            effect: 'write' as const,
            sql: 'UPDATE notes SET title = :title WHERE id = :id',
            parameters: {
              id: { type: 'string' as const, required: true, nullable: false },
              title: { type: 'string' as const, required: true, nullable: false },
            },
            result: 'execute' as const,
          },
        },
      },
    };
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), {
      candidate: sampleCandidate({ actor: { ...base.actor, resources } }),
    });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });
    txAppendWidgetResourceSelectionRecord({ sessionManager }, {
      resources: [{ id: 'db-notes', kind: 'db', name: 'Notes Database', status: 'ready' }],
      selectedAt: new Date().toISOString(),
    });
    const result = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      sessionManager,
      actorService: {
        reload: async () => { reloadCount += 1 },
        bindResource: async (binding) => { bindings.push(binding); },
      },
      onEvent: (event) => { events.push(event) },
    }), { confirm: true });

    expect(result.details.errors ?? []).toEqual([]);
    expect(result.isError).toBeUndefined();
    expect(result.details.published).toBe(true);
    expect(result.details.manifest.actor.resources).toEqual(resources);
    expect(reloadCount).toBe(1);
    expect(bindings).toEqual([{
      definitionName: 'Counter Widget',
      slot: 'notes',
      resourceId: 'db-notes',
      scope: ['read', 'write'],
    }]);
    expect(result.details.bindings).toEqual([{ slot: 'notes', resourceId: 'db-notes', resourceName: 'Notes Database', kind: 'db' }]);
    expect(events.some((event) => event.type === 'widgetupdate')).toBe(true);

    const publishedManifest = JSON.parse(await readFile(join(finalWidgetsDir, 'counter-widget', 'vibecanvas.json'), 'utf8'));
    expect(publishedManifest.name).toBe('Counter Widget');
    expect(publishedManifest.actor.resources).toEqual(resources);
  });

  test('refuses unconfirmed publish', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const result = await executeTool(createPublishWidgetTool({ cwd, finalWidgetsDir }), { confirm: false });

    expect(result.isError).toBe(true);
    expect(result.details.published).toBe(false);
  });

  test('binds the unique ready resource by kind when no resource was mentioned', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const base = sampleCandidate();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), {
      candidate: sampleCandidate({ actor: {
        ...base.actor,
        resources: { database: { kind: 'db', required: true, scope: ['read'] } },
      } }),
    });
    await executeTool(createApproveActorCandidateTool({ cwd, sessionManager, npmInstall: async () => ({ status: 'skipped', reason: 'test' }) }), { revision: 1 });
    const bindings: unknown[] = [];
    const result = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      sessionManager,
      actorService: {
        reload: async () => {},
        listResources: async () => [{
          id: 'db-only', kind: 'db', name: 'Only Database', status: 'ready', last_error: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }],
        bindResource: async (binding) => { bindings.push(binding); },
      },
    }), { confirm: true });

    expect(result.isError).toBeUndefined();
    expect(bindings).toEqual([{
      definitionName: 'Counter Widget', slot: 'database', resourceId: 'db-only', scope: ['read'],
    }]);

    txAppendWidgetDraftResourceBindingSelectionRecord({ sessionManager }, {
      resources: [],
      selectedAt: new Date().toISOString(),
      source: 'explicit-clear',
    });
    const clearedResult = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      sessionManager,
      actorService: {
        reload: async () => {},
        listResources: async () => [{
          id: 'db-only', kind: 'db', name: 'Only Database', status: 'ready', last_error: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }],
        bindResource: async (binding) => { bindings.push(binding); },
      },
    }), { confirm: true });
    expect(clearedResult.isError).toBe(true);
    expect(clearedResult.content[0].text).toContain('@mention');
    expect(bindings).toHaveLength(1);
  });

  test('refuses to guess among multiple ready resources', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const base = sampleCandidate();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), {
      candidate: sampleCandidate({ actor: {
        ...base.actor,
        resources: { database: { kind: 'db', required: true, scope: ['read'] } },
      } }),
    });
    await executeTool(createApproveActorCandidateTool({ cwd, sessionManager, npmInstall: async () => ({ status: 'skipped', reason: 'test' }) }), { revision: 1 });
    const resource = (id: string) => ({
      id, kind: 'db' as const, name: id, status: 'ready' as const, last_error: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const result = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      sessionManager,
      actorService: {
        reload: async () => {},
        listResources: async () => [resource('db-a'), resource('db-b')],
        bindResource: async () => {},
      },
    }), { confirm: true });

    expect(result.isError).toBe(true);
    expect(result.details.published).toBe(false);
    expect(result.content[0].text).toContain('@mention');
  });

  test('reloads existing instances only when edit publish keeps identity unchanged', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    let reloadCount = 0;
    let instanceReloadCount = 0;
    const sessionManager = createFakeSessionManager();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate: sampleCandidate() });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });

    const editSession = {
      mode: 'edit-published-widget' as const,
      sourceDefinitionName: 'Counter Widget',
      sourceSlug: 'counter-widget',
      sourceName: 'Counter Widget',
      sourceManifestPath: 'widgets/counter-widget/vibecanvas.json',
      previousVersion: '1',
      nextVersion: '2',
      startedAt: new Date().toISOString(),
    };

    const result = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      editSession,
      actorService: {
        reload: async () => { reloadCount += 1 },
        reloadDefinitionInstances: async () => { instanceReloadCount += 1 },
      },
    }), { confirm: true });

    expect(result.isError).toBeUndefined();
    expect(reloadCount).toBe(1);
    expect(instanceReloadCount).toBe(1);

    const manifest = JSON.parse(await readFile(join(cwd, 'vibecanvas.json'), 'utf8'));
    await writeFile(join(cwd, 'vibecanvas.json'), `${JSON.stringify({ ...manifest, slug: 'counter-widget-fork' }, null, 2)}\n`, 'utf8');

    const forkResult = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      editSession,
      actorService: {
        reload: async () => { reloadCount += 1 },
        reloadDefinitionInstances: async () => { instanceReloadCount += 1 },
      },
    }), { confirm: true });

    expect(forkResult.isError).toBeUndefined();
    expect(reloadCount).toBe(2);
    expect(instanceReloadCount).toBe(1);
    expect(JSON.parse(await readFile(join(finalWidgetsDir, 'counter-widget-fork', 'vibecanvas.json'), 'utf8')).slug).toBe('counter-widget-fork');
  });

  test('removes persisted bindings for slots deleted from the published manifest', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate: sampleCandidate() });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });
    const persistedBindings = new Map([['removed-database', 'db-old']]);

    const result = await executeTool(createPublishWidgetTool({
      cwd,
      finalWidgetsDir,
      sessionManager,
      actorService: {
        reload: async () => {},
        listResourceBindingsForDefinition: async () => [...persistedBindings].map(([slot_name, resource_id]) => ({ slot_name, resource_id })),
        unbindResource: async ({ slot }) => persistedBindings.delete(slot),
      },
    }), { confirm: true });

    expect(result.isError).toBeUndefined();
    expect(persistedBindings.size).toBe(0);
  });
});
